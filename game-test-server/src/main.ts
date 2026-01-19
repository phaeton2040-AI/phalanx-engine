/**
 * Game server using Phalanx Engine
 * Configured for Heroku deployment
 */

import { Phalanx } from 'phalanx-server';

// Heroku provides PORT as an environment variable
const PORT = parseInt(process.env.PORT || '3000', 10);

// CORS origins - configurable via environment variable
// In production, set CORS_ORIGINS to your client URLs (comma-separated)
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:3001', 'http://localhost:5173'];

async function main() {
  console.log('Starting Phalanx Test Game Server...');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  const phalanx = new Phalanx({
    port: PORT,
    cors: {
      origin: CORS_ORIGINS,
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
    console.log(`CORS origins: ${CORS_ORIGINS.join(', ')}`);
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
