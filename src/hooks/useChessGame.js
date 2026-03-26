import { useState, useRef, useCallback, useEffect } from 'react';
import { Chess } from 'chess.js';
import ChessWorker from '../workers/chessEngine.worker.js?worker';

let msgIdCounter = 0;
const nextId = () => ++msgIdCounter;

let moveIdCounter = 0;
const nextMoveId = () => ++moveIdCounter;

export function useChessGame() {
  const chessRef   = useRef(new Chess());
  const workerRef  = useRef(null);
  const pendingRef = useRef({});  // msgId → resolve

  // ── UI state ─────────────────────────────────────────────────────────────
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

  const eloRef         = useRef(1200);
  const showQualityRef = useRef(false);

  // ── Worker ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const w = new ChessWorker();
    workerRef.current = w;
    w.onmessage = (e) => {
      const { id, ...payload } = e.data;
      if (id !== undefined && pendingRef.current[id]) {
        pendingRef.current[id](payload);
        delete pendingRef.current[id];
      }
    };
    return () => w.terminate();
  }, []);

  const workerCall = useCallback((msg) => {
    return new Promise((resolve) => {
      const id = nextId();
      pendingRef.current[id] = resolve;
      workerRef.current.postMessage({ ...msg, id });
    });
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const syncBoard = useCallback(() => {
    const c = chessRef.current;
    setBoard(c.board());
    if      (c.isCheckmate()) setGameState('checkmate');
    else if (c.isStalemate()) setGameState('stalemate');
    else if (c.isDraw())      setGameState('draw');
    else                      setGameState('playing');
  }, []);

  const refreshEval = useCallback(async () => {
    if (!workerRef.current) return;
    const res = await workerCall({ type: 'evaluatePosition', fen: chessRef.current.fen() });
    setEvaluation(res.score);
  }, [workerCall]);

  const getLegalMovesFor = useCallback((sq) =>
    chessRef.current.moves({ verbose: true }).filter(m => m.from === sq),
  []);

  // Classify a single move entry; returns the quality string
  const classifyEntry = useCallback((entry) =>
    workerCall({ type: 'classifyMove', prevFen: entry.prevFen, moveSan: entry.san })
      .then(r => r.quality),
  [workerCall]);

  // ── Apply a half-move ─────────────────────────────────────────────────────
  const applyMove = useCallback(async (moveSpec, isAI = false) => {
    const chess  = chessRef.current;
    const result = chess.move(moveSpec);
    if (!result) return null;

    // chess.js v1.x provides result.before (FEN before the move)
    const prevFen = result.before ?? chessRef.current.fen(); // fallback just in case

    const moveId = nextMoveId();
    const entry  = {
      id:      moveId,
      san:     result.san,
      from:    result.from,
      to:      result.to,
      color:   isAI ? 'b' : 'w',
      prevFen,
      quality: null,
    };

    setMoves(prev => [...prev, entry]);
    setLastMove({ from: result.from, to: result.to });
    setSelectedSquare(null);
    setLegalMoves([]);
    syncBoard();
    refreshEval();

    // Async quality classification (only when toggle is on)
    if (showQualityRef.current) {
      classifyEntry(entry).then(quality => {
        setMoves(prev => prev.map(m => m.id === moveId ? { ...m, quality } : m));
        setMoveQualityPopup({ quality, visible: true });
        setTimeout(() => setMoveQualityPopup(p => p ? { ...p, visible: false } : null), 1800);
        setTimeout(() => setMoveQualityPopup(null), 2200);
      });
    }

    return result;
  }, [syncBoard, refreshEval, classifyEntry]);

  // ── AI turn ───────────────────────────────────────────────────────────────
  const triggerAI = useCallback(async () => {
    const chess = chessRef.current;
    if (chess.isGameOver()) return;
    setIsThinking(true);
    try {
      const res = await workerCall({ type: 'findBestMove', fen: chess.fen(), elo: eloRef.current });
      if (res.move && !chessRef.current.isGameOver()) await applyMove(res.move, true);
    } finally {
      setIsThinking(false);
    }
  }, [workerCall, applyMove]);

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

    // turn==='w' → AI (black) just moved → undo 2; turn==='b' → player just moved → undo 1
    const toUndo = Math.min(chess.turn() === 'w' ? 2 : 1, chess.history().length);
    for (let i = 0; i < toUndo; i++) chess.undo();

    const hist        = chess.history({ verbose: true });
    const lastHistMove = hist.length > 0 ? hist[hist.length - 1] : null;
    setLastMove(lastHistMove ? { from: lastHistMove.from, to: lastHistMove.to } : null);
    setMoves(prev => prev.slice(0, prev.length - toUndo));
    setSelectedSquare(null);
    setLegalMoves([]);
    setMoveQualityPopup(null);
    syncBoard();
    refreshEval();
  }, [isThinking, syncBoard, refreshEval]);

  // ── New game ──────────────────────────────────────────────────────────────
  const handleNewGame = useCallback(() => {
    chessRef.current = new Chess();
    setBoard(chessRef.current.board());
    setSelectedSquare(null);
    setLegalMoves([]);
    setLastMove(null);
    setEvaluation(0);
    setMoves([]);
    setIsThinking(false);
    setGameState('playing');
    setPromotionPending(null);
    setMoveQualityPopup(null);
  }, []);

  // ── ELO setter ────────────────────────────────────────────────────────────
  const setElo = useCallback((val) => {
    eloRef.current = val;
    setEloState(val);
  }, []);

  // ── Move quality toggle — retroactively classifies existing unclassified moves
  const toggleMoveQuality = useCallback(() => {
    setShowMoveQuality(prev => {
      const next = !prev;
      showQualityRef.current = next;

      if (next) {
        // Retroactively classify all moves that have no quality yet
        setMoves(snapshot => {
          const unclassified = snapshot.filter(m => m.quality === null);
          unclassified.forEach(entry => {
            workerCall({ type: 'classifyMove', prevFen: entry.prevFen, moveSan: entry.san })
              .then(({ quality }) => {
                setMoves(prev => prev.map(m => m.id === entry.id ? { ...m, quality } : m));
              });
          });
          return snapshot; // state unchanged right now; updates come in async
        });
      }

      return next;
    });
  }, [workerCall]);

  return {
    board, selectedSquare, legalMoves, lastMove, evaluation,
    moves, elo, showMoveQuality, isThinking, gameState,
    promotionPending, moveQualityPopup,
    handleSquareClick, handlePromotion, handleUndo, handleNewGame,
    setElo, toggleMoveQuality,
  };
}
