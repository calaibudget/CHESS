import React from 'react';

const ELO_OPTIONS = [400, 600, 800, 1000, 1200, 1400, 1600, 1800];

export default function GameControls({
  elo,
  onEloChange,
  showMoveQuality,
  onToggleMoveQuality,
  onUndo,
  onNewGame,
  isThinking,
}) {
  return (
    <div className="game-controls">
      {/* ELO Selector */}
      <div className="control-group">
        <label className="control-label">Opponent Strength</label>
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

      {/* Move Quality Toggle */}
      <div className="control-group">
        <label className="control-label">Move Quality Icons</label>
        <button
          className={`toggle-btn ${showMoveQuality ? 'toggle-btn--on' : ''}`}
          onClick={onToggleMoveQuality}
        >
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
          <span className="toggle-text">{showMoveQuality ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* Action buttons */}
      <div className="control-group control-group--actions">
        <button
          className="action-btn action-btn--undo"
          onClick={onUndo}
          disabled={isThinking}
          title="Undo last move pair"
        >
          ↩ Undo
        </button>
        <button
          className="action-btn action-btn--new"
          onClick={onNewGame}
          title="Start a new game"
        >
          ⊕ New Game
        </button>
      </div>

      {/* Thinking indicator */}
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
