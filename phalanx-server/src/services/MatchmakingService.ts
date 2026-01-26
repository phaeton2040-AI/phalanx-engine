import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  PhalanxConfig,
  QueuedPlayer,
  MatchInfo,
  QueueStatusEvent,
} from '../types/index.js';
import { resolveGameMode } from '../config/validation.js';
import { GameRoom } from './GameRoom.js';

/**
 * Matchmaking Service
 * Handles player queue and match creation
 */
export class MatchmakingService {
  private queue: Map<string, QueuedPlayer> = new Map();
  private matches: Map<string, GameRoom> = new Map();
  private matchmakingInterval: NodeJS.Timeout | null = null;
  private readonly config: PhalanxConfig;
  private readonly io: SocketIOServer;
  private readonly eventEmitter: (
    event: string,
    ...args: unknown[]
  ) => boolean | void;

  constructor(
    io: SocketIOServer,
    config: PhalanxConfig,
    eventEmitter: (event: string, ...args: unknown[]) => boolean | void
  ) {
    this.io = io;
    this.config = config;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start the matchmaking service
   */
  start(): void {
    this.matchmakingInterval = setInterval(() => {
      this.tryCreateMatch();
    }, this.config.matchmakingIntervalMs);
  }

  /**
   * Stop the matchmaking service
   */
  stop(): void {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
      this.matchmakingInterval = null;
    }

    // Stop all active matches
    for (const match of this.matches.values()) {
      match.stop();
    }
    this.matches.clear();
    this.queue.clear();
  }

  /**
   * Add a player to the matchmaking queue
   */
  joinQueue(playerId: string, username: string, socket: Socket): void {
    // Check not already in queue
    if (this.queue.has(playerId)) {
      socket.emit('error', { message: 'Already in queue' });
      return;
    }

    this.queue.set(playerId, {
      playerId,
      username,
      socketId: socket.id,
      joinedAt: Date.now(),
    });

    const position = this.queue.size;
    const waitTime = this.estimateWaitTime();

    console.log(`[QUEUE] ${username} joined. Queue size: ${this.queue.size}`);

    socket.emit('queue-status', {
      position,
      waitTime,
    } as QueueStatusEvent);
  }

  /**
   * Estimate wait time in milliseconds
   * Minimum 1 second, based on matchmaking interval and queue position
   */
  private estimateWaitTime(): number {
    const { playersPerMatch } = resolveGameMode(this.config.gameMode);
    const queueSize = this.queue.size;

    // Estimate how many matchmaking cycles needed
    const cyclesNeeded = Math.ceil(queueSize / playersPerMatch);
    const estimatedMs = cyclesNeeded * this.config.matchmakingIntervalMs;

    // Minimum wait time is 1 second
    return Math.max(1000, estimatedMs);
  }

  /**
   * Remove a player from the matchmaking queue
   */
  leaveQueue(playerId: string, socket: Socket): void {
    const player = this.queue.get(playerId);
    if (!player) {
      // Player not in queue - do nothing (no error per Story-2)
      return;
    }

    this.queue.delete(playerId);
    socket.emit('queue-left');
    console.log(
      `[QUEUE] ${player.username} left. Queue size: ${this.queue.size}`
    );
  }

  /**
   * Try to create a match from queued players
   */
  private tryCreateMatch(): void {
    const { playersPerMatch } = resolveGameMode(this.config.gameMode);

    if (this.queue.size < playersPerMatch) {
      return;
    }

    // Get the required number of players from the queue
    const players: QueuedPlayer[] = [];
    const queueIterator = this.queue.values();

    for (let i = 0; i < playersPerMatch; i++) {
      const player = queueIterator.next().value;
      if (player) {
        players.push(player);
      }
    }

    if (players.length !== playersPerMatch) {
      return;
    }

    // Safe check: ensure no duplicate players (players not matched with themselves)
    const playerIds = new Set(players.map((p) => p.playerId));
    if (playerIds.size !== players.length) {
      console.warn(
        '[MATCH] Duplicate player detected, skipping match creation'
      );
      return;
    }

    // Remove players from queue
    for (const player of players) {
      this.queue.delete(player.playerId);
    }

    // Distribute players into teams
    const teams = this.distributeIntoTeams(players);

    // Generate match ID first for logging
    const matchId = this.generateMatchId();

    // Log match creation with team composition
    this.logMatchCreation(teams, matchId);

    // Create new game room
    const gameRoom = new GameRoom(
      matchId,
      this.io,
      this.config,
      teams,
      this.eventEmitter
    );

    this.matches.set(matchId, gameRoom);

    // Emit match-created event
    this.eventEmitter('match-created', gameRoom.getMatchInfo());

    // Start the match
    gameRoom.start();
  }

  /**
   * Distribute players evenly into teams
   */
  private distributeIntoTeams(players: QueuedPlayer[]): QueuedPlayer[][] {
    const { teamsCount } = resolveGameMode(this.config.gameMode);
    const playersPerTeam = players.length / teamsCount;
    const teams: QueuedPlayer[][] = [];

    for (let t = 0; t < teamsCount; t++) {
      const start = t * playersPerTeam;
      teams.push(players.slice(start, start + playersPerTeam));
    }

    return teams;
  }

  /**
   * Log match creation with team composition
   */
  private logMatchCreation(teams: QueuedPlayer[][], matchId: string): void {
    const teamNames = teams.map(
      (team, i) => `Team${i + 1}: [${team.map((p) => p.username).join(', ')}]`
    );
    console.log(`[MATCH] ${teamNames.join(' vs ')} (${matchId})`);
  }

  /**
   * Get information about a specific match
   */
  getMatch(matchId: string): GameRoom | undefined {
    return this.matches.get(matchId);
  }

  /**
   * Remove a finished match
   */
  removeMatch(matchId: string): void {
    const match = this.matches.get(matchId);
    if (match) {
      match.stop();
      this.matches.delete(matchId);
    }
  }

  /**
   * Get all active matches info
   */
  getActiveMatches(): MatchInfo[] {
    return Array.from(this.matches.values()).map((m) => m.getMatchInfo());
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.size;
  }

  /**
   * Handle player disconnection
   */
  handleDisconnect(socketId: string): void {
    // Remove from queue
    for (const [playerId, player] of this.queue.entries()) {
      if (player.socketId === socketId) {
        this.queue.delete(playerId);
        console.log(
          `[QUEUE] ${player.username} disconnected. Queue size: ${this.queue.size}`
        );
        break;
      }
    }

    // Notify matches
    for (const match of this.matches.values()) {
      match.handleDisconnect(socketId);
    }
  }

  /**
   * Generate a unique match ID
   * Format: match-{timestamp}-{randomId}
   */
  private generateMatchId(): string {
    return `match-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
