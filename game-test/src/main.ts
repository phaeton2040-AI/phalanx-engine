/**
 * Main entry point for the game client
 */

import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';
import type { PhalanxClient, MatchFoundEvent } from 'phalanx-client';

// Current game scene instance
let gameScene: GameScene | null = null;

// Initialize lobby scene
const lobbyScene = new LobbyScene();

/**
 * Handle returning to lobby from game
 */
function returnToLobby(): void {
  if (gameScene) {
    gameScene.stop();
    gameScene = null;
  }
  lobbyScene.show();
}

// Handle game start
lobbyScene.setOnGameStart((client: PhalanxClient, matchData: MatchFoundEvent) => {
  console.log('Game starting!', matchData);

  // Create and start game scene
  gameScene = new GameScene(client, matchData);
  gameScene.setOnExit(returnToLobby);
  gameScene.start();
});

// Log startup
console.log('Phalanx Test Game initialized');
