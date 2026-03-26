import React from 'react';

function evalToWhitePercent(evalCp) {
  const clamped = Math.max(-1000, Math.min(1000, evalCp));
  return 50 + (clamped / 1000) * 40; // 10% – 90%
}

function formatEval(evalCp) {
  if (evalCp >= 9000)  return 'M';
  if (evalCp <= -9000) return '-M';
  const pawns = Math.abs(evalCp / 100).toFixed(1);
  return evalCp >= 0 ? `+${pawns}` : `-${pawns}`;
}

export default function EvalBar({ evaluation }) {
  const whitePercent = evalToWhitePercent(evaluation);
  const blackPercent = 100 - whitePercent;
  const text = formatEval(evaluation);
  const whiteWinning = evaluation >= 0;

  return (
    <div className="eval-container">
      <div className="eval-bar">
        {/* Black section (top) */}
        <div
          className="eval-section eval-black"
          style={{ height: `${blackPercent}%` }}
        >
          {!whiteWinning && (
            <span className="eval-score eval-score--black">{text}</span>
          )}
        </div>

        {/* White section (bottom) */}
        <div
          className="eval-section eval-white"
          style={{ height: `${whitePercent}%` }}
        >
          {whiteWinning && (
            <span className="eval-score eval-score--white">{text}</span>
          )}
        </div>
      </div>
    </div>
  );
}
