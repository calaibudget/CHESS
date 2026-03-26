import React from 'react';

export default function BoardControls({
  onUndo, isThinking,
  onHint, hintState, hintLoading,
  onThreats, threatsActive,
  viewIndex, onScrubLeft, onScrubRight, totalMoves,
}) {
  const hintLabel =
    hintLoading          ? 'Loading…'
    : hintState?.step === 1 ? 'Show Dest'
    : hintState?.step === 2 ? 'Hint shown'
    : '💡 Hint';

  const inReview = viewIndex !== null;

  return (
    <div className="board-controls">
      <button
        className="bc-btn bc-btn--undo"
        onClick={onUndo}
        disabled={isThinking || inReview}
        title="Undo"
      >
        ↩ Undo
      </button>

      <button
        className={`bc-btn bc-btn--hint ${hintState ? 'bc-btn--active' : ''}`}
        onClick={onHint}
        disabled={isThinking || hintLoading || hintState?.step === 2 || inReview}
        title="Hint"
      >
        {hintLabel}
      </button>

      <button
        className={`bc-btn bc-btn--threats ${threatsActive ? 'bc-btn--active' : ''}`}
        onClick={onThreats}
        disabled={isThinking || inReview}
        title="Show threats"
      >
        ⚠ Threats
      </button>

      <div className="bc-scrub">
        <button
          className="bc-btn bc-btn--scrub"
          onClick={onScrubLeft}
          disabled={viewIndex === 0 || (viewIndex === null && totalMoves === 0)}
          title="Previous move (←)"
        >
          ‹
        </button>
        <button
          className="bc-btn bc-btn--scrub"
          onClick={onScrubRight}
          disabled={viewIndex === null}
          title="Next move (→)"
        >
          ›
        </button>
      </div>

      {inReview && (
        <span className="bc-review-label">
          Review {viewIndex + 1}/{totalMoves}
        </span>
      )}
    </div>
  );
}
