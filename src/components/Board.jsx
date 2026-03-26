import React, { useCallback } from 'react';
import { QUALITY_CONFIG } from '../utils/moveQuality';

// Unicode chess pieces
const PIECE_UNICODE = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

const PROMOTION_PIECES = [
  { type: 'q', label: '♕', title: 'Queen' },
  { type: 'r', label: '♖', title: 'Rook' },
  { type: 'b', label: '♗', title: 'Bishop' },
  { type: 'n', label: '♘', title: 'Knight' },
];

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export default function Board({
  board,
  selectedSquare,
  legalMoves,
  lastMove,
  onSquareClick,
  promotionPending,
  onPromotion,
  isThinking,
  gameState,
  moveQualityPopup,
  showMoveQuality,
}) {
  const legalDests = new Set(legalMoves.map(m => m.to));
  const legalCaptures = new Set(legalMoves.filter(m => m.captured || m.flags.includes('e')).map(m => m.to));

  const squareName = useCallback((rankIdx, fileIdx) => {
    return FILES[fileIdx] + RANKS[rankIdx];
  }, []);

  const getSquareClass = (sq, rankIdx, fileIdx) => {
    const isLight = (rankIdx + fileIdx) % 2 === 0;
    const classes = ['square', isLight ? 'sq-light' : 'sq-dark'];
    if (sq === selectedSquare)         classes.push('sq-selected');
    if (lastMove && sq === lastMove.from) classes.push('sq-lastmove');
    if (lastMove && sq === lastMove.to)   classes.push('sq-lastmove');
    return classes.join(' ');
  };

  return (
    <div className="board-wrapper">
      {/* Game-over banner */}
      {gameState !== 'playing' && (
        <div className="game-over-banner">
          {gameState === 'checkmate' && '♚ Checkmate!'}
          {gameState === 'stalemate' && '⚖ Stalemate — Draw'}
          {gameState === 'draw'      && '⚖ Draw'}
        </div>
      )}

      <div className="board" style={{ cursor: isThinking ? 'wait' : 'default' }}>
        {board.map((row, rankIdx) =>
          row.map((piece, fileIdx) => {
            const sq = squareName(rankIdx, fileIdx);
            const isLegal   = legalDests.has(sq);
            const isCapture = legalCaptures.has(sq);

            return (
              <div
                key={sq}
                className={getSquareClass(sq, rankIdx, fileIdx)}
                onClick={() => onSquareClick(sq)}
                data-square={sq}
              >
                {/* Rank label (left edge, file a only) */}
                {fileIdx === 0 && (
                  <span className="rank-label">{RANKS[rankIdx]}</span>
                )}

                {/* File label (bottom edge, rank 1 only) */}
                {rankIdx === 7 && (
                  <span className="file-label">{FILES[fileIdx]}</span>
                )}

                {/* Legal move indicator */}
                {isLegal && !piece && <div className="legal-dot" />}
                {isLegal && piece && <div className="legal-ring" />}

                {/* Piece */}
                {piece && (
                  <span
                    className={`piece piece-${piece.color}`}
                    style={{ pointerEvents: 'none' }}
                  >
                    {PIECE_UNICODE[piece.color + piece.type]}
                  </span>
                )}
              </div>
            );
          })
        )}

        {/* Promotion dialog */}
        {promotionPending && (
          <div className="promotion-overlay">
            <div className="promotion-dialog">
              <p className="promotion-title">Promote to:</p>
              {PROMOTION_PIECES.map(p => (
                <button
                  key={p.type}
                  className="promotion-btn"
                  title={p.title}
                  onClick={() => onPromotion(p.type)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Move quality popup */}
        {showMoveQuality && moveQualityPopup && QUALITY_CONFIG[moveQualityPopup.quality] && (
          <div className={`quality-popup ${moveQualityPopup.visible ? 'quality-popup--visible' : ''}`}>
            <span
              className="quality-popup-symbol"
              style={{ color: QUALITY_CONFIG[moveQualityPopup.quality].color }}
            >
              {QUALITY_CONFIG[moveQualityPopup.quality].symbol}
            </span>
            <span className="quality-popup-label">
              {QUALITY_CONFIG[moveQualityPopup.quality].label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
