// Move quality display config — used by popup and board overlay
export const QUALITY_CONFIG = {
  brilliant:  { symbol: '!!', color: '#1bada6', label: 'Brilliant' },
  great:      { symbol: '!',  color: '#5c8bb0', label: 'Great Move' },
  best:       { symbol: '★',  color: '#9cc89a', label: 'Best Move' },
  excellent:  { symbol: '✓',  color: '#96bc4b', label: 'Excellent' },
  good:       { symbol: '●',  color: '#7ab87a', label: 'Good' },
  inaccuracy: { symbol: '?!', color: '#f0a15a', label: 'Inaccuracy' },
  mistake:    { symbol: '?',  color: '#e84855', label: 'Mistake' },
  blunder:    { symbol: '??', color: '#ca3431', label: 'Blunder' },
  miss:       { symbol: '⊗',  color: '#e84855', label: 'Miss' },
};

// ---------------------------------------------------------------------------
// Expected Points from White's perspective given centipawn score (White POV).
// EP_white ∈ (0,1):  1.0 = White wins, 0.0 = Black wins, 0.5 = equal.
// ---------------------------------------------------------------------------
function EP_white(cp) {
  return 1 / (1 + Math.exp(-cp / 400));
}

// ---------------------------------------------------------------------------
// Sacrifice detection helpers
// ---------------------------------------------------------------------------
const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// True if the moving piece is worth more than the captured piece
function isExchangeSacrifice(moveObj) {
  if (!moveObj?.captured) return false;
  const attackerVal = PIECE_VAL[moveObj.piece]    ?? 0;
  const victimVal   = PIECE_VAL[moveObj.captured] ?? 0;
  return attackerVal > victimVal;
}

// ---------------------------------------------------------------------------
// Classify a move using the Expected Points (EP) loss pipeline.
//
// Parameters — all evals are centipawns from WHITE's perspective:
//   bestEvalBefore   — MultiPV-1 eval of position before move (best play)
//   secondEvalBefore — MultiPV-2 eval of position before move (2nd-best play)
//   evalAfter        — eval of position after the move was played (best play)
//   moverIsWhite     — true if the mover is White
//   moveObj          — chess.js verbose move result (for sacrifice detection)
// ---------------------------------------------------------------------------
export function classifyMove(
  bestEvalBefore, secondEvalBefore, evalAfter,
  moverIsWhite, moveObj = null
) {
  // EP from mover's perspective
  const sign = moverIsWhite ? 1 : -1;

  const ep_best_before   = moverIsWhite
    ? EP_white( bestEvalBefore)
    : 1 - EP_white(bestEvalBefore);

  const ep_second_before = moverIsWhite
    ? EP_white( secondEvalBefore)
    : 1 - EP_white(secondEvalBefore);

  const ep_after_mover   = moverIsWhite
    ? EP_white( evalAfter)
    : 1 - EP_white(evalAfter);

  // EP loss: positive means the mover played worse than best
  const epLoss = ep_best_before - ep_after_mover;

  // ── Miss ─────────────────────────────────────────────────────────────────
  // Mover had a nearly won position, let it slip badly
  if (ep_best_before >= 0.90 && ep_after_mover < 0.55 && epLoss >= 0.30) {
    return 'miss';
  }

  // ── Base classification by EP loss ───────────────────────────────────────
  let base;
  if      (epLoss <= 0)    base = 'best';
  else if (epLoss <= 0.02) base = 'excellent';
  else if (epLoss <= 0.05) base = 'good';
  else if (epLoss <= 0.10) base = 'inaccuracy';
  else if (epLoss <= 0.20) base = 'mistake';
  else                     base = 'blunder';

  // ── Brilliant ─────────────────────────────────────────────────────────────
  // Requires: best/excellent AND sacrifice AND position not already won AND
  // resulting position is at least tenable for mover (≥0.45 EP).
  if (
    (base === 'best' || base === 'excellent') &&
    isExchangeSacrifice(moveObj) &&
    ep_best_before < 0.90 &&      // not already winning before
    ep_after_mover >= 0.45         // tenable after sacrifice
  ) {
    return 'brilliant';
  }

  // ── Great move ────────────────────────────────────────────────────────────
  // Requires best/excellent AND (
  //   only-move: 2nd-best loses ≥0.10 EP more than best, OR
  //   swing: EP actually improves across a category boundary vs. 2nd-best
  // )
  if (base === 'best' || base === 'excellent') {
    const secondLoss = ep_best_before - ep_second_before;
    const onlyMove   = secondLoss >= 0.10;

    // "Swing": playing this move improved across a category vs. second-best
    const swing = ep_after_mover - ep_second_before >= 0.05;

    if (onlyMove || swing) return 'great';
  }

  return base;
}
