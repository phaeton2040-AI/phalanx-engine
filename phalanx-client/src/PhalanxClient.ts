/**
 * Phalanx Client
 * Client library for connecting to Phalanx Engine servers
 */

import { io, Socket } from 'socket.io-client';
import type {
  PhalanxClientConfig,
  PhalanxClientEvents,
  PlayerCommand,
  MatchFoundEvent,
  CountdownEvent,
  GameStartEvent,
  TickSyncEvent,
  CommandsBatchEvent,
  QueueStatusEvent,
  PlayerDisconnectedEvent,
  PlayerReconnectedEvent,
  ReconnectStateEvent,
  ReconnectStatusEvent,
  SubmitCommandsAck,
  MatchEndEvent,
  PhalanxError,
  ConnectionState,
  ClientState,
} from './types.js';

type EventHandler<T extends keyof PhalanxClientEvents> = PhalanxClientEvents[T];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandlers = Map<keyof PhalanxClientEvents, Set<any>>;

/**
 * PhalanxClient - Main client class for connecting to Phalanx Engine servers
 *
 * @example
 * ```typescript
 * const client = new PhalanxClient({
 *   serverUrl: 'http://localhost:3000',
 *   playerId: 'player-123',
 *   username: 'MyPlayer',
 * });
 *
 * await client.connect();
 * const match = await client.joinQueue();
 * await client.waitForGameStart();
 *
 * client.on('tick', (data) => {
 *   console.log(`Tick ${data.tick}`);
 * });
 * ```
 */
export class PhalanxClient {
  private socket: Socket | null = null;
  private config: Required<PhalanxClientConfig>;
  private eventHandlers: EventHandlers = new Map();

  // State
  private connectionState: ConnectionState = 'disconnected';
  private clientState: ClientState = 'idle';
  private currentMatchId: string | null = null;
  private currentTick: number = 0;
  private reconnectAttempts: number = 0;

  constructor(config: PhalanxClientConfig) {
    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 1000,
      connectionTimeoutMs: 10000,
      ...config,
    };
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
    if (this.connectionState === 'connected') {
      return;
    }

    this.connectionState = 'connecting';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.disconnect();
        this.connectionState = 'disconnected';
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeoutMs);

      this.socket = io(this.config.serverUrl, {
        forceNew: true,
        reconnection: false, // We handle reconnection ourselves
      });

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.setupSocketEventHandlers();
        this.emit('connected');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        this.connectionState = 'disconnected';
        reject(new Error(`Connection failed: ${error.message}`));
      });
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.connectionState = 'disconnected';
    this.clientState = 'idle';
    this.currentMatchId = null;
    this.currentTick = 0;

    this.emit('disconnected');
  }

  /**
   * Check if client is connected to the server
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.socket?.connected === true;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
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
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      const errorHandler = (error: PhalanxError) => {
        this.socket?.off('queue-status', statusHandler);
        reject(new Error(error.message));
      };

      const statusHandler = (status: QueueStatusEvent) => {
        this.socket?.off('queue-error', errorHandler);
        this.clientState = 'in-queue';
        this.emit('queueJoined', status);
        resolve(status);
      };

      this.socket!.once('queue-status', statusHandler);
      this.socket!.once('queue-error', errorHandler);

      this.socket!.emit('queue-join', {
        playerId: this.config.playerId,
        username: this.config.username,
      });
    });
  }

  /**
   * Leave the matchmaking queue
   */
  leaveQueue(): void {
    this.ensureConnected();

    this.socket!.emit('queue-leave', {
      playerId: this.config.playerId,
    });

    this.clientState = 'idle';
    this.emit('queueLeft');
  }

  /**
   * Wait for a match to be found
   * @returns Promise that resolves with match found event
   */
  async waitForMatch(): Promise<MatchFoundEvent> {
    this.ensureConnected();

    return new Promise((resolve) => {
      this.socket!.once('match-found', (data: MatchFoundEvent) => {
        this.currentMatchId = data.matchId;
        this.clientState = 'match-found';
        this.emit('matchFound', data);
        resolve(data);
      });
    });
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
    this.ensureConnected();
    this.clientState = 'countdown';

    return new Promise((resolve) => {
      const countdownHandler = (data: CountdownEvent) => {
        this.emit('countdown', data);
        onCountdown?.(data);

        if (data.seconds === 0) {
          this.socket?.off('countdown', countdownHandler);
          resolve();
        }
      };

      this.socket!.on('countdown', countdownHandler);
    });
  }

  /**
   * Wait for the game to start
   * @returns Promise that resolves with game start event
   */
  async waitForGameStart(): Promise<GameStartEvent> {
    this.ensureConnected();

    return new Promise((resolve) => {
      this.socket!.once('game-start', (data: GameStartEvent) => {
        this.clientState = 'playing';
        this.currentTick = 0;
        this.emit('gameStart', data);
        resolve(data);
      });
    });
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
    this.ensureConnected();
    this.ensurePlaying();

    return new Promise((resolve) => {
      this.socket!.once('submit-commands-ack', (ack: SubmitCommandsAck) => {
        resolve(ack);
      });

      this.socket!.emit('submit-commands', {
        tick,
        commands,
      });
    });
  }

  /**
   * Submit commands without waiting for acknowledgment (fire and forget)
   * @param tick The tick number these commands are for
   * @param commands Array of commands to submit
   */
  submitCommandsAsync(tick: number, commands: PlayerCommand[]): void {
    this.ensureConnected();
    this.ensurePlaying();

    this.socket!.emit('submit-commands', {
      tick,
      commands,
    });
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
    this.ensureConnected();

    this.clientState = 'reconnecting';

    return new Promise((resolve, reject) => {
      const statusHandler = (status: ReconnectStatusEvent) => {
        this.emit('reconnectStatus', status);
        if (!status.success) {
          this.socket?.off('reconnect-state', stateHandler);
          this.clientState = 'idle';
          reject(new Error(status.reason || 'Reconnection failed'));
        }
      };

      const stateHandler = (state: ReconnectStateEvent) => {
        this.socket?.off('reconnect-status', statusHandler);
        this.currentMatchId = state.matchId;
        this.currentTick = state.currentTick;
        this.clientState = state.state === 'playing' ? 'playing' : 'idle';
        this.emit('reconnectState', state);
        resolve(state);
      };

      this.socket!.once('reconnect-status', statusHandler);
      this.socket!.once('reconnect-state', stateHandler);

      this.socket!.emit('reconnect-match', {
        playerId: this.config.playerId,
        matchId,
      });
    });
  }

  /**
   * Attempt automatic reconnection with retries
   * @returns Promise that resolves when reconnected, rejects if all attempts fail
   */
  async attemptReconnection(): Promise<void> {
    if (!this.config.autoReconnect) {
      throw new Error('Auto-reconnect is disabled');
    }

    const savedMatchId = this.currentMatchId;
    this.connectionState = 'reconnecting';

    while (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.emit('reconnecting', this.reconnectAttempts);

      try {
        await this.delay(this.config.reconnectDelayMs);
        await this.connect();

        if (savedMatchId) {
          await this.reconnectToMatch(savedMatchId);
        }

        return;
      } catch {
        // Continue to next attempt
      }
    }

    this.emit('reconnectFailed');
    throw new Error('Max reconnection attempts reached');
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
  // EVENT HANDLING
  // ============================================

  /**
   * Subscribe to an event
   * @param event Event name
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  on<K extends keyof PhalanxClientEvents>(
    event: K,
    handler: EventHandler<K>
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }

    this.eventHandlers.get(event)!.add(handler);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Subscribe to an event once (automatically unsubscribes after first call)
   * @param event Event name
   * @param handler Event handler function
   */
  once<K extends keyof PhalanxClientEvents>(
    event: K,
    handler: EventHandler<K>
  ): void {
    const wrapper = ((...args: Parameters<EventHandler<K>>) => {
      this.off(event, wrapper as EventHandler<K>);
      (handler as (...args: Parameters<EventHandler<K>>) => void)(...args);
    }) as EventHandler<K>;

    this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event
   * @param event Event name
   * @param handler Event handler function to remove
   */
  off<K extends keyof PhalanxClientEvents>(
    event: K,
    handler: EventHandler<K>
  ): void {
    const handlers = this.eventHandlers.get(event);
    handlers?.delete(handler);
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(): void {
    this.eventHandlers.clear();
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private emit<K extends keyof PhalanxClientEvents>(
    event: K,
    ...args: Parameters<EventHandler<K>>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...args: Parameters<EventHandler<K>>) => void)(...args);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      }
    }
  }

  private setupSocketEventHandlers(): void {
    if (!this.socket) return;

    // Tick synchronization
    this.socket.on('tick-sync', (data: TickSyncEvent) => {
      this.currentTick = data.tick;
      this.emit('tick', data);
    });

    // Commands batch
    this.socket.on('commands-batch', (data: CommandsBatchEvent) => {
      this.emit('commands', data);
    });

    // Player events
    this.socket.on('player-disconnected', (data: PlayerDisconnectedEvent) => {
      this.emit('playerDisconnected', data);
    });

    this.socket.on('player-reconnected', (data: PlayerReconnectedEvent) => {
      this.emit('playerReconnected', data);
    });

    // Match end
    this.socket.on('match-end', (data: MatchEndEvent) => {
      this.clientState = 'finished';
      this.emit('matchEnd', data);
    });

    // Disconnection handling
    this.socket.on('disconnect', () => {
      const wasPlaying = this.clientState === 'playing';
      this.connectionState = 'disconnected';
      this.emit('disconnected');

      if (wasPlaying && this.config.autoReconnect) {
        this.attemptReconnection().catch(() => {
          // Reconnection failed, already emitted reconnectFailed event
        });
      }
    });

    // Error handling
    this.socket.on('error', (error: PhalanxError) => {
      this.emit('error', error);
    });
  }

  private ensureConnected(): void {
    if (!this.socket || !this.isConnected()) {
      throw new Error('Not connected to server. Call connect() first.');
    }
  }

  private ensurePlaying(): void {
    if (this.clientState !== 'playing' && this.clientState !== 'reconnecting') {
      throw new Error('Not in a game. Join a match first.');
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
