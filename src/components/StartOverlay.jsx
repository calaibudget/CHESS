import React, { useState } from 'react';

const ELO_OPTIONS = [400, 600, 800, 1000, 1200, 1400, 1600, 1800];

const COLOR_OPTIONS = [
  { id: 'w',      icon: '♔', label: 'White'  },
  { id: 'b',      icon: '♚', label: 'Black'  },
  { id: 'random', icon: '⚄', label: 'Random' },
];

export default function StartOverlay({ onStart }) {
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedElo,   setSelectedElo]   = useState(null);

  const canStart = selectedColor !== null && selectedElo !== null;

  const handleStart = () => {
    if (!canStart) return;
    const color = selectedColor === 'random'
      ? (Math.random() < 0.5 ? 'w' : 'b')
      : selectedColor;
    onStart({ color, elo: selectedElo });
  };

  return (
    <div className="start-overlay">
      <div className="start-modal">
        <h2 className="start-modal-title">New Game</h2>

        <div className="start-section">
          <p className="start-section-label">Play as</p>
          <div className="color-tiles">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c.id}
                className={`color-tile ${selectedColor === c.id ? 'color-tile--active' : ''}`}
                onClick={() => setSelectedColor(c.id)}
              >
                <span className="color-tile-icon">{c.icon}</span>
                <span className="color-tile-name">{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="start-section">
          <p className="start-section-label">Opponent Strength</p>
          <div className="elo-tiles">
            {ELO_OPTIONS.map(e => (
              <button
                key={e}
                className={`elo-tile ${selectedElo === e ? 'elo-tile--active' : ''}`}
                onClick={() => setSelectedElo(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <button
          className="start-btn"
          disabled={!canStart}
          onClick={handleStart}
        >
          Start Game
        </button>
      </div>
    </div>
  );
}
