/**
 * RenderLoop - Manages frame-based rendering with tick interpolation
 *
 * Provides:
 * - requestAnimationFrame-based render loop
 * - Interpolation alpha calculation for smooth rendering between ticks
 * - Tick and frame handler registration
 * - Automatic command flushing
 * - Cross-environment compatibility (browser and Node.js)
 */

import type {
  PlayerCommand,
  CommandsBatch,
  TickHandler,
  FrameHandler,
  Unsubscribe,
} from './types.js';

// Cross-environment compatibility for animation frame
const raf =
  typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) =>
        setTimeout(() => cb(Date.now()), 16) as unknown as number;

const caf =
  typeof cancelAnimationFrame !== 'undefined'
    ? cancelAnimationFrame
    : (id: number) => clearTimeout(id);

/**
 * Configuration for RenderLoop
 */
export interface RenderLoopConfig {
  /** Ticks per second (default: 20) */
  tickRate: number;
  /** Enable debug logging (default: false) */
  debug: boolean;
}

/**
 * Callback to flush pending commands
 */
export type CommandFlushCallback = () => void;

/**
 * RenderLoop - Handles frame rendering and tick interpolation
 */
export class RenderLoop {
  private config: RenderLoopConfig;

  // Render loop state
  private rafId: number | null = null;
  private lastTickTime: number = 0;
  private lastFrameTime: number = 0;
  private tickDurationMs: number;

  // Handlers
  private tickHandlers: Set<TickHandler> = new Set();
  private frameHandlers: Set<FrameHandler> = new Set();

  // Command flushing callback
  private commandFlushCallback: CommandFlushCallback | null = null;

  constructor(config: RenderLoopConfig) {
    this.config = config;
    this.tickDurationMs = 1000 / config.tickRate;
  }

  /**
   * Set the callback for flushing commands each frame
   */
  setCommandFlushCallback(callback: CommandFlushCallback | null): void {
    this.commandFlushCallback = callback;
  }

  /**
   * Register a callback for simulation ticks
   * Called when processTick is invoked with commands from all players
   *
   * @param handler Callback receiving tick number and commands grouped by player
   * @returns Unsubscribe function
   */
  onTick(handler: TickHandler): Unsubscribe {
    this.tickHandlers.add(handler);
    return () => {
      this.tickHandlers.delete(handler);
    };
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
    this.frameHandlers.add(handler);

    // Start render loop when first handler is added
    if (this.frameHandlers.size === 1) {
      this.start();
    }

    return () => {
      this.frameHandlers.delete(handler);
      // Stop render loop when no handlers remain
      if (this.frameHandlers.size === 0) {
        this.stop();
      }
    };
  }

  /**
   * Process an incoming tick and notify all tick handlers
   * @param tick Tick number
   * @param commands Commands for this tick
   */
  processTick(tick: number, commands: PlayerCommand[]): void {
    this.lastTickTime = performance.now();

    // Group commands by player
    const commandsBatch: CommandsBatch = {
      tick,
      commands: {},
    };

    for (const cmd of commands) {
      const playerId = cmd.playerId ?? 'unknown';
      if (!commandsBatch.commands[playerId]) {
        commandsBatch.commands[playerId] = [];
      }
      commandsBatch.commands[playerId].push(cmd);
    }

    // Call all tick handlers
    for (const handler of this.tickHandlers) {
      try {
        handler(tick, commandsBatch);
      } catch (error) {
        if (this.config.debug) {
          console.error('[RenderLoop] Error in tick handler:', error);
        }
      }
    }
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (this.rafId !== null) return;

    this.lastFrameTime = performance.now();

    const loop = (now: number) => {
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      // Flush pending commands at the start of each frame
      this.commandFlushCallback?.();

      // Calculate interpolation alpha
      const alpha = this.calculateInterpolationAlpha();

      // Call all frame handlers
      for (const handler of this.frameHandlers) {
        try {
          handler(alpha, dt);
        } catch (error) {
          if (this.config.debug) {
            console.error('[RenderLoop] Error in frame handler:', error);
          }
        }
      }

      this.rafId = raf(loop);
    };

    this.rafId = raf(loop);

    if (this.config.debug) {
      console.log('[RenderLoop] Started');
    }
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    if (this.rafId !== null) {
      caf(this.rafId);
      this.rafId = null;

      if (this.config.debug) {
        // eslint-disable-next-line no-console
        console.log('[RenderLoop] Stopped');
      }
    }
  }

  /**
   * Check if render loop is running
   */
  isRunning(): boolean {
    return this.rafId !== null;
  }

  /**
   * Calculate interpolation alpha for smooth rendering
   * @returns Value between 0 and 1 representing progress between ticks
   */
  calculateInterpolationAlpha(): number {
    if (this.lastTickTime === 0) return 0;

    const elapsed = performance.now() - this.lastTickTime;
    return Math.min(1, Math.max(0, elapsed / this.tickDurationMs));
  }

  /**
   * Update the last tick time (called when tick is received)
   */
  updateTickTime(): void {
    this.lastTickTime = performance.now();
  }

  /**
   * Get tick duration in milliseconds
   */
  getTickDurationMs(): number {
    return this.tickDurationMs;
  }

  /**
   * Clear all handlers and stop the loop
   */
  dispose(): void {
    this.stop();
    this.tickHandlers.clear();
    this.frameHandlers.clear();
    this.commandFlushCallback = null;
  }
}
