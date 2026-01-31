/**
 * Phalanx Client
 * Client library for connecting to Phalanx Engine servers
 */

import { EventEmitter } from './EventEmitter.js';
import { RenderLoop } from './RenderLoop.js';
import { SocketManager } from './SocketManager.js';
import { DesyncDetector, type DesyncConfig } from './DesyncDetector.js';
import type {
  PhalanxClientConfig,
  PhalanxClientEvents,
  PlayerCommand,
  MatchFoundEvent,
  CountdownEvent,
  GameStartEvent,
  QueueStatusEvent,
  ReconnectStateEvent,
  SubmitCommandsAck,
  ConnectionState,
  ClientState,
  TickHandler,
  FrameHandler,
  Unsubscribe,
} from './types.js';

/**
 * PhalanxClient - Main client class for connecting to Phalanx Engine servers
 *
 * @example
 * ```typescript
 * const client = await PhalanxClient.create({
 *   serverUrl: 'http://localhost:3000',
 *   playerId: 'player-123',
 *   username: 'MyPlayer',
 * });
 *
 * client.on('matchFound', (data) => console.log('Match found!'));
 * client.on('gameStart', () => console.log('Game started!'));
 *
 * await client.joinQueue();
 *
 * client.onTick((tick, commands) => {
 *   // Process commands and run simulation
 * });
 *
 * client.onFrame((alpha, dt) => {
 *   // Interpolate and render
 * });
 * ```
 */
export class PhalanxClient extends EventEmitter<PhalanxClientEvents> {
  private config: Omit<Required<PhalanxClientConfig>, 'authToken'> & Pick<PhalanxClientConfig, 'authToken'>;
  private socketManager: SocketManager;
  private renderLoop: RenderLoop;
  private desyncDetector: DesyncDetector;

  // State
  private clientState: ClientState = 'idle';
  private currentMatchId: string | null = null;
  private currentTick: number = 0;

  // Pending commands queue
  private pendingCommands: PlayerCommand[] = [];

  constructor(config: PhalanxClientConfig) {
    super();

    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 1000,
      connectionTimeoutMs: 10000,
      tickRate: 20,
      debug: false,
      ...config,
    };

    // Initialize SocketManager with callbacks
    this.socketManager = new SocketManager(
      {
        serverUrl: this.config.serverUrl,
        playerId: this.config.playerId,
        username: this.config.username,
        authToken: this.config.authToken,
        connectionTimeoutMs: this.config.connectionTimeoutMs,
        autoReconnect: this.config.autoReconnect,
        maxReconnectAttempts: this.config.maxReconnectAttempts,
        reconnectDelayMs: this.config.reconnectDelayMs,
        debug: this.config.debug,
      },
      {
        // Connection events
        onConnected: () => this.emit('connected'),
        onDisconnected: () => {
          this.clientState = 'idle';
          this.emit('disconnected');
        },
        onReconnecting: (attempt) => this.emit('reconnecting', attempt),
        onReconnectFailed: () => this.emit('reconnectFailed'),
        onError: (error) => this.emit('error', error),

        // Match lifecycle events
        onMatchFound: (data) => {
          this.currentMatchId = data.matchId;
          this.clientState = 'match-found';
          this.emit('matchFound', data);
        },
        onCountdown: (data) => this.emit('countdown', data),
        onGameStart: (data) => {
          this.clientState = 'playing';
          this.currentTick = 0;
          this.emit('gameStart', data);
        },
        onMatchEnd: (data) => {
          this.clientState = 'finished';
          this.emit('matchEnd', data);
        },

        // Tick events
        onTickSync: (data) => {
          this.currentTick = data.tick;
          this.renderLoop.updateTickTime();
          this.emit('tick', data);
        },
        onCommandsBatch: (data) => {
          this.currentTick = data.tick;
          this.renderLoop.processTick(data.tick, data.commands);
          this.emit('commands', data);
        },

        // Player events
        onPlayerDisconnected: (data) => this.emit('playerDisconnected', data),
        onPlayerReconnected: (data) => this.emit('playerReconnected', data),

        // Reconnection events
        onReconnectState: (data) => {
          this.currentMatchId = data.matchId;
          this.currentTick = data.currentTick;
          this.clientState = data.state === 'playing' ? 'playing' : 'idle';
          this.emit('reconnectState', data);
        },
        onReconnectStatus: (data) => this.emit('reconnectStatus', data),

        // Desync detection events
        onHashComparison: (data) => {
          if (!this.desyncDetector.isEnabled()) return;

          const hasDesync = !this.desyncDetector.compareWithRemote(
            data.tick,
            data.hashes
          );
          if (hasDesync) {
            const localHash = this.desyncDetector.getLocalHash(data.tick);
            this.emit('desync', {
              tick: data.tick,
              localHash: localHash ?? 'unknown',
              remoteHashes: data.hashes,
            });
          }
        },

        // State queries
        isPlaying: () => this.clientState === 'playing',
        getCurrentMatchId: () => this.currentMatchId,
      }
    );

    // Initialize DesyncDetector
    this.desyncDetector = new DesyncDetector();

    // Initialize RenderLoop
    this.renderLoop = new RenderLoop({
      tickRate: this.config.tickRate,
      debug: this.config.debug,
    });

    // Set up command flushing
    this.renderLoop.setCommandFlushCallback(() => this.flushPendingCommands());
  }

  // ============================================
  // STATIC FACTORY
  // ============================================

  /**
   * Create and connect a new PhalanxClient
   * @param config Client configuration
   * @returns Connected PhalanxClient instance
   */
  static async create(config: PhalanxClientConfig): Promise<PhalanxClient> {
    const client = new PhalanxClient(config);
    await client.connect();
    return client;
  }

  // ============================================
  // CONNECTION MANAGEMENT
  // ============================================

  /**
   * Connect to the Phalanx server
   * @returns Promise that resolves when connected
   * @throws Error if connection fails or times out
   */
  async connect(): Promise<void> {
    return this.socketManager.connect();
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.renderLoop.stop();
    this.socketManager.disconnect();

    this.clientState = 'idle';
    this.currentMatchId = null;
    this.currentTick = 0;
    this.pendingCommands = [];
  }

  /**
   * Destroy the client and clean up all resources
   */
  destroy(): void {
    this.renderLoop.dispose();
    this.disconnect();
    this.removeAllListeners();
    this.pendingCommands = [];
  }

  /**
   * Check if client is connected to the server
   */
  isConnected(): boolean {
    return this.socketManager.isConnected();
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.socketManager.getConnectionState();
  }

  /**
   * Get current client state
   */
  getClientState(): ClientState {
    return this.clientState;
  }

  // ============================================
  // QUEUE MANAGEMENT
  // ============================================

  /**
   * Join the matchmaking queue
   * @returns Promise that resolves with queue status
   */
  async joinQueue(): Promise<QueueStatusEvent> {
    const status = await this.socketManager.joinQueue();
    this.clientState = 'in-queue';
    this.emit('queueJoined', status);
    return status;
  }

  /**
   * Leave the matchmaking queue
   */
  leaveQueue(): void {
    this.socketManager.leaveQueue();
    this.clientState = 'idle';
    this.emit('queueLeft');
  }

  /**
   * Wait for a match to be found
   * @returns Promise that resolves with match found event
   */
  async waitForMatch(): Promise<MatchFoundEvent> {
    const data = await this.socketManager.waitForMatch();
    this.currentMatchId = data.matchId;
    this.clientState = 'match-found';
    this.emit('matchFound', data);
    return data;
  }

  /**
   * Join queue and wait for match in one call
   * @returns Promise that resolves with match found event
   */
  async joinQueueAndWaitForMatch(): Promise<MatchFoundEvent> {
    await this.joinQueue();
    return this.waitForMatch();
  }

  // ============================================
  // GAME LIFECYCLE
  // ============================================

  /**
   * Wait for countdown to complete (listening to countdown events)
   * @param onCountdown Optional callback for each countdown tick
   * @returns Promise that resolves when countdown reaches 0
   */
  async waitForCountdown(
    onCountdown?: (event: CountdownEvent) => void
  ): Promise<void> {
    this.clientState = 'countdown';
    return this.socketManager.waitForCountdown(onCountdown);
  }

  /**
   * Wait for the game to start
   * @returns Promise that resolves with game start event
   */
  async waitForGameStart(): Promise<GameStartEvent> {
    const data = await this.socketManager.waitForGameStart();
    this.clientState = 'playing';
    this.currentTick = 0;
    this.emit('gameStart', data);
    return data;
  }

  // ============================================
  // COMMANDS
  // ============================================

  /**
   * Submit commands for a specific tick
   * @param tick The tick number these commands are for
   * @param commands Array of commands to submit
   * @returns Promise that resolves with acknowledgment
   */
  async submitCommands(
    tick: number,
    commands: PlayerCommand[]
  ): Promise<SubmitCommandsAck> {
    this.ensurePlaying();
    return this.socketManager.submitCommands(tick, commands);
  }

  /**
   * Submit commands without waiting for acknowledgment (fire and forget)
   * @param tick The tick number these commands are for
   * @param commands Array of commands to submit
   */
  submitCommandsAsync(tick: number, commands: PlayerCommand[]): void {
    this.ensurePlaying();
    this.socketManager.submitCommandsAsync(tick, commands);
  }

  /**
   * Send a command to the server
   * Commands are buffered and sent automatically each frame
   *
   * @param type Command type (e.g., 'move', 'attack')
   * @param data Command payload
   */
  sendCommand(type: string, data: unknown): void {
    this.pendingCommands.push({ type, data });
  }

  // ============================================
  // SIMPLIFIED API - TICK & FRAME HANDLERS
  // ============================================

  /**
   * Register a callback for simulation ticks
   * Called when the server sends a tick with commands from all players
   *
   * @param handler Callback receiving tick number and commands grouped by player
   * @returns Unsubscribe function
   */
  onTick(handler: TickHandler): Unsubscribe {
    return this.renderLoop.onTick(handler);
  }

  /**
   * Register a callback for render frames
   * Called every animation frame (~60fps) with interpolation alpha
   * Automatically starts the render loop when first handler is added
   *
   * @param handler Callback receiving alpha (0-1) and delta time in seconds
   * @returns Unsubscribe function
   */
  onFrame(handler: FrameHandler): Unsubscribe {
    return this.renderLoop.onFrame(handler);
  }

  // ============================================
  // RECONNECTION
  // ============================================

  /**
   * Attempt to reconnect to a match after disconnection
   * @param matchId The match ID to reconnect to
   * @returns Promise that resolves with reconnection state
   */
  async reconnectToMatch(matchId: string): Promise<ReconnectStateEvent> {
    this.clientState = 'reconnecting';
    return this.socketManager.reconnectToMatch(matchId);
  }

  /**
   * Attempt automatic reconnection with retries
   * @returns Promise that resolves when reconnected, rejects if all attempts fail
   */
  async attemptReconnection(): Promise<void> {
    return this.socketManager.attemptReconnection();
  }

  // ============================================
  // DESYNC DETECTION
  // ============================================

  /**
   * Submit state hash for desync detection
   * Call this after each simulation tick (or every N ticks based on your preference)
   *
   * The game is responsible for computing the hash using StateHasher or
   * a custom implementation. The SDK just handles transport and comparison.
   *
   * @param tick - The tick this hash is for
   * @param hash - Hash computed by game (any string)
   *
   * @example
   * ```typescript
   * client.onTick((tick, commands) => {
   *   simulation.processTick(tick, commands);
   *
   *   // Submit hash every 20 ticks (once per second at 20 TPS)
   *   if (tick % 20 === 0) {
   *     const hash = computeGameStateHash(tick);
   *     client.submitStateHash(tick, hash);
   *   }
   * });
   * ```
   */
  submitStateHash(tick: number, hash: string): void {
    this.desyncDetector.recordLocalHash(tick, hash);
    if (this.isConnected()) {
      this.socketManager.sendStateHash(tick, hash);
    }
  }

  /**
   * Configure desync detection
   * @param config - Configuration options for desync detection
   *
   * @example
   * ```typescript
   * // Disable desync detection
   * client.configureDesyncDetection({ enabled: false });
   *
   * // Limit stored hashes
   * client.configureDesyncDetection({ maxStoredHashes: 50 });
   * ```
   */
  configureDesyncDetection(config: Partial<DesyncConfig>): void {
    this.desyncDetector.configure(config);
  }

  // ============================================
  // STATE GETTERS
  // ============================================

  /**
   * Get current tick number
   */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Get current match ID
   */
  getMatchId(): string | null {
    return this.currentMatchId;
  }

  /**
   * Get player ID configured for this client
   */
  getPlayerId(): string {
    return this.config.playerId;
  }

  /**
   * Get username configured for this client
   */
  getUsername(): string {
    return this.config.username;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private flushPendingCommands(): void {
    if (
      this.pendingCommands.length > 0 &&
      this.isConnected() &&
      this.clientState === 'playing'
    ) {
      this.submitCommandsAsync(this.currentTick, this.pendingCommands);
      this.pendingCommands = [];
    }
  }

  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error('Not connected to server. Call connect() first.');
    }
  }

  private ensurePlaying(): void {
    this.ensureConnected();
    if (this.clientState !== 'playing' && this.clientState !== 'reconnecting') {
      throw new Error('Not in a game. Join a match first.');
    }
  }
}
