import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Chess } from 'chess.js';
import { useStockfish } from './useStockfish';
import { classifyMove, moveAccuracy, calcGameAccuracy } from '../utils/moveQuality';
import { computeThreats } from '../utils/threats';

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

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Pick a random legal move as fallback when engine is unavailable.
function randomLegalMove(chess) {
  const all = chess.moves({ verbose: true });
  if (!all.length) return null;
  const m = all[Math.floor(Math.random() * all.length)];
  return { from: m.from, to: m.to, ...(m.promotion ? { promotion: 'q' } : {}) };
}

// Rebuild captured-piece arrays from move history up to index `upTo` (inclusive).
// White captures = black pieces white took; Black captures = white pieces black took.
function capturesUpTo(moves, upTo) {
  const byWhite = [], byBlack = [];
  for (let i = 0; i <= upTo && i < moves.length; i++) {
    const { moveObj } = moves[i];
    if (!moveObj?.captured) continue;
    if (moveObj.color === 'w') byWhite.push(moveObj.captured);
    else                       byBlack.push(moveObj.captured);
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
  const [engineError,      setEngineError]      = useState(null);
  const [accuracySummary,  setAccuracySummary]  = useState(null);

  // ── Player color ('w' = human plays White; 'b' = human plays Black) ───────
  const [playerColor, setPlayerColor] = useState('w');
  const playerColorRef = useRef('w');

  // ── Live captured pieces ──────────────────────────────────────────────────
  const [capturedByWhite, setCapturedByWhite] = useState([]);
  const [capturedByBlack, setCapturedByBlack] = useState([]);

  // ── FEN history for scrubbing ─────────────────────────────────────────────
  // fenHistory[0] = starting position; fenHistory[i] = position after move i
  const [fenHistory, setFenHistory] = useState([INITIAL_FEN]);

  // ── Threats: single-use ───────────────────────────────────────────────────
  const [threatsData, setThreatsData] = useState(null);

  // ── Hint (2-click) ────────────────────────────────────────────────────────
  const [hintState,   setHintState]   = useState(null);
  const [hintLoading, setHintLoading] = useState(false);

  // ── Position scrubbing ────────────────────────────────────────────────────
  // viewIndex: null = live; 0..fenHistory.length-1 = review
  const [viewIndex, setViewIndex] = useState(null);

  // Stable refs
  const eloRef         = useRef(1200);
  const showQualityRef = useRef(false);
  const movesRef       = useRef([]);
  const triggerAIRef   = useRef(null); // filled below

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

  const refreshEval = useCallback(() => {
    const fen = chessRef.current.fen();
    sf.evaluatePosition(fen, 10).then(score => setEvaluation(score ?? 0));
  }, [sf]);

  const getLegalMovesFor = useCallback((sq) =>
    chessRef.current.moves({ verbose: true }).filter(m => m.from === sq),
  []);

  // ── Async quality + accuracy classification ───────────────────────────────
  const classifyEntryAsync = useCallback((moveId, prevFen, postFen, color, moveObj) => {
    const moverIsWhite = color === 'w';
    Promise.all([
      sf.evaluateWithMultiPV(prevFen),
      sf.evaluatePosition(postFen, 10),
    ]).then(([{ bestCp, secondCp }, evalAfter]) => {
      const quality  = classifyMove(bestCp, secondCp, evalAfter, moverIsWhite, moveObj);
      const accuracy = moveAccuracy(bestCp, evalAfter, moverIsWhite);
      setMoves(prev => prev.map(m => m.id === moveId ? { ...m, quality, accuracy } : m));
      setMoveQualityPopup({ quality, visible: true });
      setTimeout(() => setMoveQualityPopup(p => p ? { ...p, visible: false } : null), 1800);
      setTimeout(() => setMoveQualityPopup(null), 2200);
    }).catch(() => {}); // quality is cosmetic — never crash on failure
  }, [sf]);

  // ── Apply a half-move ─────────────────────────────────────────────────────
  const applyMove = useCallback((moveSpec) => {
    const chess  = chessRef.current;
    const prevFen = chess.fen();
    const result  = chess.move(moveSpec);
    if (!result) return null;

    const postFen = chess.fen();
    const moveId  = nextMoveId();

    // Capture tracking — based on which color moved (not player/AI)
    if (result.captured) {
      if (result.color === 'w') setCapturedByWhite(prev => [...prev, result.captured]);
      else                      setCapturedByBlack(prev => [...prev, result.captured]);
    }

    const entry = {
      id: moveId, san: result.san,
      from: result.from, to: result.to,
      color: result.color,
      prevFen, postFen, moveObj: result, quality: null,
    };

    setMoves(prev => [...prev, entry]);
    setFenHistory(prev => [...prev, postFen]);
    setLastMove({ from: result.from, to: result.to });
    setSelectedSquare(null);
    setLegalMoves([]);
    setHintState(null);
    setThreatsData(null);  // threats are single-use
    setViewIndex(null);    // return to live on new move
    syncBoard();
    refreshEval();

    if (showQualityRef.current) {
      classifyEntryAsync(moveId, prevFen, postFen, result.color, result);
    }

    return result;
  }, [syncBoard, refreshEval, classifyEntryAsync]);

  // ── AI turn ───────────────────────────────────────────────────────────────
  const triggerAI = useCallback(async () => {
    const chess = chessRef.current;
    if (chess.isGameOver()) return;
    setIsThinking(true);
    try {
      const uciMove = await sf.findBestMove(chess.fen(), eloRef.current);
      let spec = uciToSpec(uciMove);

      if (!spec) {
        // Engine failed or timed out — play a random legal move so game stays alive
        spec = randomLegalMove(chess);
        if (spec) {
          setEngineError('Engine unavailable — played random move');
          setTimeout(() => setEngineError(null), 4000);
        }
      }

      if (spec && !chess.isGameOver()) applyMove(spec);
    } catch (e) {
      console.error('[triggerAI] error:', e);
    } finally {
      setIsThinking(false);
    }
  }, [sf, applyMove]);

  // Keep ref in sync so the auto-trigger effect always calls the latest version.
  triggerAIRef.current = triggerAI;

  // Auto-trigger AI whenever it becomes the AI's turn (handles initial AI-first case too).
  useEffect(() => {
    if (gameState !== 'playing' || isThinking || viewIndex !== null) return;
    if (chessRef.current.turn() !== playerColorRef.current) {
      triggerAIRef.current?.();
    }
  }, [board, gameState, isThinking, viewIndex]);

  // ── Square click ──────────────────────────────────────────────────────────
  const handleSquareClick = useCallback((square) => {
    const chess = chessRef.current;
    if (isThinking || gameState !== 'playing' || viewIndex !== null) return;
    if (chess.turn() !== playerColorRef.current) return;

    if (selectedSquare) {
      const allMoves = chess.moves({ verbose: true });
      const match    = allMoves.find(m => m.from === selectedSquare && m.to === square);

      if (match) {
        if (match.flags.includes('p')) {
          setPromotionPending({ from: selectedSquare, to: square });
          return;
        }
        applyMove({ from: selectedSquare, to: square });
        return;
      }

      const piece = chess.get(square);
      if (piece && piece.color === playerColorRef.current) {
        setSelectedSquare(square);
        setLegalMoves(getLegalMovesFor(square));
        return;
      }
      setSelectedSquare(null);
      setLegalMoves([]);
      return;
    }

    const piece = chess.get(square);
    if (piece && piece.color === playerColorRef.current) {
      setSelectedSquare(square);
      setLegalMoves(getLegalMovesFor(square));
    }
  }, [isThinking, gameState, viewIndex, selectedSquare, getLegalMovesFor, applyMove]);

  // ── Promotion ─────────────────────────────────────────────────────────────
  const handlePromotion = useCallback((piece) => {
    const { from, to } = promotionPending;
    setPromotionPending(null);
    applyMove({ from, to, promotion: piece });
  }, [promotionPending, applyMove]);

  // ── Undo ──────────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (isThinking || viewIndex !== null) return;
    const chess = chessRef.current;
    if (chess.history().length === 0) return;

    // Undo 2 half-moves if it's the player's turn (undo player move + AI response)
    const toUndo = chess.turn() === playerColorRef.current
      ? Math.min(2, chess.history().length)
      : Math.min(1, chess.history().length);

    const lastMoves = movesRef.current.slice(-toUndo);
    lastMoves.forEach(m => {
      if (m.moveObj?.captured) {
        if (m.moveObj.color === 'w') setCapturedByWhite(prev => prev.slice(0, -1));
        else                         setCapturedByBlack(prev => prev.slice(0, -1));
      }
    });

    for (let i = 0; i < toUndo; i++) chess.undo();

    const hist  = chess.history({ verbose: true });
    const lastH = hist.length > 0 ? hist[hist.length - 1] : null;
    setLastMove(lastH ? { from: lastH.from, to: lastH.to } : null);
    setMoves(prev => prev.slice(0, prev.length - toUndo));
    setFenHistory(prev => prev.slice(0, prev.length - toUndo));
    setSelectedSquare(null);
    setLegalMoves([]);
    setMoveQualityPopup(null);
    setHintState(null);
    setThreatsData(null);
    syncBoard();
    refreshEval();
  }, [isThinking, viewIndex, syncBoard, refreshEval]);

  // ── New Game ───────────────────────────────────────────────────────────────
  // params: { color: 'w'|'b', elo: number }
  const handleNewGame = useCallback((params = {}) => {
    const newColor = params.color ?? 'w';
    const newElo   = params.elo   ?? eloRef.current;

    playerColorRef.current = newColor;
    setPlayerColor(newColor);
    eloRef.current = newElo;
    setEloState(newElo);

    chessRef.current = new Chess();
    setBoard(chessRef.current.board());
    setSelectedSquare(null);
    setLegalMoves([]);
    setLastMove(null);
    setEvaluation(0);
    setMoves([]);
    setCapturedByWhite([]);
    setCapturedByBlack([]);
    setFenHistory([INITIAL_FEN]);
    setIsThinking(false);
    setGameState('playing');
    setPromotionPending(null);
    setMoveQualityPopup(null);
    setHintState(null);
    setThreatsData(null);
    setViewIndex(null);
    setEngineError(null);
    setAccuracySummary(null);
    // If player is Black, the AI-auto-trigger effect will fire on the next render
    // because chess.turn() === 'w' !== playerColorRef.current ('b').
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
        setMoves(snapshot => {
          snapshot.filter(m => m.quality === null).forEach(entry => {
            classifyEntryAsync(entry.id, entry.prevFen, entry.postFen, entry.color, entry.moveObj);
          });
          return snapshot;
        });
      }
      return next;
    });
  }, [classifyEntryAsync]);

  // ── Threats: single-use ───────────────────────────────────────────────────
  const handleThreats = useCallback(() => {
    if (threatsData) { setThreatsData(null); return; }
    // Compute threats for the currently displayed position
    const chessTmp = viewIndex !== null
      ? new Chess(fenHistory[viewIndex] || chessRef.current.fen())
      : chessRef.current;
    setThreatsData(computeThreats(chessTmp));
  }, [threatsData, viewIndex, fenHistory]);

  // ── Hint (2-click) ────────────────────────────────────────────────────────
  const handleHint = useCallback(async () => {
    if (isThinking || gameState !== 'playing' || viewIndex !== null) return;
    if (hintState?.step === 1) { setHintState(h => h ? { ...h, step: 2 } : null); return; }

    setHintLoading(true);
    try {
      const uciMove = await sf.getHint(chessRef.current.fen());
      const spec    = uciToSpec(uciMove);
      if (spec) setHintState({ step: 1, from: spec.from, to: spec.to });
    } catch (_) {}
    finally { setHintLoading(false); }
  }, [isThinking, gameState, viewIndex, hintState, sf]);

  // ── Game accuracy (computed when game ends + all player moves classified) ──
  useEffect(() => {
    if (gameState === 'playing' || !showMoveQuality) return;
    const playerMoves = moves.filter(m => m.color === playerColorRef.current);
    if (!playerMoves.length) return;
    const classified = playerMoves.filter(m => m.accuracy != null);
    if (classified.length === playerMoves.length) {
      setAccuracySummary(calcGameAccuracy(classified.map(m => m.accuracy)));
    }
  }, [moves, gameState, showMoveQuality]);

  // ── Position scrubbing ────────────────────────────────────────────────────
  // fenHistory[0] = start; fenHistory[i] = after move i.
  // viewIndex = null → live; viewIndex = 0..n → review that position.

  const handleScrubLeft = useCallback(() => {
    setViewIndex(prev => {
      const len = fenHistory.length; // includes initial position
      if (prev === null) {
        // Enter review: go one step back from live
        return len >= 2 ? len - 2 : 0;
      }
      return Math.max(0, prev - 1);
    });
  }, [fenHistory.length]);

  const handleScrubRight = useCallback(() => {
    setViewIndex(prev => {
      if (prev === null) return null; // already live
      const last = fenHistory.length - 1;
      if (prev >= last) return null;  // at or past last history → back to live
      return prev + 1;
    });
  }, [fenHistory.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      if (e.key === 'ArrowLeft')  handleScrubLeft();
      if (e.key === 'ArrowRight') handleScrubRight();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleScrubLeft, handleScrubRight]);

  // ── Derived: viewed position (review vs live) ─────────────────────────────
  const viewedBoard = useMemo(() => {
    if (viewIndex === null) return board;
    const fen = fenHistory[viewIndex];
    if (!fen) return board;
    return new Chess(fen).board();
  }, [viewIndex, fenHistory, board]);

  const viewedLastMove = useMemo(() => {
    if (viewIndex === null) return lastMove;
    if (viewIndex === 0)    return null;              // starting position
    const m = moves[viewIndex - 1];
    return m ? { from: m.from, to: m.to } : null;
  }, [viewIndex, moves, lastMove]);

  const viewedCaptures = useMemo(() => {
    if (viewIndex === null) return { byWhite: capturedByWhite, byBlack: capturedByBlack };
    if (viewIndex === 0)    return { byWhite: [], byBlack: [] };
    return capturesUpTo(moves, viewIndex - 1);
  }, [viewIndex, moves, capturedByWhite, capturedByBlack]);

  const sortPieces = (arr) =>
    [...arr].sort((a, b) => MATERIAL_ORDER.indexOf(a) - MATERIAL_ORDER.indexOf(b));

  const materialAdvantage = useMemo(() => {
    const w = viewedCaptures.byWhite.reduce((s, p) => s + (PIECE_VALS[p] ?? 0), 0);
    const b = viewedCaptures.byBlack.reduce((s, p) => s + (PIECE_VALS[p] ?? 0), 0);
    return w - b;
  }, [viewedCaptures]);

  return {
    board: viewedBoard,
    selectedSquare: viewIndex !== null ? null : selectedSquare,
    legalMoves:     viewIndex !== null ? []   : legalMoves,
    lastMove:  viewedLastMove,
    evaluation, moves, elo, showMoveQuality, isThinking, gameState,
    promotionPending, moveQualityPopup, engineError, playerColor, accuracySummary,
    // Threats (single-use)
    threats:      threatsData ?? { threatened: new Set(), attackerSquares: new Set(), arrows: [], threatText: '' },
    threatsActive: !!threatsData,
    // Hint
    hintState, hintLoading,
    // Material
    capturedByWhite: sortPieces(viewedCaptures.byWhite),
    capturedByBlack: sortPieces(viewedCaptures.byBlack),
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
