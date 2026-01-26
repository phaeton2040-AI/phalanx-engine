import { randomBytes } from 'crypto';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  PhalanxConfig,
  QueuedPlayer,
  MatchInfo,
  PlayerInfo,
  PlayerCommand,
  TickCommands,
} from '../types/index.js';

/**
 * Game Room
 * Handles a single match with tick synchronization and command broadcasting
 */
export class GameRoom {
  private readonly id: string;
  private readonly roomId: string;
  private readonly io: SocketIOServer;
  private readonly config: PhalanxConfig;
  private readonly players: Map<string, PlayerInfo> = new Map();
  private readonly socketToPlayer: Map<string, string> = new Map();
  private readonly teams: QueuedPlayer[][];
  private readonly eventEmitter: (
    event: string,
    ...args: unknown[]
  ) => boolean | void;

  private currentTick: number = 0;
  private state: 'countdown' | 'playing' | 'paused' | 'finished' = 'countdown';
  private createdAt: Date;
  private tickInterval: NodeJS.Timeout | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  private pendingCommands: Map<number, PlayerCommand[]> = new Map();

  // Command buffer for lockstep: Map<tick, { playerId: commands[] }>
  private commandBuffer: Map<number, TickCommands> = new Map();
  // Track which players have submitted for each tick
  private tickSubmissions: Map<number, Set<string>> = new Map();
  // Track last message timestamp per player (LOCKSTEP-5) - uses real time instead of ticks
  private lastMessageTime: Map<string, number> = new Map();
  // Command history for reconnection (NET-2)
  private commandHistory: Map<number, PlayerCommand[]> = new Map();
  // Track players who are currently lagging (to avoid spamming events)
  private laggingPlayers: Set<string> = new Set();
  // Random seed for deterministic RNG (generated at match creation)
  private readonly randomSeed: number;
  // Track last sequence number per player for input validation (2.1.4)
  private lastSequence: Map<string, number> = new Map();
  // State hashes per tick for desync detection (2.1.3)
  private stateHashes: Map<number, Map<string, string>> = new Map();

  constructor(
    id: string,
    io: SocketIOServer,
    config: PhalanxConfig,
    teams: QueuedPlayer[][],
    eventEmitter: (event: string, ...args: unknown[]) => boolean | void
  ) {
    this.id = id;
    this.roomId = id;
    this.io = io;
    this.config = config;
    this.teams = teams;
    this.eventEmitter = eventEmitter;
    this.createdAt = new Date();
    // Generate deterministic random seed for this match (32-bit unsigned integer)
    this.randomSeed = randomBytes(4).readUInt32BE();

    // Initialize players from teams
    teams.forEach((team, teamId) => {
      team.forEach((qp) => {
        const playerInfo: PlayerInfo = {
          id: qp.playerId,
          teamId,
          connected: true,
          lastTick: 0,
        };
        this.players.set(qp.playerId, playerInfo);
        this.socketToPlayer.set(qp.socketId, qp.playerId);
        // Initialize activity tracking with current time
        this.lastMessageTime.set(qp.playerId, Date.now());
      });
    });
  }

  /**
   * Start the game room (begins countdown)
   */
  start(): void {
    // Join all players to the room and assign socket.data
    this.teams.forEach((team, teamId) => {
      const teammateIds = team.map((p) => p.playerId);
      const opponentIds = this.teams
        .filter((_, i) => i !== teamId)
        .flat()
        .map((p) => p.playerId);

      team.forEach((player) => {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          // Assign match data to socket
          socket.data.matchId = this.id;
          socket.data.playerId = player.playerId;
          socket.data.teamId = teamId;
          socket.data.teammates = teammateIds.filter(
            (id) => id !== player.playerId
          );
          socket.data.opponents = opponentIds;

          // Join the room
          socket.join(this.roomId);
        }
      });
    });

    // Emit personalized match-found to each player
    this.notifyMatchFound();

    // Start countdown with 1-second interval events
    this.startGameCountdown();
  }

  /**
   * Start the game countdown
   * Emits countdown events (5, 4, 3, 2, 1, 0) every second, then game-start
   */
  private startGameCountdown(): void {
    let countdown = this.config.countdownSeconds;

    // Emit initial countdown
    this.io.to(this.roomId).emit('countdown', { seconds: countdown });
    countdown--;

    this.countdownInterval = setInterval(() => {
      this.io.to(this.roomId).emit('countdown', { seconds: countdown });
      countdown--;

      if (countdown < 0) {
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        // Emit game-start event with random seed for deterministic RNG
        this.io.to(this.roomId).emit('game-start', {
          matchId: this.id,
          randomSeed: this.randomSeed,
        });
        this.startGame();
      }
    }, 1000);
  }

  /**
   * Notify all players that a match has been found
   * Each player receives personalized data about their teammates and opponents
   */
  private notifyMatchFound(): void {
    this.teams.forEach((team, teamId) => {
      // Build teammate info for this team
      const teammateInfo = team.map((p) => ({
        playerId: p.playerId,
        username: p.username,
      }));

      // Build opponent info (all players from other teams)
      const opponentInfo = this.teams
        .filter((_, i) => i !== teamId)
        .flat()
        .map((p) => ({
          playerId: p.playerId,
          username: p.username,
        }));

      // Notify each player on this team
      team.forEach((player) => {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          socket.emit('match-found', {
            matchId: this.id,
            playerId: player.playerId,
            teamId,
            teammates: teammateInfo.filter(
              (t) => t.playerId !== player.playerId
            ),
            opponents: opponentInfo,
          });
        }
      });
    });
  }

  /**
   * Start the actual game (after countdown)
   */
  private startGame(): void {
    this.state = 'playing';
    this.currentTick = 0;

    // Reset activity timestamps for all players at game start
    const now = Date.now();
    for (const playerId of this.players.keys()) {
      this.lastMessageTime.set(playerId, now);
    }

    // Emit match-started event
    this.eventEmitter('match-started', this.getMatchInfo());

    // Log tick clock start
    console.log(
      `[TICK] Match ${this.id} started tick clock at ${this.config.tickRate} ticks/sec`
    );

    // Start tick loop
    const tickIntervalMs = 1000 / this.config.tickRate;
    this.tickInterval = setInterval(() => {
      this.processTick();
    }, tickIntervalMs);
  }

  /**
   * Process a single tick
   */
  private processTick(): void {
    // Broadcast tick-sync to all players every tick
    this.io.to(this.roomId).emit('tick-sync', {
      tick: this.currentTick,
      timestamp: Date.now(),
    });

    // Check for lagging/disconnected players (LOCKSTEP-5)
    this.checkPlayerTimeouts();

    // Log every second (every tickRate ticks)
    if (this.currentTick % this.config.tickRate === 0) {
      console.log(`[TICK] Match ${this.id}: Tick ${this.currentTick}`);
    }

    const commands = this.pendingCommands.get(this.currentTick) || [];

    // Sort for deterministic order across all clients:
    // 1. Primary: by playerId (alphabetical)
    // 2. Secondary: by command type (alphabetical) for stable ordering
    // This ensures all clients process commands in exactly the same order
    commands.sort((a, b) => {
      const playerCompare = a.playerId.localeCompare(b.playerId);
      if (playerCompare !== 0) return playerCompare;
      // Same player - sort by command type for stability
      return a.type.localeCompare(b.type);
    });

    // Store command history for reconnection (NET-2)
    this.storeCommandHistory(this.currentTick, commands);

    // Broadcast commands batch to all players
    this.io.to(this.roomId).emit('commands-batch', {
      tick: this.currentTick,
      commands,
    });

    // Clean up old commands and tick data
    this.pendingCommands.delete(this.currentTick);
    this.clearOldTicks(this.currentTick);

    // Advance tick
    this.currentTick++;
  }

  /**
   * Handle a player command
   */
  handleCommand(playerId: string, command: PlayerCommand): boolean {
    const player = this.players.get(playerId);
    if (!player || this.state !== 'playing') {
      return false;
    }

    // Validate tick range
    const tickDiff = command.tick - this.currentTick;
    if (
      tickDiff < -this.config.maxTickBehind ||
      tickDiff > this.config.maxTickAhead
    ) {
      return false;
    }

    // Let external handlers validate
    const result = this.eventEmitter('player-command', playerId, command);
    if (result === false) {
      return false;
    }

    // Store command for the specified tick
    const targetTick = Math.max(command.tick, this.currentTick);
    if (!this.pendingCommands.has(targetTick)) {
      this.pendingCommands.set(targetTick, []);
    }
    this.pendingCommands.get(targetTick)!.push(command);

    // Update player's last tick
    player.lastTick = command.tick;

    return true;
  }

  /**
   * Validate command sequence number (2.1.4)
   * Returns true if sequence is valid, false otherwise
   */
  private validateCommandSequence(
    playerId: string,
    command: PlayerCommand
  ): boolean {
    // If command has no sequence, accept it (backward compatibility)
    if (command.sequence === undefined) {
      return true;
    }

    const lastSeq = this.lastSequence.get(playerId) ?? -1;
    const expectedSeq = lastSeq + 1;

    if (command.sequence !== expectedSeq) {
      console.log(
        `[SECURITY] Player ${playerId} invalid sequence: got ${command.sequence}, expected ${expectedSeq}`
      );
      return false;
    }

    // Update last sequence
    this.lastSequence.set(playerId, command.sequence);
    return true;
  }

  /**
   * Receive commands from a player for a specific tick (LOCKSTEP-2)
   * Commands can be empty if player has no actions for this tick.
   * This is normal - units may be moving/idle and player doesn't need to input anything.
   */
  receivePlayerCommands(
    playerId: string,
    tick: number,
    commands: PlayerCommand[]
  ): { accepted: boolean; invalidCommands?: PlayerCommand[] } {
    const player = this.players.get(playerId);
    if (!player || this.state !== 'playing') {
      return { accepted: false };
    }

    // Update activity tracking (LOCKSTEP-5) - any message = player is alive
    this.updatePlayerActivity(playerId);

    // Validate tick range - can't submit for ticks too far in the past or future
    const tickDiff = tick - this.currentTick;
    if (
      tickDiff < -this.config.maxTickBehind ||
      tickDiff > this.config.maxTickAhead
    ) {
      console.log(
        `[LOCKSTEP] Player ${playerId} rejected: tick ${tick} out of range (current: ${this.currentTick})`
      );
      return { accepted: false };
    }

    // Validate input sequences if enabled (2.1.4)
    const validCommands: PlayerCommand[] = [];
    const invalidCommands: PlayerCommand[] = [];

    if (this.config.validateInputSequence) {
      for (const cmd of commands) {
        if (!this.validateCommandSequence(playerId, cmd)) {
          invalidCommands.push(cmd);
          console.log(
            `[LOCKSTEP] Player ${playerId} command rejected: invalid sequence ${cmd.sequence}`
          );
        } else {
          validCommands.push(cmd);
        }
      }
    } else {
      // No validation - accept all commands
      validCommands.push(...commands);
    }

    // Get or create tick entry in command buffer
    if (!this.commandBuffer.has(tick)) {
      this.commandBuffer.set(tick, {});
    }

    const tickData = this.commandBuffer.get(tick)!;

    // Check for duplicate submission
    if (tickData[playerId] !== undefined) {
      console.log(
        `[LOCKSTEP] Player ${playerId} duplicate submission for tick ${tick} - overwriting`
      );
    }

    // Store commands for this player (can be empty array - this is valid)
    tickData[playerId] = validCommands;

    // Track submission
    if (!this.tickSubmissions.has(tick)) {
      this.tickSubmissions.set(tick, new Set());
    }
    this.tickSubmissions.get(tick)!.add(playerId);

    // Update player's last tick
    player.lastTick = tick;

    // Also add to pending commands for broadcast
    const targetTick = Math.max(tick, this.currentTick);
    if (!this.pendingCommands.has(targetTick)) {
      this.pendingCommands.set(targetTick, []);
    }
    this.pendingCommands.get(targetTick)!.push(...validCommands);

    // Let external handlers process each command
    for (const command of validCommands) {
      this.eventEmitter('player-command', playerId, command);
    }

    console.log(
      `[LOCKSTEP] Player ${playerId} submitted ${validCommands.length} command${validCommands.length !== 1 ? 's' : ''} for tick ${tick}${invalidCommands.length > 0 ? ` (${invalidCommands.length} rejected)` : ''}`
    );

    return {
      accepted: true,
      invalidCommands: invalidCommands.length > 0 ? invalidCommands : undefined,
    };
  }

  /**
   * Get all commands for a specific tick
   */
  getCommandsForTick(tick: number): TickCommands | null {
    return this.commandBuffer.get(tick) || null;
  }

  /**
   * Check if all players have submitted for a specific tick
   */
  allPlayersSubmittedForTick(tick: number): boolean {
    const submissions = this.tickSubmissions.get(tick);
    if (!submissions) {
      return false;
    }

    for (const [playerId, playerInfo] of this.players) {
      if (playerInfo.connected && !submissions.has(playerId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get which players have submitted for a specific tick
   */
  getSubmissionsForTick(tick: number): Set<string> {
    return this.tickSubmissions.get(tick) || new Set();
  }

  /**
   * Clean up old ticks after they've been processed
   */
  clearOldTicks(beforeTick: number): void {
    for (const [tick] of this.commandBuffer) {
      if (tick < beforeTick) {
        this.commandBuffer.delete(tick);
      }
    }
    for (const [tick] of this.tickSubmissions) {
      if (tick < beforeTick) {
        this.tickSubmissions.delete(tick);
      }
    }
  }

  // ============================================================
  // LOCKSTEP-5: Activity Tracking and Timeout Detection
  // ============================================================

  /**
   * Update player activity timestamp (called on any message from player)
   * Uses real time instead of ticks - more reliable with Socket.IO ping/pong
   */
  updatePlayerActivity(playerId: string): void {
    this.lastMessageTime.set(playerId, Date.now());
    // If player was lagging, they're now back
    if (this.laggingPlayers.has(playerId)) {
      this.laggingPlayers.delete(playerId);
    }
  }

  /**
   * Check for lagging/disconnected players (LOCKSTEP-5)
   * Uses real time (ms) instead of ticks for more reliable detection
   */
  private checkPlayerTimeouts(): void {
    const now = Date.now();
    // Convert tick-based config to milliseconds
    const lagThresholdMs =
      (this.config.timeoutTicks / this.config.tickRate) * 1000;
    const disconnectThresholdMs =
      (this.config.disconnectTicks / this.config.tickRate) * 1000;

    for (const [playerId, playerInfo] of this.players) {
      if (!playerInfo.connected) continue;

      const lastMessage = this.lastMessageTime.get(playerId) || 0;
      const msSinceLastMessage = now - lastMessage;

      if (msSinceLastMessage >= disconnectThresholdMs) {
        // Player timed out - mark as disconnected
        this.io.to(this.roomId).emit('player-timeout', {
          playerId,
          lastMessageTime: lastMessage,
          currentTick: this.currentTick,
          msSinceLastMessage,
        });
        console.log(
          `[LOCKSTEP] Player ${playerId} timed out: no message for ${msSinceLastMessage}ms`
        );

        playerInfo.connected = false;
        this.laggingPlayers.delete(playerId);
        this.eventEmitter('player-timeout', playerId, this.id);
      } else if (msSinceLastMessage >= lagThresholdMs) {
        // Player is lagging - emit warning (only once per lagging period)
        if (!this.laggingPlayers.has(playerId)) {
          this.laggingPlayers.add(playerId);
          this.io.to(this.roomId).emit('player-lagging', {
            playerId,
            currentTick: this.currentTick,
            msSinceLastMessage,
          });
          console.log(
            `[LOCKSTEP] Player ${playerId} lagging: no message for ${msSinceLastMessage}ms`
          );
        }
      }
    }
  }

  // ============================================================
  // NET-2: Command History for Reconnection
  // ============================================================

  /**
   * Store command history for reconnection support (NET-2)
   */
  private storeCommandHistory(tick: number, commands: PlayerCommand[]): void {
    this.commandHistory.set(tick, [...commands]);

    // Prune old history
    const oldestToKeep = tick - this.config.commandHistoryTicks;
    for (const [historyTick] of this.commandHistory) {
      if (historyTick < oldestToKeep) {
        this.commandHistory.delete(historyTick);
      }
    }
  }

  /**
   * Get recent command history for reconnecting player (NET-2)
   */
  getRecentCommandHistory(
    fromTick: number
  ): { tick: number; commands: PlayerCommand[] }[] {
    const history: { tick: number; commands: PlayerCommand[] }[] = [];

    for (let tick = fromTick; tick < this.currentTick; tick++) {
      const commands = this.commandHistory.get(tick);
      if (commands) {
        history.push({ tick, commands });
      }
    }

    return history;
  }

  /**
   * Get current tick number
   */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Stop the game room
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.state = 'finished';

    // Emit match-ended event
    this.eventEmitter('match-ended', this.id, 'stopped');

    // Notify players
    this.io.to(this.roomId).emit('match-ended', {
      matchId: this.id,
      reason: 'stopped',
    });
  }

  /**
   * Handle player disconnection (NET-2)
   */
  handleDisconnect(socketId: string): void {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) {
      return;
    }

    const player = this.players.get(playerId);
    if (player) {
      player.connected = false;
      this.eventEmitter('player-disconnected', playerId, this.id);

      // Notify other players with grace period info
      this.io.to(this.roomId).emit('player-disconnected', {
        playerId,
        matchId: this.id,
        gracePeriodMs: this.config.reconnectGracePeriodMs,
      });

      console.log(
        `[NET] Player ${playerId} disconnected from match ${this.id}`
      );
    }
  }

  /**
   * Handle player reconnection (NET-2)
   */
  handleReconnect(playerId: string, socketId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }

    // Update socket mapping
    for (const [oldSocketId, pid] of this.socketToPlayer.entries()) {
      if (pid === playerId) {
        this.socketToPlayer.delete(oldSocketId);
        break;
      }
    }
    this.socketToPlayer.set(socketId, playerId);

    player.connected = true;
    this.laggingPlayers.delete(playerId);

    // Update activity timestamp
    this.lastMessageTime.set(playerId, Date.now());

    this.eventEmitter('player-reconnected', playerId, this.id);

    // Join the room
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(this.roomId);
      socket.data.matchId = this.id;
      socket.data.playerId = playerId;

      // Send reconnect-state with command history (NET-2)
      const fromTick = Math.max(
        0,
        this.currentTick - this.config.commandHistoryTicks
      );
      socket.emit('reconnect-state', {
        matchId: this.id,
        currentTick: this.currentTick,
        state: this.state,
        players: Array.from(this.players.values()),
        recentCommands: this.getRecentCommandHistory(fromTick),
      });

      // Notify other players
      socket.to(this.roomId).emit('player-reconnected', { playerId });
    }

    console.log(
      `[NET] Player ${playerId} reconnected to match ${this.id} at tick ${this.currentTick}`
    );
    return true;
  }

  /**
   * Get match information
   */
  getMatchInfo(): MatchInfo {
    return {
      id: this.id,
      players: Array.from(this.players.values()),
      currentTick: this.currentTick,
      state: this.state,
      createdAt: this.createdAt,
    };
  }

  /**
   * Get the room ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get the random seed for this match
   * Clients use this to initialize their deterministic RNG
   */
  getRandomSeed(): number {
    return this.randomSeed;
  }

  // ============================================================
  // STATE HASHING (2.1.3): Desync Detection
  // ============================================================

  /**
   * Receive state hash from a player for a specific tick
   * @param playerId - The player sending the hash
   * @param tick - The tick this hash is for
   * @param hash - The state hash string
   */
  receiveStateHash(playerId: string, tick: number, hash: string): void {
    // Only process if state hashing is enabled
    if (!this.config.enableStateHashing) {
      return;
    }

    const player = this.players.get(playerId);
    if (!player || this.state !== 'playing') {
      return;
    }

    // Get or create hash map for this tick
    if (!this.stateHashes.has(tick)) {
      this.stateHashes.set(tick, new Map());
    }

    const tickHashes = this.stateHashes.get(tick)!;
    tickHashes.set(playerId, hash);

    // Check if all connected players have submitted for this tick
    const connectedPlayers = Array.from(this.players.entries())
      .filter(([_, p]) => p.connected)
      .map(([id]) => id);

    const allSubmitted = connectedPlayers.every((id) => tickHashes.has(id));

    if (allSubmitted) {
      this.checkForDesync(tick, tickHashes);
      // Clean up old hashes
      this.cleanupOldStateHashes(tick);
    }
  }

  /**
   * Check if there's a desync at a given tick
   */
  private checkForDesync(tick: number, hashes: Map<string, string>): void {
    const hashValues = Array.from(hashes.values());
    const allMatch = hashValues.every((h) => h === hashValues[0]);

    if (!allMatch) {
      const hashObject: { [playerId: string]: string } = {};
      hashes.forEach((hash, playerId) => {
        hashObject[playerId] = hash;
      });

      console.log(
        `[DESYNC] Detected at tick ${tick} in match ${this.id}:`,
        hashObject
      );

      // Emit desync event to server handlers
      this.eventEmitter('desync-detected', this.id, tick, hashObject);

      // Broadcast to all clients in the room
      this.io.to(this.roomId).emit('desync-detected', {
        tick,
        hashes: hashObject,
      });
    }
  }

  /**
   * Clean up state hashes older than the specified tick
   */
  private cleanupOldStateHashes(currentTick: number): void {
    const keepTicks = 10; // Keep last 10 ticks of hashes for debugging
    for (const [tick] of this.stateHashes) {
      if (tick < currentTick - keepTicks) {
        this.stateHashes.delete(tick);
      }
    }
  }
}
