/**
 * Phalanx Engine
 * A game-agnostic deterministic lockstep multiplayer engine
 */

// Main class
export { Phalanx } from './Phalanx.js';

// Authentication
export {
  TokenValidatorService,
  createDevValidator,
  createEndpointValidator,
} from './services/TokenValidator.js';

// Utilities
export { DeterministicRandom } from './utils/index.js';
export { Fixed, FixedMath, FixedVector2, FixedVector3, FixedPoint } from './utils/index.js';
export type { FPVector2, FPPosition } from './utils/index.js';

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
  TlsConfig,
  QueuedPlayer,
  QueueStatusEvent,
  StateHashEvent,
  DesyncDetectedEvent,
  PhalanxEventType,
  PhalanxEventHandlers,
  // Auth types
  AuthConfig,
  TokenValidator,
  TokenValidationResult,
} from './types/index.js';

// Constants
export { GAME_MODES } from './config/defaults.js';
