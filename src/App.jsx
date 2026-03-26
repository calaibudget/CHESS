import React from 'react';
import Board from './components/Board';
import EvalBar from './components/EvalBar';
import MoveList from './components/MoveList';
import GameControls from './components/GameControls';
import { useChessGame } from './hooks/useChessGame';

export default function App() {
  const game = useChessGame();

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Chess</h1>
      </header>

      <main className="game-layout">
        {/* ── Left column: eval bar + board ── */}
        <div className="board-column">
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
            />
          </div>
        </div>

        {/* ── Right column: controls + move list ── */}
        <div className="side-column">
          <GameControls
            elo={game.elo}
            onEloChange={game.setElo}
            showMoveQuality={game.showMoveQuality}
            onToggleMoveQuality={game.toggleMoveQuality}
            onUndo={game.handleUndo}
            onNewGame={game.handleNewGame}
            isThinking={game.isThinking}
          />
          <MoveList
            moves={game.moves}
            showMoveQuality={game.showMoveQuality}
          />
        </div>
      </main>
    </div>
  );
}
