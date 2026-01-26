/**
 * Phalanx Engine Types
 * All exported types for TypeScript users
 */

/**
 * Game mode preset string
 */
export type GameModePreset = '1v1' | '2v2' | '3v3' | '4v4' | 'FFA4';

/**
 * Custom game mode configuration
 */
export interface CustomGameMode {
  playersPerMatch: number;
  teamsCount: number;
}

/**
 * Game mode - either a preset string or custom configuration
 */
export type GameMode = GameModePreset | CustomGameMode;

/**
 * CORS configuration
 */
export interface CorsConfig {
  origin: string | string[];
  methods?: string[];
  credentials?: boolean;
}

/**
 * Full Phalanx configuration
 */
export interface PhalanxConfig {
  // === Server ===
  port: number;
  cors: CorsConfig;

  // === Tick System ===
  tickRate: number;
  tickDeadlineMs: number;

  // === Matchmaking ===
  gameMode: GameMode;
  matchmakingIntervalMs: number;
  countdownSeconds: number;

  // === Timeouts ===
  timeoutTicks: number;
  disconnectTicks: number;
  reconnectGracePeriodMs: number;

  // === Command Validation ===
  maxTickBehind: number;
  maxTickAhead: number;

  // === Command History (for reconnection) ===
  commandHistoryTicks: number;

  // === Determinism Features (Phase 2.1) ===
  /** Enable input sequence validation (default: false for backward compatibility) */
  validateInputSequence?: boolean;
  /** Enable state hashing for desync detection (default: false) */
  enableStateHashing?: boolean;
  /** Interval in ticks between state hash checks (default: 60) */
  stateHashInterval?: number;
}

/**
 * Player command sent from client
 */
export interface PlayerCommand {
  type: string;
  tick: number;
  playerId: string;
  data: unknown;
  /** Optional sequence number for input validation (monotonically increasing per player) */
  sequence?: number;
}

/**
 * Information about a player
 */
export interface PlayerInfo {
  id: string;
  teamId: number;
  connected: boolean;
  lastTick: number;
}

/**
 * Information about an active match
 */
export interface MatchInfo {
  id: string;
  players: PlayerInfo[];
  currentTick: number;
  state: 'countdown' | 'playing' | 'paused' | 'finished';
  createdAt: Date;
}

/**
 * Player info for match-found event (minimal data)
 */
export interface MatchPlayerInfo {
  playerId: string;
  username: string;
}

/**
 * Match found event payload - personalized for each player
 */
export interface MatchFoundEvent {
  matchId: string;
  playerId: string;
  teamId: number;
  teammates: MatchPlayerInfo[];
  opponents: MatchPlayerInfo[];
}

/**
 * Countdown event payload - sent every second before game starts
 */
export interface CountdownEvent {
  seconds: number;
}

/**
 * Game start event payload - sent when countdown reaches 0
 */
export interface GameStartEvent {
  matchId: string;
  /** Random seed for deterministic RNG (optional for backward compatibility) */
  randomSeed?: number;
}

/**
 * Tick sync event payload - sent every tick for synchronization
 */
export interface TickSyncEvent {
  tick: number;
  timestamp: number;
}

/**
 * Commands batch event payload - sent to all clients each tick
 */
export interface CommandsBatchEvent {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Commands grouped by player for a specific tick
 */
export interface TickCommands {
  [playerId: string]: PlayerCommand[];
}

/**
 * Submit commands event payload from client
 */
export interface SubmitCommandsEvent {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Player queued for matchmaking
 */
export interface QueuedPlayer {
  playerId: string;
  username: string;
  socketId: string;
  joinedAt: number;
}

/**
 * Queue status response
 */
export interface QueueStatusEvent {
  position: number;
  waitTime: number;
}

/**
 * State hash event from client (2.1.3)
 */
export interface StateHashEvent {
  tick: number;
  hash: string;
}

/**
 * Desync detected event (2.1.3)
 */
export interface DesyncDetectedEvent {
  tick: number;
  hashes: { [playerId: string]: string };
}

/**
 * Available Phalanx events
 */
export type PhalanxEventType =
  | 'match-created'
  | 'match-started'
  | 'match-ended'
  | 'player-command'
  | 'player-timeout'
  | 'player-reconnected'
  | 'player-disconnected'
  | 'desync-detected';

/**
 * Event handler types
 */
export interface PhalanxEventHandlers {
  'match-created': (match: MatchInfo) => void;
  'match-started': (match: MatchInfo) => void;
  'match-ended': (matchId: string, reason: string) => void;
  'player-command': (
    playerId: string,
    command: PlayerCommand
  ) => boolean | void;
  'player-timeout': (playerId: string, matchId: string) => void;
  'player-reconnected': (playerId: string, matchId: string) => void;
  'player-disconnected': (playerId: string, matchId: string) => void;
  'desync-detected': (
    matchId: string,
    tick: number,
    hashes: { [playerId: string]: string }
  ) => void;
}
