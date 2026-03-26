import { useState, useRef, useCallback, useEffect } from 'react';
import { Chess } from 'chess.js';
import ChessWorker from '../workers/chessEngine.worker.js?worker';

let msgIdCounter = 0;
const nextId = () => ++msgIdCounter;

// Each move entry gets a stable numeric id so async quality updates can find it
let moveIdCounter = 0;
const nextMoveId = () => ++moveIdCounter;

export function useChessGame() {
  const chessRef  = useRef(new Chess());
  const workerRef = useRef(null);
  // Map of pending worker message id → resolve function
  const pendingRef = useRef({});

  // ── UI state ─────────────────────────────────────────────────────────────
  const [board,            setBoard]            = useState(() => chessRef.current.board());
  const [selectedSquare,   setSelectedSquare]   = useState(null);
  const [legalMoves,       setLegalMoves]       = useState([]);
  const [lastMove,         setLastMove]         = useState(null);   // {from, to}
  const [evaluation,       setEvaluation]       = useState(0);
  const [moves,            setMoves]            = useState([]);     // move entries
  const [elo,              setEloState]         = useState(1200);
  const [showMoveQuality,  setShowMoveQuality]  = useState(false);
  const [isThinking,       setIsThinking]       = useState(false);
  const [gameState,        setGameState]        = useState('playing');
  const [promotionPending, setPromotionPending] = useState(null);
  const [moveQualityPopup, setMoveQualityPopup] = useState(null);

  // Stable refs so closures always read current values
  const eloRef         = useRef(1200);
  const showQualityRef = useRef(false);

  // ── Worker setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    const worker = new ChessWorker();
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { id, ...payload } = e.data;
      if (id !== undefined && pendingRef.current[id]) {
        pendingRef.current[id](payload);
        delete pendingRef.current[id];
      }
    };

    return () => worker.terminate();
  }, []);

  // Promise-based worker call
  const workerCall = useCallback((msg) => {
    return new Promise((resolve) => {
      const id = nextId();
      pendingRef.current[id] = resolve;
      workerRef.current.postMessage({ ...msg, id });
    });
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const syncBoard = useCallback(() => {
    const chess = chessRef.current;
    setBoard(chess.board());

    if (chess.isCheckmate())      setGameState('checkmate');
    else if (chess.isStalemate()) setGameState('stalemate');
    else if (chess.isDraw())      setGameState('draw');
    else                          setGameState('playing');
  }, []);

  const refreshEval = useCallback(async () => {
    if (!workerRef.current) return;
    const fen = chessRef.current.fen();
    const res = await workerCall({ type: 'evaluatePosition', fen });
    setEvaluation(res.score);
  }, [workerCall]);

  const getLegalMovesFor = useCallback((square) => {
    return chessRef.current.moves({ verbose: true }).filter(m => m.from === square);
  }, []);

  // ── Apply a single half-move ───────────────────────────────────────────
  const applyMove = useCallback(async (moveSpec, isAI = false) => {
    const chess = chessRef.current;
    const prevFen = chess.fen();

    const result = chess.move(moveSpec);
    if (!result) return null;

    const moveId = nextMoveId();
    const moveEntry = {
      id:      moveId,
      san:     result.san,
      from:    result.from,
      to:      result.to,
      color:   isAI ? 'b' : 'w',
      quality: null,
    };

    setMoves(prev => [...prev, moveEntry]);
    setLastMove({ from: result.from, to: result.to });
    setSelectedSquare(null);
    setLegalMoves([]);
    syncBoard();
    refreshEval();

    // Classify move quality asynchronously if toggle is on
    if (showQualityRef.current) {
      workerCall({ type: 'classifyMove', prevFen, moveSan: result.san }).then(({ quality }) => {
        setMoves(prev => prev.map(m => m.id === moveId ? { ...m, quality } : m));
        setMoveQualityPopup({ quality, visible: true });
        setTimeout(() => setMoveQualityPopup(p => p ? { ...p, visible: false } : null), 1800);
        setTimeout(() => setMoveQualityPopup(null), 2200);
      });
    }

    return result;
  }, [syncBoard, refreshEval, workerCall]);

  // ── AI turn ───────────────────────────────────────────────────────────────
  const triggerAI = useCallback(async () => {
    const chess = chessRef.current;
    if (chess.isGameOver()) return;

    setIsThinking(true);
    try {
      const res = await workerCall({
        type: 'findBestMove',
        fen:  chess.fen(),
        elo:  eloRef.current,
      });

      if (res.move && !chessRef.current.isGameOver()) {
        await applyMove(res.move, true);
      }
    } finally {
      setIsThinking(false);
    }
  }, [workerCall, applyMove]);

  // ── Square click handler ──────────────────────────────────────────────────
  const handleSquareClick = useCallback((square) => {
    const chess = chessRef.current;
    if (isThinking || gameState !== 'playing') return;
    if (chess.turn() !== 'w') return;

    if (selectedSquare) {
      const allMoves = chess.moves({ verbose: true });
      const match = allMoves.find(m => m.from === selectedSquare && m.to === square);

      if (match) {
        if (match.flags.includes('p')) {
          // Promotion — ask user to pick piece
          setPromotionPending({ from: selectedSquare, to: square });
          return;
        }
        applyMove({ from: selectedSquare, to: square }).then(result => {
          if (result && !chessRef.current.isGameOver()) triggerAI();
        });
        return;
      }

      // Re-select another own piece
      const piece = chess.get(square);
      if (piece && piece.color === 'w') {
        setSelectedSquare(square);
        setLegalMoves(getLegalMovesFor(square));
        return;
      }

      // Deselect
      setSelectedSquare(null);
      setLegalMoves([]);
      return;
    }

    // Select own piece
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
    applyMove({ from, to, promotion: piece }).then(result => {
      if (result && !chessRef.current.isGameOver()) triggerAI();
    });
  }, [promotionPending, applyMove, triggerAI]);

  // ── Undo ──────────────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (isThinking) return;
    const chess = chessRef.current;
    if (chess.history().length === 0) return;

    // turn === 'w' → AI (black) just moved → undo 2 half-moves
    // turn === 'b' → player (white) just moved → undo 1 half-move
    const toUndo = Math.min(
      chess.turn() === 'w' ? 2 : 1,
      chess.history().length
    );

    for (let i = 0; i < toUndo; i++) chess.undo();

    const hist = chess.history({ verbose: true });
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

  // ── Move quality toggle ───────────────────────────────────────────────────
  const toggleMoveQuality = useCallback(() => {
    setShowMoveQuality(prev => {
      showQualityRef.current = !prev;
      return !prev;
    });
  }, []);

  return {
    board,
    selectedSquare,
    legalMoves,
    lastMove,
    evaluation,
    moves,
    elo,
    showMoveQuality,
    isThinking,
    gameState,
    promotionPending,
    moveQualityPopup,
    handleSquareClick,
    handlePromotion,
    handleUndo,
    handleNewGame,
    setElo,
    toggleMoveQuality,
  };
}
