import React from 'react';

const PIECE_UNICODE_BLACK = { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PIECE_UNICODE_WHITE = { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };

// capturedBy* = pieces captured BY that side (i.e., opponent lost these)
export default function LostMaterialBar({ capturedByWhite, capturedByBlack, materialAdvantage }) {
  return (
    <div className="material-bar">
      {/* Black's row — pieces white captured from black */}
      <div className="material-row material-row--black">
        <span className="material-pieces">
          {capturedByWhite.map((p, i) => (
            <span key={i} className="material-piece material-piece--black">
              {PIECE_UNICODE_BLACK[p]}
            </span>
          ))}
        </span>
        {materialAdvantage > 0 && (
          <span className="material-advantage">+{materialAdvantage}</span>
        )}
      </div>

      {/* White's row — pieces black captured from white */}
      <div className="material-row material-row--white">
        <span className="material-pieces">
          {capturedByBlack.map((p, i) => (
            <span key={i} className="material-piece material-piece--white">
              {PIECE_UNICODE_WHITE[p]}
            </span>
          ))}
        </span>
        {materialAdvantage < 0 && (
          <span className="material-advantage">+{Math.abs(materialAdvantage)}</span>
        )}
      </div>
    </div>
  );
}
