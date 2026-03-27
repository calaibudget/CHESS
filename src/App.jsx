import React, { useState } from 'react';
import Board from './components/Board';
import EvalBar from './components/EvalBar';
import GameControls from './components/GameControls';
import BoardControls from './components/BoardControls';
import LostMaterialBar from './components/LostMaterialBar';
import StartOverlay from './components/StartOverlay';
import { useChessGame } from './hooks/useChessGame';

export default function App() {
  const game = useChessGame();
  const [showOverlay, setShowOverlay] = useState(true);

  const handleStart = (params) => {
    game.handleNewGame(params);
    setShowOverlay(false);
  };

  const handleNewGame = () => setShowOverlay(true);

  return (
    <div className="app">
      {showOverlay && <StartOverlay onStart={handleStart} />}

      <header className="app-header">
        <h1 className="app-title">Chess</h1>
        <button className="new-game-link" onClick={handleNewGame}>
          New Game
        </button>
      </header>

      <main className="game-layout">
        {/* ── Left column ── */}
        <div className="board-column">
          <LostMaterialBar
            capturedByWhite={game.capturedByWhite}
            capturedByBlack={game.capturedByBlack}
            materialAdvantage={game.materialAdvantage}
          />

          <div className="board-with-eval">
            <EvalBar evaluation={game.evaluation} />
            <Board
              board={game.board}
              selectedSquare={game.selectedSquare}
              legalMoves={game.legalMoves}
              lastMove={game.lastMove}
              onSquareClick={game.handleSquareClick}
              promotionPending={game.promotionPending}
              onPromotion={game.handlePromotion}
              isThinking={game.isThinking}
              gameState={game.gameState}
              moveQualityPopup={game.moveQualityPopup}
              showMoveQuality={game.showMoveQuality}
              accuracySummary={game.accuracySummary}
              threats={game.threats}
              hintState={game.hintState}
            />
          </div>

          <BoardControls
            onUndo={game.handleUndo}
            isThinking={game.isThinking}
            onHint={game.handleHint}
            hintState={game.hintState}
            hintLoading={game.hintLoading}
            onThreats={game.handleThreats}
            threatsActive={game.threatsActive}
            viewIndex={game.viewIndex}
            onScrubLeft={game.handleScrubLeft}
            onScrubRight={game.handleScrubRight}
            totalMoves={game.totalMoves}
          />

          {game.engineError && (
            <div className="engine-error">{game.engineError}</div>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="side-column">
          <GameControls
            showMoveQuality={game.showMoveQuality}
            onToggleMoveQuality={game.toggleMoveQuality}
            isThinking={game.isThinking}
          />
        </div>
      </main>
    </div>
  );
}
