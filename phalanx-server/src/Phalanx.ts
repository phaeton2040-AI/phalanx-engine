import { EventEmitter } from 'events';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer, Server as HttpServer } from 'http';
import type {
  PhalanxConfig,
  MatchInfo,
  PlayerCommand,
  PhalanxEventType,
  PhalanxEventHandlers,
  SubmitCommandsEvent,
} from './types/index.js';
import { validateConfig } from './config/validation.js';
import { MatchmakingService } from './services/MatchmakingService.js';

/**
 * Phalanx Engine
 * A game-agnostic deterministic lockstep multiplayer engine
 */
export class Phalanx extends EventEmitter {
  private readonly config: PhalanxConfig;
  private httpServer: HttpServer | null = null;
  private io: SocketIOServer | null = null;
  private matchmaking: MatchmakingService | null = null;
  private isRunning: boolean = false;

  constructor(config?: Partial<PhalanxConfig>) {
    super();
    this.config = validateConfig(config);
  }

  /**
   * Start the Phalanx server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Phalanx server is already running');
    }

    // Create HTTP server
    this.httpServer = createServer();

    // Create Socket.IO server
    this.io = new SocketIOServer(this.httpServer, {
      cors: this.config.cors,
    });

    // Create matchmaking service
    this.matchmaking = new MatchmakingService(
      this.io,
      this.config,
      (event: string, ...args: unknown[]) => this.emit(event, ...args)
    );

    // Setup socket handlers
    this.setupSocketHandlers();

    // Start matchmaking
    this.matchmaking.start();

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.port, () => {
        this.isRunning = true;
        resolve();
      });

      this.httpServer!.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Stop the Phalanx server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop matchmaking first
    if (this.matchmaking) {
      this.matchmaking.stop();
      this.matchmaking = null;
    }

    // Disconnect all sockets first
    if (this.io) {
      this.io.disconnectSockets(true);
    }

    // Close HTTP server (this also closes Socket.IO)
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.io = null;
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      let playerId: string | null = null;

      // Track activity on ANY message from client (LOCKSTEP-5)
      // This replaces tick-ack - any message = player is alive
      socket.onAny(() => {
        if (playerId && socket.data.matchId) {
          const gameRoom = this.matchmaking?.getMatch(socket.data.matchId);
          if (gameRoom) {
            gameRoom.updatePlayerActivity(playerId);
          }
        }
      });

      // Handle join queue (MATCH-1)
      socket.on('queue-join', (data: { playerId: string; username?: string }) => {
        playerId = data.playerId;
        const username = data.username ?? data.playerId;
        this.matchmaking!.joinQueue(playerId, username, socket);
      });

      // Handle leave queue (MATCH-2)
      socket.on('queue-leave', () => {
        if (playerId) {
          this.matchmaking!.leaveQueue(playerId, socket);
        }
      });

      // Handle player command
      socket.on('player-command', (command: PlayerCommand) => {
        if (!playerId) return;

        // Find the match this player is in
        for (const match of this.matchmaking!.getActiveMatches()) {
          const gameRoom = this.matchmaking!.getMatch(match.id);
          if (gameRoom) {
            const accepted = gameRoom.handleCommand(playerId, command);
            if (accepted) {
              socket.emit('command-ack', { tick: command.tick, accepted: true });
              return;
            }
          }
        }

        socket.emit('command-ack', { tick: command.tick, accepted: false });
      });

      // Handle submit-commands (LOCKSTEP-2): batch command submission for a specific tick
      // Clients can submit empty arrays if they have no commands for this tick
      socket.on('submit-commands', (data: SubmitCommandsEvent) => {
        if (!playerId) return;

        const { tick, commands } = data;

        // Validate input
        if (typeof tick !== 'number' || !Array.isArray(commands)) {
          socket.emit('submit-commands-ack', { tick, accepted: false, reason: 'Invalid data' });
          return;
        }

        // Find the match this player is in via socket.data
        const matchId = socket.data.matchId;
        if (!matchId) {
          socket.emit('submit-commands-ack', { tick, accepted: false, reason: 'Not in a match' });
          return;
        }

        const gameRoom = this.matchmaking!.getMatch(matchId);
        if (!gameRoom) {
          socket.emit('submit-commands-ack', { tick, accepted: false, reason: 'Match not found' });
          return;
        }

        // Validate each command (NET-1)
        const validCommands: PlayerCommand[] = [];
        for (const cmd of commands) {
          // Validate required fields
          if (typeof cmd.type !== 'string' || cmd.data === undefined) {
            socket.emit('command-rejected', {
              reason: 'Missing required fields (type, data)',
              tick,
              type: cmd.type,
            });
            console.log(`[NET] Rejected command from ${playerId}: Missing required fields`);
            continue;
          }

          // Enrich command with playerId and tick, preserve sequence if present
          const enrichedCommand: PlayerCommand = {
            type: cmd.type,
            data: cmd.data,
            playerId: playerId!,
            tick,
            ...(cmd.sequence !== undefined && { sequence: cmd.sequence }),
          };

          validCommands.push(enrichedCommand);
        }

        const result = gameRoom.receivePlayerCommands(playerId, tick, validCommands);
        socket.emit('submit-commands-ack', {
          tick,
          accepted: result.accepted,
          ...(result.invalidCommands && { rejectedCount: result.invalidCommands.length })
        });
      });

      // Handle state-hash for desync detection (2.1.3)
      socket.on('state-hash', (data: { tick: number; hash: string }) => {
        if (!playerId) return;

        const { tick, hash } = data;

        // Validate input
        if (typeof tick !== 'number' || typeof hash !== 'string') {
          return;
        }

        const matchId = socket.data.matchId;
        if (!matchId) return;

        const gameRoom = this.matchmaking!.getMatch(matchId);
        if (gameRoom) {
          gameRoom.receiveStateHash(playerId, tick, hash);
        }
      });

      // Note: tick-ack is no longer needed - we use socket.onAny() to track activity
      // Any message from client (including Socket.IO ping) = player is alive

      // Handle reconnection
      socket.on('reconnect-match', (data: { playerId: string; matchId: string }) => {
        playerId = data.playerId;
        const gameRoom = this.matchmaking!.getMatch(data.matchId);
        if (gameRoom) {
          const success = gameRoom.handleReconnect(playerId, socket.id);
          socket.emit('reconnect-status', { success });
        } else {
          socket.emit('reconnect-status', { success: false, reason: 'Match not found' });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        if (this.matchmaking) {
          this.matchmaking.handleDisconnect(socket.id);
        }
      });
    });
  }

  /**
   * Register an event handler
   */
  override on<E extends PhalanxEventType>(
    event: E,
    handler: PhalanxEventHandlers[E]
  ): this {
    return super.on(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Remove an event handler
   */
  override off<E extends PhalanxEventType>(
    event: E,
    handler: PhalanxEventHandlers[E]
  ): this {
    return super.off(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Get all active matches
   */
  getActiveMatches(): MatchInfo[] {
    return this.matchmaking?.getActiveMatches() ?? [];
  }

  /**
   * Get current matchmaking queue size
   */
  getQueueSize(): number {
    return this.matchmaking?.getQueueSize() ?? 0;
  }

  /**
   * Get the current configuration
   */
  getConfig(): PhalanxConfig {
    return { ...this.config };
  }
}
