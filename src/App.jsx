import React from 'react';
import Board from './components/Board';
import EvalBar from './components/EvalBar';
import GameControls from './components/GameControls';
import BoardControls from './components/BoardControls';
import LostMaterialBar from './components/LostMaterialBar';
import { useChessGame } from './hooks/useChessGame';

export default function App() {
  const game = useChessGame();

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Chess</h1>
      </header>

      <main className="game-layout">
        {/* ── Left column: material + eval bar + board + controls ── */}
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
        </div>

        {/* ── Right column: controls only ── */}
        <div className="side-column">
          <GameControls
            elo={game.elo}
            onEloChange={game.setElo}
            showMoveQuality={game.showMoveQuality}
            onToggleMoveQuality={game.toggleMoveQuality}
            onNewGame={game.handleNewGame}
            isThinking={game.isThinking}
          />
        </div>
      </main>
    </div>
  );
}
