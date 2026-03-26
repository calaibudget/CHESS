// Move quality display config — used by MoveList, popup, and sidebar
export const QUALITY_CONFIG = {
  brilliant:  { symbol: '!!', color: '#1bada6', label: 'Brilliant' },
  great:      { symbol: '!',  color: '#5c8bb0', label: 'Great Move' },
  best:       { symbol: '★',  color: '#9cc89a', label: 'Best Move' },
  excellent:  { symbol: '✓',  color: '#96bc4b', label: 'Excellent' },
  good:       { symbol: '●',  color: '#7ab87a', label: 'Good' },
  inaccuracy: { symbol: '?!', color: '#f0a15a', label: 'Inaccuracy' },
  mistake:    { symbol: '?',  color: '#e84855', label: 'Mistake' },
  blunder:    { symbol: '??', color: '#ca3431', label: 'Blunder' },
  missed_win: { symbol: '⊕',  color: '#e84855', label: 'Missed Win' },
};

// ---------------------------------------------------------------------------
// Win probability sigmoid (from mover's centipawn advantage)
// Calibrated to standard chess win-rate curves
// ---------------------------------------------------------------------------
function winProb(cpFromMoverPOV) {
  return 1 / (1 + Math.exp(-cpFromMoverPOV / 290));
}

// ---------------------------------------------------------------------------
// Classify a move given pre-move and post-move centipawn evaluations,
// both from WHITE's perspective (positive = White winning).
//
// evalBefore: Stockfish's eval of the position BEFORE the move (White POV)
//   — this is already the "best play" value since it's Stockfish's minimax
// evalAfter:  Stockfish's eval of the position AFTER the move (White POV)
// moveData:   chess.js verbose move object (optional, used for brilliant detection)
// ---------------------------------------------------------------------------
export function classifyMove(evalBefore, evalAfter, moverIsWhite, moveData = null) {
  // Win probability from mover's perspective before and after
  const evalBeforeMover = moverIsWhite ?  evalBefore : -evalBefore;
  const evalAfterMover  = moverIsWhite ?  evalAfter  : -evalAfter;

  const wpBefore = winProb(evalBeforeMover);
  const wpAfter  = winProb(evalAfterMover);

  // Win-probability loss in percentage points (positive = mover played worse)
  const wpLoss = (wpBefore - wpAfter) * 100;

  // ── Missed win ─────────────────────────────────────────────────────────
  // Mover had ≥70% win probability, now ≤50%
  if (wpBefore >= 70 && wpAfter <= 50 && wpLoss > 20) {
    return 'missed_win';
  }

  // ── Brilliant: piece sacrifice that is best move + improves position ─────
  // Requires: best (or near-best) move, captures opponent with LESS-valuable piece,
  // and win probability increases
  if (
    moveData?.captured &&
    wpLoss <= 0 &&
    wpAfter > wpBefore + 5 // actually gains win probability
  ) {
    const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const attackerVal = PIECE_VAL[moveData.piece]  ?? 0;
    const victimVal   = PIECE_VAL[moveData.captured] ?? 0;
    if (attackerVal > victimVal) return 'brilliant'; // gave up more valuable piece
  }

  // ── Great move: best move with significant win-prob gain ──────────────────
  if (wpLoss <= 0 && wpAfter > wpBefore + 3) {
    return 'great';
  }

  // ── Standard win-probability-loss classification ──────────────────────────
  if (wpLoss <= 0)   return 'best';
  if (wpLoss <= 2)   return 'excellent';
  if (wpLoss <= 5)   return 'good';
  if (wpLoss <= 10)  return 'inaccuracy';
  if (wpLoss <= 20)  return 'mistake';
  return 'blunder';
}
