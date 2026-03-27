import React from 'react';

function Toggle({ on, onToggle, label }) {
  return (
    <button className={`toggle-btn ${on ? 'toggle-btn--on' : ''}`} onClick={onToggle}>
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="toggle-text">{on ? 'ON' : 'OFF'}</span>
      <span className="toggle-label-text">{label}</span>
    </button>
  );
}

export default function GameControls({
  showMoveQuality, onToggleMoveQuality,
  isThinking,
}) {
  return (
    <div className="game-controls">
      <div className="control-group">
        <Toggle on={showMoveQuality} onToggle={onToggleMoveQuality} label="Move Quality" />
      </div>

      {isThinking && (
        <div className="thinking-indicator">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          Thinking…
        </div>
      )}
    </div>
  );
}
