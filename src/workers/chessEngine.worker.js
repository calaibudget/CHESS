import { Chess } from 'chess.js';

// ---------------------------------------------------------------------------
// Piece values (centipawns)
// ---------------------------------------------------------------------------
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// ---------------------------------------------------------------------------
// Piece-square tables  (index 0 = a8, 7 = h8, 56 = a1, 63 = h1 — white POV)
// ---------------------------------------------------------------------------
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

// square 'e4' → PST index
function sqToIdx(sq) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]) - 1;
  return (7 - rank) * 8 + file;
}

function pstValue(piece, square) {
  const table = PST[piece.type];
  if (!table) return 0;
  let idx = sqToIdx(square);
  if (piece.color === 'b') {
    // mirror vertically for black
    const rank = Math.floor(idx / 8);
    const file = idx % 8;
    idx = (7 - rank) * 8 + file;
  }
  return table[idx];
}

// ---------------------------------------------------------------------------
// Static evaluation (positive = white winning)
// ---------------------------------------------------------------------------
function evaluate(chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -99999 : 99999;
  if (chess.isDraw())      return 0;

  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const sq = String.fromCharCode(97 + f) + (8 - r);
      const val = PIECE_VALUES[p.type] + pstValue(p, sq);
      score += p.color === 'w' ? val : -val;
    }
  }
  return score;
}

// ---------------------------------------------------------------------------
// Move ordering: captures (MVV-LVA) first, then promotions, then rest
// ---------------------------------------------------------------------------
function scoreMove(m) {
  let s = 0;
  if (m.captured) s += PIECE_VALUES[m.captured] * 10 - PIECE_VALUES[m.piece];
  if (m.promotion === 'q') s += 800;
  return s;
}

function orderedMoves(chess) {
  return chess.moves({ verbose: true })
    .filter(m => !m.promotion || m.promotion === 'q')
    .sort((a, b) => scoreMove(b) - scoreMove(a));
}

// ---------------------------------------------------------------------------
// Negamax with alpha-beta (returns score from CURRENT player's perspective)
// ---------------------------------------------------------------------------
function negamax(chess, depth, alpha, beta) {
  if (depth === 0 || chess.isGameOver()) {
    const e = evaluate(chess);
    return chess.turn() === 'w' ? e : -e;
  }
  const moves = orderedMoves(chess);
  let best = -Infinity;
  for (const m of moves) {
    chess.move(m);
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Find best move for given ELO setting
// ---------------------------------------------------------------------------
const ELO_SETTINGS = {
  400:  { depth: 1, randomness: 0.80, noise: 150 },
  600:  { depth: 1, randomness: 0.60, noise: 100 },
  800:  { depth: 2, randomness: 0.40, noise:  60 },
  1000: { depth: 2, randomness: 0.20, noise:  30 },
  1200: { depth: 3, randomness: 0.08, noise:  15 },
  1400: { depth: 3, randomness: 0.00, noise:   8 },
  1600: { depth: 4, randomness: 0.00, noise:   3 },
  1800: { depth: 4, randomness: 0.00, noise:   0 },
};

function getSettings(elo) {
  const tiers = [400, 600, 800, 1000, 1200, 1400, 1600, 1800];
  const key = tiers.reduce((prev, cur) => (Math.abs(cur - elo) < Math.abs(prev - elo) ? cur : prev));
  return ELO_SETTINGS[key];
}

function findBestMove(chess, elo) {
  const { depth, randomness, noise } = getSettings(elo);
  const moves = orderedMoves(chess);
  if (moves.length === 0) return null;

  // Fully random move (for very weak play)
  if (randomness > 0 && Math.random() < randomness) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let bestMove = null;
  let bestScore = -Infinity;

  for (const m of moves) {
    chess.move(m);
    let score = -negamax(chess, depth - 1, -Infinity, Infinity);
    chess.undo();
    // Add calibrated noise
    score += (Math.random() - 0.5) * noise * 2;
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}

// ---------------------------------------------------------------------------
// Best-move eval at depth 1 — used for move quality classification
// Returns eval (white POV) after the best move from `fen`
// ---------------------------------------------------------------------------
function getBestMoveEvalD1(chess) {
  const moves = orderedMoves(chess);
  if (moves.length === 0) return evaluate(chess);

  if (chess.turn() === 'w') {
    let best = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const e = evaluate(chess);
      chess.undo();
      if (e > best) best = e;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      chess.move(m);
      const e = evaluate(chess);
      chess.undo();
      if (e < best) best = e;
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Quick depth-2 eval for the eval bar
// ---------------------------------------------------------------------------
function quickEval(chess, depth = 2) {
  if (depth === 0 || chess.isGameOver()) return evaluate(chess);
  const moves = orderedMoves(chess);
  if (moves.length === 0) return evaluate(chess);

  if (chess.turn() === 'w') {
    let best = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const e = depth > 1 ? quickEval(chess, depth - 1) : evaluate(chess);
      chess.undo();
      if (e > best) best = e;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      chess.move(m);
      const e = depth > 1 ? quickEval(chess, depth - 1) : evaluate(chess);
      chess.undo();
      if (e < best) best = e;
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Move quality classification
// ---------------------------------------------------------------------------
const QUALITY_THRESHOLDS = [
  { max:   0, label: 'best' },
  { max:  10, label: 'excellent' },
  { max:  25, label: 'good' },
  { max:  60, label: 'inaccuracy' },
  { max: 150, label: 'mistake' },
  { max: Infinity, label: 'blunder' },
];

function classifyByCpLoss(cpLoss) {
  for (const t of QUALITY_THRESHOLDS) {
    if (cpLoss <= t.max) return t.label;
  }
  return 'blunder';
}

function classifyMove(prevFen, moveSan) {
  const chess = new Chess(prevFen);
  const moverIsWhite = chess.turn() === 'w';
  const moveNumber = chess.moveNumber();

  // Get the best eval from prev position (depth-1)
  const bestEval = getBestMoveEvalD1(chess);

  // Make the actual move
  const moveObj = chess.move(moveSan);
  if (!moveObj) return 'good'; // shouldn't happen

  const actualEval = evaluate(chess);

  // cpLoss: how many centipawns the mover lost vs best play
  let cpLoss;
  if (moverIsWhite) {
    cpLoss = Math.max(0, bestEval - actualEval);
  } else {
    cpLoss = Math.max(0, actualEval - bestEval);
  }

  // --- Special categories ---

  // Missed win: had a big advantage, squandered it
  const prevAdvantage = moverIsWhite ? bestEval : -bestEval;
  const afterAdvantage = moverIsWhite ? actualEval : -actualEval;
  if (prevAdvantage > 200 && afterAdvantage < 50 && cpLoss > 150) {
    return 'missed_win';
  }

  // Book move: early game + not bad
  if (moveNumber <= 10 && cpLoss <= 50) {
    return 'book';
  }

  // Brilliant: sacrifice that is the best or near-best move
  if (moveObj.captured && cpLoss <= 5) {
    const capturedVal = PIECE_VALUES[moveObj.captured] || 0;
    const attackerVal = PIECE_VALUES[moveObj.piece] || 0;
    if (capturedVal < attackerVal && afterAdvantage > prevAdvantage + 50) {
      return 'brilliant';
    }
  }

  // Great: best move with significant gain
  if (cpLoss <= 5 && afterAdvantage > prevAdvantage + 80) {
    return 'great';
  }

  return classifyByCpLoss(cpLoss);
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------
self.onmessage = function (e) {
  const { type, fen, elo, id } = e.data;
  const chess = new Chess(fen);

  switch (type) {
    case 'findBestMove': {
      const move = findBestMove(chess, elo || 1200);
      // eval after best move (for updating eval bar)
      let evalAfter = evaluate(chess);
      if (move) {
        chess.move(move);
        evalAfter = quickEval(chess, 2);
        chess.undo();
      }
      self.postMessage({ type: 'bestMove', move, eval: evalAfter, id });
      break;
    }

    case 'evaluatePosition': {
      const score = quickEval(chess, 2);
      self.postMessage({ type: 'evaluation', score, id });
      break;
    }

    case 'classifyMove': {
      const { prevFen, moveSan } = e.data;
      const quality = classifyMove(prevFen, moveSan);
      self.postMessage({ type: 'classification', quality, moveSan, id });
      break;
    }

    default:
      break;
  }
};
