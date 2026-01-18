/**
 * Phalanx Client Types
 * Types for the client-side library
 */

/**
 * Configuration for the Phalanx client
 */
export interface PhalanxClientConfig {
  /**
   * URL of the Phalanx server (e.g., 'http://localhost:3000')
   */
  serverUrl: string;

  /**
   * Unique identifier for this player
   */
  playerId: string;

  /**
   * Display name for this player
   */
  username: string;

  /**
   * Whether to automatically attempt reconnection after disconnection
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Maximum number of reconnection attempts
   * @default 5
   */
  maxReconnectAttempts?: number;

  /**
   * Delay between reconnection attempts in milliseconds
   * @default 1000
   */
  reconnectDelayMs?: number;

  /**
   * Connection timeout in milliseconds
   * @default 10000
   */
  connectionTimeoutMs?: number;
}

/**
 * A command sent from or to players
 * When received from server, includes playerId and tick added by server
 */
export interface PlayerCommand {
  type: string;
  data: unknown;
  /** Added by server when broadcasting - identifies the player who sent the command */
  playerId?: string;
  /** Added by server when broadcasting - the tick this command was submitted for */
  tick?: number;
}

/**
 * Information about a player in match-found event
 */
export interface MatchPlayerInfo {
  playerId: string;
  username: string;
}

/**
 * Event received when a match is found
 */
export interface MatchFoundEvent {
  matchId: string;
  playerId: string;
  teamId: number;
  teammates: MatchPlayerInfo[];
  opponents: MatchPlayerInfo[];
}

/**
 * Event received during countdown before game starts
 */
export interface CountdownEvent {
  seconds: number;
}

/**
 * Event received when the game starts
 */
export interface GameStartEvent {
  matchId: string;
  /** Random seed for deterministic RNG (optional for backward compatibility) */
  randomSeed?: number;
}

/**
 * Event received on each tick for synchronization
 */
export interface TickSyncEvent {
  tick: number;
  timestamp: number;
}

/**
 * Commands batch received each tick from the server
 */
export interface CommandsBatchEvent {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Queue status event received after joining queue
 */
export interface QueueStatusEvent {
  position: number;
  waitTime: number;
}

/**
 * Event received when another player disconnects
 */
export interface PlayerDisconnectedEvent {
  playerId: string;
  gracePeriodMs: number;
}

/**
 * Event received when another player reconnects
 */
export interface PlayerReconnectedEvent {
  playerId: string;
}

/**
 * State received when reconnecting to a match
 */
export interface ReconnectStateEvent {
  matchId: string;
  currentTick: number;
  state: 'countdown' | 'playing' | 'paused' | 'finished';
  recentCommands: TickCommandsHistory[];
}

/**
 * Commands history for a specific tick (used in reconnection)
 */
export interface TickCommandsHistory {
  tick: number;
  commands: PlayerCommand[];
}

/**
 * Reconnection status response
 */
export interface ReconnectStatusEvent {
  success: boolean;
  reason?: string;
}

/**
 * Acknowledgment for submitted commands
 */
export interface SubmitCommandsAck {
  accepted: boolean;
  reason?: string;
}

/**
 * Event received when match ends
 */
export interface MatchEndEvent {
  reason: string;
}

/**
 * Error event from the server
 */
export interface PhalanxError {
  message: string;
  code?: string;
}

/**
 * Connection state of the client
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/**
 * Client state (overall lifecycle)
 */
export type ClientState =
  | 'idle'
  | 'in-queue'
  | 'match-found'
  | 'countdown'
  | 'playing'
  | 'reconnecting'
  | 'finished';

/**
 * Events emitted by PhalanxClient
 */
export interface PhalanxClientEvents {
  // Connection events
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
  reconnectFailed: () => void;
  error: (error: PhalanxError) => void;

  // Queue events
  queueJoined: (status: QueueStatusEvent) => void;
  queueLeft: () => void;
  queueError: (error: PhalanxError) => void;

  // Match events
  matchFound: (event: MatchFoundEvent) => void;
  countdown: (event: CountdownEvent) => void;
  gameStart: (event: GameStartEvent) => void;
  matchEnd: (event: MatchEndEvent) => void;

  // Tick events
  tick: (event: TickSyncEvent) => void;
  commands: (event: CommandsBatchEvent) => void;

  // Player events
  playerDisconnected: (event: PlayerDisconnectedEvent) => void;
  playerReconnected: (event: PlayerReconnectedEvent) => void;

  // Reconnection events
  reconnectState: (event: ReconnectStateEvent) => void;
  reconnectStatus: (event: ReconnectStatusEvent) => void;
}
