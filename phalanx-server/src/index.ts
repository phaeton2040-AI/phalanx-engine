/**
 * Phalanx Engine
 * A game-agnostic deterministic lockstep multiplayer engine
 */

// Main class
export { Phalanx } from './Phalanx.js';

// Utilities
export { DeterministicRandom } from './utils/index.js';
export { Fixed, FixedMath, FixedVector2, FixedPoint } from './utils/index.js';
export type { FPVector2 } from './utils/index.js';

// Types for TypeScript users
export type {
  PhalanxConfig,
  PlayerCommand,
  MatchFoundEvent,
  GameStartEvent,
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
  StateHashEvent,
  DesyncDetectedEvent,
  PhalanxEventType,
  PhalanxEventHandlers,
} from './types/index.js';

// Constants
export { GAME_MODES } from './config/defaults.js';
