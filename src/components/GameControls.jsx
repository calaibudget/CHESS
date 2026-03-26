import React from 'react';

const ELO_OPTIONS = [400, 600, 800, 1000, 1200, 1400, 1600, 1800];

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
  elo, onEloChange,
  showMoveQuality, onToggleMoveQuality,
  onNewGame,
  isThinking,
}) {
  return (
    <div className="game-controls">
      {/* ELO Selector */}
      <div className="control-group">
        <span className="control-label">Opponent Strength (target ~ELO)</span>
        <div className="elo-buttons">
          {ELO_OPTIONS.map(e => (
            <button
              key={e}
              className={`elo-btn ${elo === e ? 'elo-btn--active' : ''}`}
              onClick={() => onEloChange(e)}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div className="control-group">
        <Toggle on={showMoveQuality} onToggle={onToggleMoveQuality} label="Move Quality" />
      </div>

      {/* New Game */}
      <div className="control-group control-group--actions">
        <button className="action-btn action-btn--new" onClick={onNewGame}>
          ⊕ New Game
        </button>
      </div>

      {/* Thinking indicator */}
      {isThinking && (
        <div className="thinking-indicator">
          <span className="thinking-dot" /><span className="thinking-dot" /><span className="thinking-dot" />
          Thinking…
        </div>
      )}
    </div>
  );
}
