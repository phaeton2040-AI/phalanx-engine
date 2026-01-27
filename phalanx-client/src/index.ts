/**
 * Phalanx Client Library
 *
 * Client-side library for connecting to Phalanx Engine servers.
 * Provides a type-safe API for matchmaking, game synchronization,
 * command submission, and reconnection handling.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { PhalanxClient } from 'phalanx-client';
 *
 * // Create and connect
 * const client = await PhalanxClient.create({
 *   serverUrl: 'http://localhost:3000',
 *   playerId: 'player-123',
 *   username: 'MyPlayer',
 * });
 *
 * // Matchmaking
 * client.onMatchFound((data) => console.log('Match found!', data));
 * client.joinQueue();
 *
 * // Game loop - just two callbacks!
 * client.onTick((tick, commands) => {
 *   // Process commands from all players
 *   for (const [playerId, playerCommands] of Object.entries(commands.commands)) {
 *     for (const cmd of playerCommands) {
 *       handleCommand(playerId, cmd);
 *     }
 *   }
 *   // Run simulation
 *   world.simulate();
 * });
 *
 * client.onFrame((alpha, dt) => {
 *   // Interpolate positions for smooth rendering
 *   interpolate(alpha);
 *   // Render
 *   scene.render();
 * });
 *
 * // Send commands
 * client.sendCommand('move', { targetX: 10, targetZ: 20 });
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Main Client
// ============================================

export { PhalanxClient } from './PhalanxClient.js';

// ============================================
// Utilities
// ============================================

// Event emitter (for building custom clients or extensions)
export { EventEmitter } from './EventEmitter.js';

// Render loop (for custom rendering setups)
export { RenderLoop } from './RenderLoop.js';
export type { RenderLoopConfig, CommandFlushCallback } from './RenderLoop.js';

// Socket manager (for custom networking setups)
export { SocketManager } from './SocketManager.js';
export type {
  SocketManagerConfig,
  SocketManagerCallbacks,
} from './SocketManager.js';

// Tick simulation (advanced usage - for custom timing logic)
export { TickSimulation } from './TickSimulation.js';
export type {
  TickSimulationConfig,
  SimulationTickCallback,
  BeforeTickCallback,
  AfterTickCallback,
} from './TickSimulation.js';

// Deterministic random number generator
export { DeterministicRandom } from './DeterministicRandom.js';

// ============================================
// Types
// ============================================

export type {
  // Configuration
  PhalanxClientConfig,

  // Commands
  PlayerCommand,
  CommandsBatch,

  // Handlers
  TickHandler,
  FrameHandler,
  Unsubscribe,

  // Match events
  MatchPlayerInfo,
  MatchFoundEvent,
  CountdownEvent,
  GameStartEvent,
  MatchEndEvent,

  // Tick events
  TickSyncEvent,
  CommandsBatchEvent,

  // Queue events
  QueueStatusEvent,

  // Player events
  PlayerDisconnectedEvent,
  PlayerReconnectedEvent,

  // Reconnection
  ReconnectStateEvent,
  TickCommandsHistory,
  ReconnectStatusEvent,

  // Commands acknowledgment
  SubmitCommandsAck,

  // Errors
  PhalanxError,

  // State types
  ConnectionState,
  ClientState,

  // Event handlers (for legacy 'on' API)
  PhalanxClientEvents,
} from './types.js';
