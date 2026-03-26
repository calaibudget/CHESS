import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Chess } from 'chess.js';
import { useStockfish } from './useStockfish';
import { classifyMove } from '../utils/moveQuality';
import { computeThreats } from '../utils/threats';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

let moveIdCounter = 0;
const nextMoveId = () => ++moveIdCounter;

function uciToSpec(uci) {
  if (!uci || uci.length < 4) return null;
  return {
    from: uci.slice(0, 2),
    to:   uci.slice(2, 4),
    ...(uci.length === 5 ? { promotion: uci[4] } : {}),
  };
}

const MATERIAL_ORDER = ['q', 'r', 'b', 'n', 'p'];
const PIECE_VALS      = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// Reconstruct captured arrays up to move index `upTo` (0-based, inclusive).
// capturedByWhite = black pieces white took; capturedByBlack = white pieces black took.
function capturesUpTo(moves, upTo) {
  const byWhite = [], byBlack = [];
  for (let i = 0; i <= upTo && i < moves.length; i++) {
    const m = moves[i];
    if (m.moveObj?.captured) {
      // color 'w' means White moved → White captured a black piece
      if (m.color === 'w') byWhite.push(m.moveObj.captured);
      else                 byBlack.push(m.moveObj.captured);
    }
  }
  return { byWhite, byBlack };
}

export function useChessGame() {
  const chessRef = useRef(new Chess());
  const sf       = useStockfish();

  // ── Core game state ───────────────────────────────────────────────────────
  const [board,            setBoard]            = useState(() => chessRef.current.board());
  const [selectedSquare,   setSelectedSquare]   = useState(null);
  const [legalMoves,       setLegalMoves]       = useState([]);
  const [lastMove,         setLastMove]         = useState(null);
  const [evaluation,       setEvaluation]       = useState(0);
  const [moves,            setMoves]            = useState([]);
  const [elo,              setEloState]         = useState(1200);
  const [showMoveQuality,  setShowMoveQuality]  = useState(false);
  const [isThinking,       setIsThinking]       = useState(false);
  const [gameState,        setGameState]        = useState('playing');
  const [promotionPending, setPromotionPending] = useState(null);
  const [moveQualityPopup, setMoveQualityPopup] = useState(null);

  // ── Captured pieces (live position) ──────────────────────────────────────
  const [capturedByWhite, setCapturedByWhite] = useState([]); // black pieces white took
  const [capturedByBlack, setCapturedByBlack] = useState([]); // white pieces black took

  // ── Threats: single-use ───────────────────────────────────────────────────
  // threatsData is non-null only when threats are visible; cleared on next move.
  const [threatsData, setThreatsData] = useState(null);

  // ── Hint (2-click) ────────────────────────────────────────────────────────
  const [hintState,  setHintState]  = useState(null);
  const [hintLoading, setHintLoading] = useState(false);

  // ── Position scrubbing ────────────────────────────────────────────────────
  // viewIndex: null = live position; 0..N-1 = reviewing that move's post-position
  const [viewIndex, setViewIndex] = useState(null);

  // Stable refs
  const eloRef         = useRef(1200);
  const showQualityRef = useRef(false);
  const movesRef       = useRef([]);  // always mirrors `moves` state for async access

  // Keep movesRef in sync
  useEffect(() => { movesRef.current = moves; }, [moves]);

  // ── Board sync ────────────────────────────────────────────────────────────
  const syncBoard = useCallback(() => {
    const c = chessRef.current;
    setBoard(c.board());
    if      (c.isCheckmate()) setGameState('checkmate');
    else if (c.isStalemate()) setGameState('stalemate');
    else if (c.isDraw())      setGameState('draw');
    else                      setGameState('playing');
  }, []);

  const refreshEval = useCallback(async () => {
    const fen = chessRef.current.fen();
    const score = await sf.evaluatePosition(fen, 10);
    setEvaluation(score);
  }, [sf]);

  const getLegalMovesFor = useCallback((sq) =>
    chessRef.current.moves({ verbose: true }).filter(m => m.from === sq),
  []);

  // ── Apply a half-move ─────────────────────────────────────────────────────
  const applyMove = useCallback(async (moveSpec, isAI = false) => {
    const chess  = chessRef.current;
    const prevFen = chess.fen();
    const result  = chess.move(moveSpec);
    if (!result) return null;

    const postFen = chess.fen();
    const moveId  = nextMoveId();

    // Captured piece tracking (live)
    if (result.captured) {
      if (isAI) setCapturedByBlack(prev => [...prev, result.captured]);
      else      setCapturedByWhite(prev => [...prev, result.captured]);
    }

    const entry = {
      id:      moveId,
      san:     result.san,
      from:    result.from,
      to:      result.to,
      color:   isAI ? 'b' : 'w',
      prevFen,
      postFen,
      moveObj: result,
      quality: null,
    };

    setMoves(prev => [...prev, entry]);
    setLastMove({ from: result.from, to: result.to });
    setSelectedSquare(null);
    setLegalMoves([]);
    setHintState(null);
    setThreatsData(null);   // single-use: clear threats on move
    setViewIndex(null);     // return to live on new move
    syncBoard();
    refreshEval();

    // Async quality classification
    if (showQualityRef.current) {
      classifyEntryAsync(moveId, prevFen, postFen, isAI ? 'b' : 'w', result);
    }

    return result;
  }, [syncBoard, refreshEval, sf]);

  // ── Async quality classification helper ───────────────────────────────────
  const classifyEntryAsync = useCallback((moveId, prevFen, postFen, color, moveObj) => {
    const moverIsWhite = color === 'w';
    Promise.all([
      sf.evaluateWithMultiPV(prevFen),   // { bestCp, secondCp } before move
      sf.evaluatePosition(postFen, 10),  // bestCp after move (White POV)
    ]).then(([{ bestCp, secondCp }, evalAfter]) => {
      const quality = classifyMove(bestCp, secondCp, evalAfter, moverIsWhite, moveObj);
      setMoves(prev => prev.map(m => m.id === moveId ? { ...m, quality } : m));
      setMoveQualityPopup({ quality, visible: true });
      setTimeout(() => setMoveQualityPopup(p => p ? { ...p, visible: false } : null), 1800);
      setTimeout(() => setMoveQualityPopup(null), 2200);
    });
  }, [sf]);

  // ── AI turn ───────────────────────────────────────────────────────────────
  const triggerAI = useCallback(async () => {
    if (chessRef.current.isGameOver()) return;
    setIsThinking(true);
    try {
      const uciMove = await sf.findBestMove(chessRef.current.fen(), eloRef.current);
      const spec    = uciToSpec(uciMove);
      if (spec && !chessRef.current.isGameOver()) await applyMove(spec, true);
    } finally {
      setIsThinking(false);
    }
  }, [sf, applyMove]);

  // ── Square click ──────────────────────────────────────────────────────────
  const handleSquareClick = useCallback((square) => {
    const chess = chessRef.current;
    if (isThinking || gameState !== 'playing') return;
    if (chess.turn() !== 'w') return;
    if (viewIndex !== null) return; // no moves while reviewing

    if (selectedSquare) {
      const allMoves = chess.moves({ verbose: true });
      const match    = allMoves.find(m => m.from === selectedSquare && m.to === square);

      if (match) {
        if (match.flags.includes('p')) {
          setPromotionPending({ from: selectedSquare, to: square });
          return;
        }
        applyMove({ from: selectedSquare, to: square })
          .then(r => { if (r && !chessRef.current.isGameOver()) triggerAI(); });
        return;
      }

      const piece = chess.get(square);
      if (piece && piece.color === 'w') {
        setSelectedSquare(square);
        setLegalMoves(getLegalMovesFor(square));
        return;
      }
      setSelectedSquare(null);
      setLegalMoves([]);
      return;
    }

    const piece = chess.get(square);
    if (piece && piece.color === 'w') {
      setSelectedSquare(square);
      setLegalMoves(getLegalMovesFor(square));
    }
  }, [isThinking, gameState, viewIndex, selectedSquare, getLegalMovesFor, applyMove, triggerAI]);

  // ── Promotion ─────────────────────────────────────────────────────────────
  const handlePromotion = useCallback((piece) => {
    const { from, to } = promotionPending;
    setPromotionPending(null);
    applyMove({ from, to, promotion: piece })
      .then(r => { if (r && !chessRef.current.isGameOver()) triggerAI(); });
  }, [promotionPending, applyMove, triggerAI]);

  // ── Undo ──────────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (isThinking || viewIndex !== null) return;
    const chess = chessRef.current;
    if (chess.history().length === 0) return;

    const toUndo = Math.min(chess.turn() === 'w' ? 2 : 1, chess.history().length);

    // Undo captured pieces from live arrays
    const lastMoves = movesRef.current.slice(-toUndo);
    lastMoves.forEach(m => {
      if (m.moveObj?.captured) {
        if (m.color === 'b') setCapturedByBlack(prev => prev.slice(0, -1));
        else                 setCapturedByWhite(prev => prev.slice(0, -1));
      }
    });

    for (let i = 0; i < toUndo; i++) chess.undo();

    const hist        = chess.history({ verbose: true });
    const lastH       = hist.length > 0 ? hist[hist.length - 1] : null;
    setLastMove(lastH ? { from: lastH.from, to: lastH.to } : null);
    setMoves(prev => prev.slice(0, prev.length - toUndo));
    setSelectedSquare(null);
    setLegalMoves([]);
    setMoveQualityPopup(null);
    setHintState(null);
    setThreatsData(null);
    syncBoard();
    refreshEval();
  }, [isThinking, viewIndex, syncBoard, refreshEval]);

  // ── New game ──────────────────────────────────────────────────────────────
  const handleNewGame = useCallback(() => {
    chessRef.current = new Chess();
    setBoard(chessRef.current.board());
    setSelectedSquare(null);
    setLegalMoves([]);
    setLastMove(null);
    setEvaluation(0);
    setMoves([]);
    setCapturedByWhite([]);
    setCapturedByBlack([]);
    setIsThinking(false);
    setGameState('playing');
    setPromotionPending(null);
    setMoveQualityPopup(null);
    setHintState(null);
    setThreatsData(null);
    setViewIndex(null);
  }, []);

  // ── ELO ───────────────────────────────────────────────────────────────────
  const setElo = useCallback((val) => {
    eloRef.current = val;
    setEloState(val);
  }, []);

  // ── Move quality toggle ───────────────────────────────────────────────────
  const toggleMoveQuality = useCallback(() => {
    setShowMoveQuality(prev => {
      const next = !prev;
      showQualityRef.current = next;

      if (next) {
        // Retroactively classify unclassified moves
        setMoves(snapshot => {
          snapshot.filter(m => m.quality === null).forEach(entry => {
            classifyEntryAsync(
              entry.id, entry.prevFen, entry.postFen, entry.color, entry.moveObj
            );
          });
          return snapshot;
        });
      }

      return next;
    });
  }, [classifyEntryAsync]);

  // ── Threats: single-use ───────────────────────────────────────────────────
  const handleThreats = useCallback(() => {
    if (threatsData) {
      // Toggle off
      setThreatsData(null);
    } else {
      const data = computeThreats(chessRef.current);
      setThreatsData(data);
    }
  }, [threatsData]);

  // ── Hint ──────────────────────────────────────────────────────────────────
  const handleHint = useCallback(async () => {
    if (isThinking || gameState !== 'playing' || viewIndex !== null) return;

    if (hintState?.step === 1) {
      setHintState(h => h ? { ...h, step: 2 } : null);
      return;
    }

    setHintLoading(true);
    try {
      const uciMove = await sf.getHint(chessRef.current.fen());
      const spec    = uciToSpec(uciMove);
      if (spec) setHintState({ step: 1, from: spec.from, to: spec.to });
    } finally {
      setHintLoading(false);
    }
  }, [isThinking, gameState, viewIndex, hintState, sf]);

  // ── Position scrubbing ────────────────────────────────────────────────────
  const handleScrubLeft = useCallback(() => {
    setViewIndex(prev => {
      if (prev === null) {
        // Enter review at last move
        const len = movesRef.current.length;
        return len > 0 ? len - 2 : null; // go back one ply
      }
      return prev > 0 ? prev - 1 : 0;
    });
  }, []);

  const handleScrubRight = useCallback(() => {
    setViewIndex(prev => {
      if (prev === null) return null; // already at live
      const len = movesRef.current.length;
      if (prev >= len - 1) return null; // reached end → back to live
      return prev + 1;
    });
  }, []);

  // Keyboard left/right
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft')  handleScrubLeft();
      if (e.key === 'ArrowRight') handleScrubRight();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleScrubLeft, handleScrubRight]);

  // ── Derived: viewed position ──────────────────────────────────────────────
  // When in review mode, reconstruct board state from FEN at that move index.
  const viewedBoard = useMemo(() => {
    if (viewIndex === null) return board;
    const entry = moves[viewIndex];
    if (!entry) return board;
    const tmp = new Chess(entry.postFen);
    return tmp.board();
  }, [viewIndex, moves, board]);

  const viewedLastMove = useMemo(() => {
    if (viewIndex === null) return lastMove;
    const entry = moves[viewIndex];
    return entry ? { from: entry.from, to: entry.to } : null;
  }, [viewIndex, moves, lastMove]);

  const viewedCapturesRaw = useMemo(() => {
    if (viewIndex === null) return { byWhite: capturedByWhite, byBlack: capturedByBlack };
    return capturesUpTo(moves, viewIndex);
  }, [viewIndex, moves, capturedByWhite, capturedByBlack]);

  // Sort captured pieces for display
  const sortPieces = (arr) =>
    [...arr].sort((a, b) => MATERIAL_ORDER.indexOf(a) - MATERIAL_ORDER.indexOf(b));

  const displayCapturedByWhite = sortPieces(viewedCapturesRaw.byWhite);
  const displayCapturedByBlack = sortPieces(viewedCapturesRaw.byBlack);

  const materialAdvantage = useMemo(() => {
    const w = viewedCapturesRaw.byWhite.reduce((s, p) => s + (PIECE_VALS[p] ?? 0), 0);
    const b = viewedCapturesRaw.byBlack.reduce((s, p) => s + (PIECE_VALS[p] ?? 0), 0);
    return w - b;
  }, [viewedCapturesRaw]);

  return {
    board: viewedBoard,
    selectedSquare: viewIndex !== null ? null : selectedSquare,
    legalMoves:     viewIndex !== null ? []   : legalMoves,
    lastMove: viewedLastMove,
    evaluation,
    moves,
    elo, showMoveQuality, isThinking, gameState,
    promotionPending, moveQualityPopup,
    // Threats (single-use)
    threats: threatsData ?? { threatened: new Set(), attackerSquares: new Set(), arrows: [], threatText: '' },
    threatsActive: !!threatsData,
    // Hint
    hintState, hintLoading,
    // Material
    capturedByWhite: displayCapturedByWhite,
    capturedByBlack: displayCapturedByBlack,
    materialAdvantage,
    // Scrubbing
    viewIndex,
    totalMoves: moves.length,
    // Actions
    handleSquareClick, handlePromotion, handleUndo, handleNewGame,
    setElo, toggleMoveQuality, handleThreats, handleHint,
    handleScrubLeft, handleScrubRight,
  };
}
