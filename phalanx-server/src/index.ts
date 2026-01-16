/**
 * Phalanx Engine
 * A game-agnostic deterministic lockstep multiplayer engine
 */

// Main class
export { Phalanx } from './Phalanx.js';

// Types for TypeScript users
export type {
  PhalanxConfig,
  PlayerCommand,
  MatchFoundEvent,
  TickSyncEvent,
  CommandsBatchEvent,
  TickCommands,
  SubmitCommandsEvent,
  PlayerInfo,
  MatchInfo,
  GameMode,
  GameModePreset,
  CustomGameMode,
  CorsConfig,
  QueuedPlayer,
  QueueStatusEvent,
  PhalanxEventType,
  PhalanxEventHandlers,
} from './types/index.js';

// Constants
export { GAME_MODES } from './config/defaults.js';
