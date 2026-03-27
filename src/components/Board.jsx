import React, { useCallback } from 'react';
import { QUALITY_CONFIG } from '../utils/moveQuality';

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
const SQ_SIZE = 60; // CSS pixels per square

// Convert square name to SVG center coords (origin top-left of board)
function sqToXY(square) {
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = parseInt(square[1]) - 1;   // 1=0
  return {
    x: file * SQ_SIZE + SQ_SIZE / 2,
    y: (7 - rank) * SQ_SIZE + SQ_SIZE / 2,
  };
}

// SVG arrow from → to
function Arrow({ from, to, color, opacity = 0.75 }) {
  const s = sqToXY(from);
  const e = sqToXY(to);
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;

  const nx = dx / len;
  const ny = dy / len;

  // Shorten both ends so they don't overlap the pieces
  const startX = s.x + nx * 18;
  const startY = s.y + ny * 18;
  const endX   = e.x - nx * 18;
  const endY   = e.y - ny * 18;

  const markerId = `arr-${from}-${to}`.replace(/\W/g, '');

  return (
    <g opacity={opacity}>
      <defs>
        <marker
          id={markerId}
          markerWidth="6" markerHeight="6"
          refX="5" refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill={color} />
        </marker>
      </defs>
      <line
        x1={startX} y1={startY}
        x2={endX}   y2={endY}
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
      />
    </g>
  );
}

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
  accuracySummary,
  // Threats
  threats,
  // Hint
  hintState,
}) {
  const legalDests    = new Set(legalMoves.map(m => m.to));
  const legalCaptures = new Set(legalMoves.filter(m => m.captured || m.flags?.includes('e')).map(m => m.to));

  const squareName = useCallback((ri, fi) => FILES[fi] + RANKS[ri], []);

  const getSquareClass = (sq, ri, fi) => {
    const isLight = (ri + fi) % 2 === 0;
    const cls = ['square', isLight ? 'sq-light' : 'sq-dark'];
    if (sq === selectedSquare)           cls.push('sq-selected');
    if (lastMove?.from === sq || lastMove?.to === sq) cls.push('sq-lastmove');
    if (threats?.threatened?.has(sq))    cls.push('sq-threatened');
    if (threats?.attackerSquares?.has(sq)) cls.push('sq-attacker');
    if (hintState?.step >= 1 && sq === hintState?.from) cls.push('sq-hint-from');
    if (hintState?.step === 2 && sq === hintState?.to)  cls.push('sq-hint-to');
    return cls.join(' ');
  };

  const boardSize = SQ_SIZE * 8;

  return (
    <div className="board-wrapper">
      {gameState !== 'playing' && (
        <div className="game-over-banner">
          <span>
            {gameState === 'checkmate' && '♚ Checkmate!'}
            {gameState === 'stalemate' && '⚖ Stalemate — Draw'}
            {gameState === 'draw'      && '⚖ Draw'}
          </span>
          {accuracySummary !== null && (
            <span className="game-accuracy">Your accuracy: {accuracySummary}%</span>
          )}
        </div>
      )}

      <div className="board" style={{ cursor: isThinking ? 'wait' : 'default' }}>
        {board.map((row, ri) =>
          row.map((piece, fi) => {
            const sq        = squareName(ri, fi);
            const isLegal   = legalDests.has(sq);
            const isCapture = legalCaptures.has(sq);
            return (
              <div
                key={sq}
                className={getSquareClass(sq, ri, fi)}
                onClick={() => onSquareClick(sq)}
              >
                {fi === 0 && <span className="rank-label">{RANKS[ri]}</span>}
                {ri === 7 && <span className="file-label">{FILES[fi]}</span>}

                {isLegal && !piece  && <div className="legal-dot" />}
                {isLegal && piece   && <div className="legal-ring" />}

                {piece && (
                  <span className={`piece piece-${piece.color}`} style={{ pointerEvents: 'none' }}>
                    {PIECE_UNICODE[piece.color + piece.type]}
                  </span>
                )}
              </div>
            );
          })
        )}

        {/* SVG overlay: threat arrows + hint arrow */}
        <svg
          className="board-svg"
          viewBox={`0 0 ${boardSize} ${boardSize}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
        >
          {threats?.arrows?.map((a, i) => (
            <Arrow key={i} from={a.from} to={a.to} color="#e84855" opacity={0.65} />
          ))}
          {hintState?.step === 2 && (
            <Arrow from={hintState.from} to={hintState.to} color="#4cd080" opacity={0.85} />
          )}
        </svg>

        {/* Promotion dialog */}
        {promotionPending && (
          <div className="promotion-overlay">
            <div className="promotion-dialog">
              <p className="promotion-title">Promote to:</p>
              {PROMOTION_PIECES.map(p => (
                <button key={p.type} className="promotion-btn" title={p.title} onClick={() => onPromotion(p.type)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Move quality popup */}
        {showMoveQuality && moveQualityPopup && QUALITY_CONFIG[moveQualityPopup.quality] && (
          <div className={`quality-popup ${moveQualityPopup.visible ? 'quality-popup--visible' : ''}`}>
            <span className="quality-popup-symbol" style={{ color: QUALITY_CONFIG[moveQualityPopup.quality].color }}>
              {QUALITY_CONFIG[moveQualityPopup.quality].symbol}
            </span>
            <span className="quality-popup-label">
              {QUALITY_CONFIG[moveQualityPopup.quality].label}
            </span>
          </div>
        )}
      </div>

      {/* Threat text */}
      {threats?.threatText && (
        <div className="threat-text">{threats.threatText}</div>
      )}
    </div>
  );
}
