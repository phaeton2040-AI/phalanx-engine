/**
 * Game server using Phalanx Engine
 */

import { Phalanx } from 'phalanx-server';

const PORT = 3000;

async function main() {
  const phalanx = new Phalanx({
    port: PORT,
    cors: {
      origin: ['http://localhost:3001', 'http://localhost:5173'],
      credentials: true,
    },
    tickRate: 20, // 20 ticks per second
    gameMode: '1v1', // 2 players per match
    countdownSeconds: 3,
    matchmakingIntervalMs: 1000,
  });

  // Event handlers
  phalanx.on('match-created', (_match) => {
    // Match created
  });

  phalanx.on('match-started', (_match) => {
    // Match started
  });

  phalanx.on('match-ended', (_matchId: string, _reason: string) => {
    // Match ended
  });

  phalanx.on('player-command', (_playerId: string, _command: unknown) => {
    // Validate commands if needed
    return true; // Accept command
  });

  phalanx.on('player-disconnected', (_playerId: string, _matchId: string) => {
    // Player disconnected
  });

  phalanx.on('player-reconnected', (_playerId: string, _matchId: string) => {
    // Player reconnected
  });

  try {
    await phalanx.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  // Handle shutdown
  process.on('SIGINT', () => {
    console.warn('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    console.warn('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });
}

void main();
