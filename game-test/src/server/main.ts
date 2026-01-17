/**
 * Game server using Phalanx Engine
 */

import { Phalanx } from 'phalanx-server';

const PORT = 3000;

async function main() {
  console.log('Starting Phalanx Test Game Server...');

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
  phalanx.on('match-created', (match) => {
    console.log(`Match created: ${match.id}`);
  });

  phalanx.on('match-started', (match) => {
    console.log(`Match started: ${match.id}`);
  });

  phalanx.on('match-ended', (matchId: string, reason: string) => {
    console.log(`Match ended: ${matchId}, reason: ${reason}`);
  });

  phalanx.on('player-command', (playerId: string, command: unknown) => {
    // Validate commands if needed
    console.log(`Command from ${playerId}:`, command);
    return true; // Accept command
  });

  phalanx.on('player-disconnected', (playerId: string, matchId: string) => {
    console.log(`Player ${playerId} disconnected from match ${matchId}`);
  });

  phalanx.on('player-reconnected', (playerId: string, matchId: string) => {
    console.log(`Player ${playerId} reconnected to match ${matchId}`);
  });

  try {
    await phalanx.start();
    console.log(`Phalanx server running on port ${PORT}`);
    console.log('Waiting for players to connect...');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await phalanx.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await phalanx.stop();
    process.exit(0);
  });
}

main();
