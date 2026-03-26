import React, { useEffect, useRef } from 'react';
import { QUALITY_CONFIG } from '../utils/moveQuality';

function QualityBadge({ quality }) {
  if (!quality || !QUALITY_CONFIG[quality]) return null;
  const { symbol, color, label } = QUALITY_CONFIG[quality];
  return (
    <span className="quality-badge" style={{ color }} title={label}>
      {symbol}
    </span>
  );
}

export default function MoveList({ moves, showMoveQuality }) {
  const bottomRef = useRef(null);

  // Auto-scroll to latest move
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [moves.length]);

  // Group moves into pairs: [[white, black], ...]
  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ num: Math.floor(i / 2) + 1, white: moves[i], black: moves[i + 1] });
  }

  return (
    <div className="move-list">
      <div className="move-list-header">Moves</div>
      <div className="move-list-body">
        {pairs.length === 0 && (
          <div className="move-list-empty">No moves yet</div>
        )}
        {pairs.map(({ num, white, black }) => (
          <div key={num} className="move-pair">
            <span className="move-num">{num}.</span>

            <span className="move-san">
              {white.san}
              {showMoveQuality && <QualityBadge quality={white.quality} />}
            </span>

            {black && (
              <span className="move-san">
                {black.san}
                {showMoveQuality && <QualityBadge quality={black.quality} />}
              </span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
