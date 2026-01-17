/**
 * TickSimulation - Manages deterministic lockstep simulation timing
 *
 * This class handles the network synchronization aspects of lockstep simulation:
 * - Receives and buffers commands from the server
 * - Tracks simulation progress (ticks)
 * - Provides interpolation alpha for smooth visuals
 * - Manages outgoing command queue
 *
 * ARCHITECTURE:
 * - Server runs at fixed tick rate (e.g., 20 ticks/sec)
 * - Client buffers commands and simulates when server broadcasts them
 * - Game code registers a callback to execute simulation logic
 * - Interpolation alpha allows smooth rendering between ticks
 *
 * @example
 * ```typescript
 * const simulation = new TickSimulation(client, { tickRate: 20 });
 *
 * simulation.onSimulationTick((tick, commands) => {
 *   // Execute commands
 *   for (const cmd of commands) { ... }
 *   // Run game simulation
 *   physics.update();
 *   combat.update();
 * });
 *
 * // In render loop:
 * const alpha = simulation.getInterpolationAlpha();
 * interpolationSystem.interpolate(alpha);
 * simulation.flushCommands();
 * ```
 */

import type { PhalanxClient } from './PhalanxClient.js';
import type { PlayerCommand, CommandsBatchEvent } from './types.js';

/**
 * Configuration for TickSimulation
 */
export interface TickSimulationConfig {
  /**
   * Tick rate (ticks per second) - must match server's tickRate
   * @default 20
   */
  tickRate?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

/**
 * Callback invoked for each simulation tick
 * @param tick - The tick number being simulated
 * @param commands - All commands from all players for this tick
 */
export type SimulationTickCallback = (
  tick: number,
  commands: PlayerCommand[]
) => void;

/**
 * Callback invoked before simulation tick (for snapshotting positions)
 */
export type BeforeTickCallback = () => void;

/**
 * Callback invoked after simulation tick (for capturing new positions)
 */
export type AfterTickCallback = () => void;

/**
 * TickSimulation - Handles lockstep synchronization timing and command management
 */
export class TickSimulation {
  private client: PhalanxClient;
  private config: Required<TickSimulationConfig>;

  // Simulation state
  private lastSimulatedTick: number = -1;
  private pendingTickCommands: Map<number, PlayerCommand[]> = new Map();

  // Outgoing command queue
  private pendingOutgoingCommands: PlayerCommand[] = [];

  // Interpolation timing
  private lastTickTime: number = 0;
  private tickDurationMs: number;

  // Callbacks
  private simulationCallback?: SimulationTickCallback;
  private beforeTickCallback?: BeforeTickCallback;
  private afterTickCallback?: AfterTickCallback;

  // Cleanup
  private unsubscribers: (() => void)[] = [];

  constructor(client: PhalanxClient, config: TickSimulationConfig = {}) {
    this.client = client;
    this.config = {
      tickRate: config.tickRate ?? 20,
      debug: config.debug ?? false,
    };

    this.tickDurationMs = 1000 / this.config.tickRate;
    this.setupListeners();
  }

  // ============================================
  // CONFIGURATION
  // ============================================

  /**
   * Register callback for simulation ticks
   * This is called for each tick with the tick number and all commands for that tick
   *
   * @param callback - Function to execute game simulation
   * @returns Unsubscribe function
   */
  onSimulationTick(callback: SimulationTickCallback): () => void {
    this.simulationCallback = callback;
    return () => {
      this.simulationCallback = undefined;
    };
  }

  /**
   * Register callback called BEFORE each simulation tick
   * Use this to snapshot positions for interpolation
   *
   * @param callback - Function to call before simulation
   * @returns Unsubscribe function
   */
  onBeforeTick(callback: BeforeTickCallback): () => void {
    this.beforeTickCallback = callback;
    return () => {
      this.beforeTickCallback = undefined;
    };
  }

  /**
   * Register callback called AFTER each simulation tick
   * Use this to capture new positions for interpolation
   *
   * @param callback - Function to call after simulation
   * @returns Unsubscribe function
   */
  onAfterTick(callback: AfterTickCallback): () => void {
    this.afterTickCallback = callback;
    return () => {
      this.afterTickCallback = undefined;
    };
  }

  // ============================================
  // INTERPOLATION
  // ============================================

  /**
   * Get interpolation alpha for smooth visual rendering
   *
   * Returns a value between 0 and 1 representing progress between ticks:
   * - 0 = at last tick position
   * - 1 = at current tick position (ready for next tick)
   * - 0.5 = halfway between ticks
   *
   * Use this value with your interpolation system to smoothly blend
   * between simulation positions for rendering.
   *
   * @returns Alpha value between 0 and 1
   */
  getInterpolationAlpha(): number {
    const elapsed = performance.now() - this.lastTickTime;
    const alpha = elapsed / this.tickDurationMs;
    return Math.min(1, Math.max(0, alpha));
  }

  /**
   * Get the duration of one tick in milliseconds
   */
  getTickDurationMs(): number {
    return this.tickDurationMs;
  }

  /**
   * Get the configured tick rate
   */
  getTickRate(): number {
    return this.config.tickRate;
  }

  // ============================================
  // COMMAND MANAGEMENT
  // ============================================

  /**
   * Queue a command to be sent to the server
   * Commands are buffered and sent on the next flushCommands() call
   *
   * @param command - The command to queue
   */
  queueCommand(command: PlayerCommand): void {
    this.pendingOutgoingCommands.push(command);
  }

  /**
   * Send all queued commands to the server
   * Call this once per render frame
   */
  flushCommands(): void {
    if (this.pendingOutgoingCommands.length > 0) {
      const tick = this.client.getCurrentTick();

      if (this.config.debug) {
        console.log(
          `[TickSimulation] Sending ${this.pendingOutgoingCommands.length} commands at tick ${tick}:`,
          JSON.stringify(this.pendingOutgoingCommands)
        );
      }

      this.client.submitCommandsAsync(tick, this.pendingOutgoingCommands);
      this.pendingOutgoingCommands = [];
    }
  }

  /**
   * Get the number of pending outgoing commands
   */
  getPendingCommandCount(): number {
    return this.pendingOutgoingCommands.length;
  }

  /**
   * Clear all pending outgoing commands without sending
   */
  clearPendingCommands(): void {
    this.pendingOutgoingCommands = [];
  }

  // ============================================
  // STATE GETTERS
  // ============================================

  /**
   * Get the last simulated tick number
   */
  getLastSimulatedTick(): number {
    return this.lastSimulatedTick;
  }

  /**
   * Get the number of ticks waiting to be simulated
   */
  getPendingTickCount(): number {
    return this.pendingTickCommands.size;
  }

  /**
   * Check if simulation is behind the server
   * This can happen if simulation callbacks take too long
   */
  isSimulationBehind(): boolean {
    const serverTick = this.client.getCurrentTick();
    return this.lastSimulatedTick < serverTick - 1;
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  /**
   * Reset simulation state
   * Call this when starting a new match
   */
  reset(): void {
    this.lastSimulatedTick = -1;
    this.pendingTickCommands.clear();
    this.pendingOutgoingCommands = [];
    this.lastTickTime = performance.now();
  }

  /**
   * Dispose of the simulation manager
   * Unsubscribes from all events
   */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.simulationCallback = undefined;
    this.beforeTickCallback = undefined;
    this.afterTickCallback = undefined;
    this.pendingTickCommands.clear();
    this.pendingOutgoingCommands = [];
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private setupListeners(): void {
    // Handle incoming commands from server - this triggers simulation
    // Commands event arrives after tick-sync, ensuring commands are ready
    const unsubCommands = this.client.on(
      'commands',
      (event: CommandsBatchEvent) => {
        if (this.config.debug) {
          console.log(
            `[TickSimulation] Received ${event.commands.length} commands for tick ${event.tick}:`,
            JSON.stringify(event.commands)
          );
        }

        // Store commands for this tick
        this.pendingTickCommands.set(event.tick, event.commands);

        // Simulate up to this tick
        this.simulateToTick(event.tick);
      }
    );

    this.unsubscribers.push(unsubCommands);
  }

  /**
   * Simulate all game ticks up to and including the target tick
   * This is the core of lockstep synchronization
   */
  private simulateToTick(targetTick: number): void {
    // Process all ticks we haven't simulated yet
    while (this.lastSimulatedTick < targetTick) {
      const tickToSimulate = this.lastSimulatedTick + 1;

      // Get commands for this tick (if any)
      const commands = this.pendingTickCommands.get(tickToSimulate) || [];

      // Call before-tick callback (for position snapshotting)
      this.beforeTickCallback?.();

      // Execute simulation callback with commands
      this.simulationCallback?.(tickToSimulate, commands);

      // Call after-tick callback (for position capturing)
      this.afterTickCallback?.();

      // Update state
      this.lastSimulatedTick = tickToSimulate;
      this.pendingTickCommands.delete(tickToSimulate);
      this.lastTickTime = performance.now();
    }
  }
}
