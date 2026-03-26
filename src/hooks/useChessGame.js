import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Chess } from 'chess.js';
import { useStockfish } from './useStockfish';
import { classifyMove } from '../utils/moveQuality';
import { computeThreats } from '../utils/threats';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

let moveIdCounter = 0;
const nextMoveId = () => ++moveIdCounter;

// Convert UCI move string (e.g. 'e2e4', 'e7e8q') to chess.js move spec
function uciToSpec(uci) {
  if (!uci || uci.length < 4) return null;
  return {
    from: uci.slice(0, 2),
    to:   uci.slice(2, 4),
    ...(uci.length === 5 ? { promotion: uci[4] } : {}),
  };
}

// Material piece ordering for display (descending value)
const MATERIAL_ORDER = ['q', 'r', 'b', 'n', 'p'];

export function useChessGame() {
  const chessRef = useRef(new Chess());
  const sf       = useStockfish();   // Stockfish engine

  // ── Core game state ───────────────────────────────────────────────────────
  const [board,            setBoard]            = useState(() => chessRef.current.board());
  const [selectedSquare,   setSelectedSquare]   = useState(null);
  const [legalMoves,       setLegalMoves]       = useState([]);
  const [lastMove,         setLastMove]         = useState(null);    // {from, to}
  const [evaluation,       setEvaluation]       = useState(0);       // cp, White POV
  const [moves,            setMoves]            = useState([]);       // move entries
  const [elo,              setEloState]         = useState(1200);
  const [showMoveQuality,  setShowMoveQuality]  = useState(false);
  const [isThinking,       setIsThinking]       = useState(false);
  const [gameState,        setGameState]        = useState('playing');
  const [promotionPending, setPromotionPending] = useState(null);
  const [moveQualityPopup, setMoveQualityPopup] = useState(null);

  // ── Captured pieces ───────────────────────────────────────────────────────
  const [capturedByWhite, setCapturedByWhite] = useState([]); // pieces white captured
  const [capturedByBlack, setCapturedByBlack] = useState([]); // pieces black captured

  // ── Threats ───────────────────────────────────────────────────────────────
  const [showThreats, setShowThreats] = useState(false);
  const threats = useMemo(() => {
    if (!showThreats) return { threatened: new Set(), attackerSquares: new Set(), arrows: [], threatText: '' };
    return computeThreats(chessRef.current);
  }, [showThreats, board]); // re-compute when board changes

  // ── Hint (2-click) ────────────────────────────────────────────────────────
  const [hintState, setHintState] = useState(null); // null | {step:1,from} | {step:2,from,to}
  const [hintLoading, setHintLoading] = useState(false);

  // Stable refs
  const eloRef         = useRef(1200);
  const showQualityRef = useRef(false);

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

    // Captured piece tracking
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
    setHintState(null); // reset hint on any move
    syncBoard();
    refreshEval();

    // Async quality classification
    if (showQualityRef.current) {
      const moverIsWhite = !isAI;
      Promise.all([
        sf.evaluateForQuality(prevFen),  // eval before move (White POV)
        sf.evaluateForQuality(postFen),  // eval after move (White POV)
      ]).then(([evalBefore, evalAfter]) => {
        const quality = classifyMove(evalBefore, evalAfter, moverIsWhite, result);
        setMoves(prev => prev.map(m => m.id === moveId ? { ...m, quality } : m));
        setMoveQualityPopup({ quality, visible: true });
        setTimeout(() => setMoveQualityPopup(p => p ? { ...p, visible: false } : null), 1800);
        setTimeout(() => setMoveQualityPopup(null), 2200);
      });
    }

    return result;
  }, [syncBoard, refreshEval, sf]);

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
  }, [isThinking, gameState, selectedSquare, getLegalMovesFor, applyMove, triggerAI]);

  // ── Promotion ─────────────────────────────────────────────────────────────
  const handlePromotion = useCallback((piece) => {
    const { from, to } = promotionPending;
    setPromotionPending(null);
    applyMove({ from, to, promotion: piece })
      .then(r => { if (r && !chessRef.current.isGameOver()) triggerAI(); });
  }, [promotionPending, applyMove, triggerAI]);

  // ── Undo ──────────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (isThinking) return;
    const chess = chessRef.current;
    if (chess.history().length === 0) return;

    const toUndo = Math.min(chess.turn() === 'w' ? 2 : 1, chess.history().length);

    // Undo captured pieces
    const lastMoves = moves.slice(-toUndo);
    lastMoves.forEach(m => {
      if (m.moveObj?.captured) {
        if (m.color === 'b') setCapturedByBlack(prev => prev.slice(0, -1));
        else                 setCapturedByWhite(prev => prev.slice(0, -1));
      }
    });

    for (let i = 0; i < toUndo; i++) chess.undo();

    const hist         = chess.history({ verbose: true });
    const lastHistMove = hist.length > 0 ? hist[hist.length - 1] : null;
    setLastMove(lastHistMove ? { from: lastHistMove.from, to: lastHistMove.to } : null);
    setMoves(prev => prev.slice(0, prev.length - toUndo));
    setSelectedSquare(null);
    setLegalMoves([]);
    setMoveQualityPopup(null);
    setHintState(null);
    syncBoard();
    refreshEval();
  }, [isThinking, moves, syncBoard, refreshEval]);

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
        // Retroactively classify all unclassified moves
        setMoves(snapshot => {
          snapshot.filter(m => m.quality === null).forEach(entry => {
            const moverIsWhite = entry.color === 'w';
            Promise.all([
              sf.evaluateForQuality(entry.prevFen),
              sf.evaluateForQuality(entry.postFen),
            ]).then(([evalBefore, evalAfter]) => {
              const quality = classifyMove(evalBefore, evalAfter, moverIsWhite, entry.moveObj);
              setMoves(prev => prev.map(m => m.id === entry.id ? { ...m, quality } : m));
            });
          });
          return snapshot;
        });
      }

      return next;
    });
  }, [sf]);

  // ── Threats toggle ────────────────────────────────────────────────────────
  const toggleThreats = useCallback(() => setShowThreats(p => !p), []);

  // ── Hint ──────────────────────────────────────────────────────────────────
  const handleHint = useCallback(async () => {
    if (isThinking || gameState !== 'playing') return;

    if (hintState?.step === 1) {
      // Second click: reveal destination
      setHintState(h => h ? { ...h, step: 2 } : null);
      return;
    }

    // First click: ask Stockfish for best move, show source square
    setHintLoading(true);
    try {
      const uciMove = await sf.getHint(chessRef.current.fen());
      const spec    = uciToSpec(uciMove);
      if (spec) setHintState({ step: 1, from: spec.from, to: spec.to });
    } finally {
      setHintLoading(false);
    }
  }, [isThinking, gameState, hintState, sf]);

  // ── Derived material advantage ────────────────────────────────────────────
  const materialAdvantage = useMemo(() => {
    const VALS = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const w = capturedByWhite.reduce((s, p) => s + (VALS[p] ?? 0), 0);
    const b = capturedByBlack.reduce((s, p) => s + (VALS[p] ?? 0), 0);
    return w - b; // positive = white captured more
  }, [capturedByWhite, capturedByBlack]);

  // Sort captured pieces for display (most valuable first)
  const sortedCapturedByWhite = useMemo(() =>
    [...capturedByWhite].sort((a, b) => MATERIAL_ORDER.indexOf(a) - MATERIAL_ORDER.indexOf(b)),
  [capturedByWhite]);

  const sortedCapturedByBlack = useMemo(() =>
    [...capturedByBlack].sort((a, b) => MATERIAL_ORDER.indexOf(a) - MATERIAL_ORDER.indexOf(b)),
  [capturedByBlack]);

  return {
    board, selectedSquare, legalMoves, lastMove, evaluation,
    moves, elo, showMoveQuality, isThinking, gameState,
    promotionPending, moveQualityPopup,
    // Threats
    showThreats, threats,
    // Hint
    hintState, hintLoading,
    // Material
    capturedByWhite: sortedCapturedByWhite,
    capturedByBlack: sortedCapturedByBlack,
    materialAdvantage,
    // Actions
    handleSquareClick, handlePromotion, handleUndo, handleNewGame,
    setElo, toggleMoveQuality, toggleThreats, handleHint,
  };
}
