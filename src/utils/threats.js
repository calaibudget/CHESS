import { Chess } from 'chess.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// ---------------------------------------------------------------------------
// Find which squares of `attackerColor` attack `targetSquare` in a position.
// Trick: flip the FEN turn to attackerColor, then generate legal moves that
// land on targetSquare.
// ---------------------------------------------------------------------------
function findAttackers(chess, targetSquare, attackerColor) {
  const parts = chess.fen().split(' ');
  parts[1] = attackerColor;
  parts[3] = '-'; // clear en passant to avoid spurious checks

  try {
    const tmp = new Chess(parts.join(' '));
    return tmp
      .moves({ verbose: true })
      .filter(m => m.to === targetSquare)
      .map(m => m.from);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Compute threats to the player's (White's) pieces from the opponent (Black).
// Returns:
//   { threatened, attackerSquares, arrows, threatText }
//   threatened:     Set of white piece squares that are attacked
//   attackerSquares: Set of black piece squares that are attacking
//   arrows:         Array of { from (black), to (white) } for SVG arrows
//   threatText:     One human-readable threat sentence (or '')
// ---------------------------------------------------------------------------
export function computeThreats(chess) {
  if (!chess) return { threatened: new Set(), attackerSquares: new Set(), arrows: [], threatText: '' };

  const board   = chess.board();
  const threatened     = new Set();
  const attackerSquares = new Set();
  const arrows  = [];
  const textParts = [];

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece || piece.color !== 'w') continue;

      const square = FILES[f] + (8 - r);
      if (!chess.isAttacked(square, 'b')) continue;

      const attackers = findAttackers(chess, square, 'b');
      if (attackers.length === 0) continue;

      threatened.add(square);
      attackers.forEach(sq => {
        attackerSquares.add(sq);
        arrows.push({ from: sq, to: square });
      });

      // Build text for first unrecorded threat
      if (textParts.length < 1) {
        const targetName   = PIECE_NAMES[piece.type]   ?? piece.type;
        const attackerPiece = chess.get(attackers[0]);
        const attackerName  = PIECE_NAMES[attackerPiece?.type] ?? '?';
        textParts.push(
          `Your ${targetName} on ${square} is attacked by the ${attackerName} on ${attackers[0]}.`
        );
      }
    }
  }

  return {
    threatened,
    attackerSquares,
    arrows,
    threatText: textParts[0] ?? '',
  };
}
