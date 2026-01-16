/**
 * Phalanx Client Library
 *
 * Client-side library for connecting to Phalanx Engine servers.
 * Provides a type-safe API for matchmaking, game synchronization,
 * command submission, and reconnection handling.
 *
 * @packageDocumentation
 */

// Main client class
export { PhalanxClient } from './PhalanxClient.js';

// All types
export type {
  // Configuration
  PhalanxClientConfig,

  // Commands
  PlayerCommand,

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

  // Event handlers
  PhalanxClientEvents,
} from './types.js';
