/**
 * Fixed timestep game loop using accumulator algorithm
 */

import { FIXED_TIMESTEP, MAX_FRAME_TIME } from './constants';

export type UpdateCallback = () => void;
export type RenderCallback = (alpha: number) => void;

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private animationFrameId: number | null = null;

  private onUpdate: UpdateCallback;
  private onRender: RenderCallback;

  constructor(onUpdate: UpdateCallback, onRender: RenderCallback) {
    this.onUpdate = onUpdate;
    this.onRender = onRender;
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.accumulator = 0;
    this.loop();
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Main loop
   */
  private loop = (): void => {
    if (!this.running) return;

    const currentTime = performance.now() / 1000;
    let frameTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Clamp frame time to prevent spiral of death
    if (frameTime > MAX_FRAME_TIME) {
      frameTime = MAX_FRAME_TIME;
    }

    this.accumulator += frameTime;

    // Fixed timestep updates
    while (this.accumulator >= FIXED_TIMESTEP) {
      this.onUpdate();
      this.accumulator -= FIXED_TIMESTEP;
    }

    // Render with interpolation alpha
    const alpha = this.accumulator / FIXED_TIMESTEP;
    this.onRender(alpha);

    this.animationFrameId = requestAnimationFrame(this.loop);
  };
}
