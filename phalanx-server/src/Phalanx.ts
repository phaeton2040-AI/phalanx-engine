import { EventEmitter } from 'events';
import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  createServer as createHttpServer,
  Server as HttpServer,
  IncomingMessage,
  ServerResponse,
} from 'http';
import {
  createServer as createHttpsServer,
  Server as HttpsServer,
} from 'https';
import { readFileSync } from 'fs';
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
import { TokenValidatorService } from './services/TokenValidator.js';

/**
 * Socket data interface for type safety
 */
interface SocketData {
  matchId?: string;
  playerId?: string;
  /** Authenticated user ID from token validation */
  userId?: string;
  /** Authenticated username from token validation */
  username?: string;
  /** Whether this socket is authenticated */
  authenticated?: boolean;
}

/**
 * Phalanx Engine
 * A game-agnostic deterministic lockstep multiplayer engine
 */
export class Phalanx extends EventEmitter {
  private readonly config: PhalanxConfig;
  private httpServer: HttpServer | HttpsServer | null = null;
  private io: SocketIOServer | null = null;
  private matchmaking: MatchmakingService | null = null;
  private tokenValidator: TokenValidatorService | null = null;
  private isRunning: boolean = false;

  constructor(config?: Partial<PhalanxConfig>) {
    super();
    this.config = validateConfig(config);
  }

  /**
   * Create HTTP or HTTPS server based on TLS configuration
   */
  private createServer(): HttpServer | HttpsServer {
    const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            tls: !!this.config.tls?.enabled,
          })
        );
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    };

    if (this.config.tls?.enabled) {
      try {
        const tlsOptions = {
          key: readFileSync(this.config.tls.keyPath),
          cert: readFileSync(this.config.tls.certPath),
          ca: this.config.tls.caPath
            ? readFileSync(this.config.tls.caPath)
            : undefined,
        };

        console.log('[Phalanx] Starting with TLS enabled (WSS)');
        return createHttpsServer(tlsOptions, requestHandler);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to load TLS certificates: ${message}`);
      }
    }

    console.log('[Phalanx] Starting without TLS (development mode)');
    return createHttpServer(requestHandler);
  }

  /**
   * Start the Phalanx server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Phalanx server is already running');
    }

    // Create HTTP/HTTPS server with health check endpoint
    this.httpServer = this.createServer();

    // Create Socket.IO server
    this.io = new SocketIOServer(this.httpServer, {
      cors: this.config.cors,
    });

    // Setup authentication if enabled
    if (this.config.auth?.enabled) {
      this.tokenValidator = new TokenValidatorService(this.config.auth);
      this.setupAuthMiddleware();
      console.log('[Phalanx] Authentication enabled');
    } else {
      console.log('[Phalanx] Authentication disabled (development mode)');
    }

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
   * Setup authentication middleware for Socket.IO connections.
   * Validates tokens before allowing connections.
   */
  private setupAuthMiddleware(): void {
    if (!this.io || !this.tokenValidator) return;

    this.io.use(async (socket, next) => {
      const token = socket.handshake.auth?.token as string | undefined;

      // Check if token is provided
      if (!token) {
        // Allow anonymous if configured
        if (this.config.auth?.allowAnonymous) {
          console.log(
            `[Phalanx] Anonymous connection allowed: ${socket.id}`
          );
          (socket.data as SocketData).authenticated = false;
          return next();
        }

        console.log(`[Phalanx] Connection rejected - no token: ${socket.id}`);
        return next(new Error('Authentication required'));
      }

      // Validate the token
      const result = await this.tokenValidator!.validate(token);

      if (!result.valid) {
        console.log(
          `[Phalanx] Connection rejected - invalid token: ${socket.id} - ${result.error}`
        );
        return next(new Error(result.error || 'Invalid token'));
      }

      // Store authenticated user info on socket
      (socket.data as SocketData).authenticated = true;
      (socket.data as SocketData).userId = result.userId;
      (socket.data as SocketData).username = result.username;

      console.log(
        `[Phalanx] Authenticated connection: ${socket.id} - User: ${result.userId}`
      );
      next();
    });
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
        if (playerId && (socket.data as SocketData).matchId) {
          const gameRoom = this.matchmaking?.getMatch(
            (socket.data as SocketData).matchId!
          );
          if (gameRoom) {
            gameRoom.updatePlayerActivity(playerId);
          }
        }
      });

      // Handle join queue (MATCH-1)
      socket.on(
        'queue-join',
        (data: { playerId: string; username?: string }) => {
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.matchmaking!.joinQueue(playerId, username, socket);
        }
      );

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
              socket.emit('command-ack', {
                tick: command.tick,
                accepted: true,
              });
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
        if (!Number.isFinite(tick) || !Array.isArray(commands)) {
          socket.emit('submit-commands-ack', {
            tick,
            accepted: false,
            reason: 'Invalid data',
          });
          return;
        }

        // Find the match this player is in via socket.data
        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) {
          socket.emit('submit-commands-ack', {
            tick,
            accepted: false,
            reason: 'Not in a match',
          });
          return;
        }

        const gameRoom = this.matchmaking!.getMatch(matchId);
        if (!gameRoom) {
          socket.emit('submit-commands-ack', {
            tick,
            accepted: false,
            reason: 'Match not found',
          });
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
            continue;
          }

          // Enrich command with playerId and tick, preserve sequence if present
          const enrichedCommand: PlayerCommand = {
            type: cmd.type,
            data: cmd.data,
            playerId: playerId,
            tick,
            ...(cmd.sequence !== undefined && { sequence: cmd.sequence }),
          };

          validCommands.push(enrichedCommand);
        }

        const result = gameRoom.receivePlayerCommands(
          playerId,
          tick,
          validCommands
        );
        socket.emit('submit-commands-ack', {
          tick,
          accepted: result.accepted,
          ...(result.invalidCommands && {
            rejectedCount: result.invalidCommands.length,
          }),
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

        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) return;

        const gameRoom = this.matchmaking!.getMatch(matchId);
        if (gameRoom) {
          gameRoom.receiveStateHash(playerId, tick, hash);
        }
      });

      // Note: tick-ack is no longer needed - we use socket.onAny() to track activity
      // Any message from client (including Socket.IO ping) = player is alive

      // Handle reconnection
      socket.on(
        'reconnect-match',
        (data: { playerId: string; matchId: string }) => {
          playerId = data.playerId;
          const gameRoom = this.matchmaking!.getMatch(data.matchId);
          if (gameRoom) {
            const success = gameRoom.handleReconnect(playerId, socket.id);
            socket.emit('reconnect-status', { success });
          } else {
            socket.emit('reconnect-status', {
              success: false,
              reason: 'Match not found',
            });
          }
        }
      );

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
