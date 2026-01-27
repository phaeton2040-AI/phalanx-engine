/**
 * Global game random number generator
 *
 * This singleton provides access to the deterministic RNG.
 * With the new SDK, the RNG is automatically initialized by Phalanx.
 *
 * For backward compatibility, this class wraps either:
 * - The SDK's phalanx.Math.Random (when available)
 * - A standalone DeterministicRandom instance (legacy mode)
 */

import { DeterministicRandom } from 'phalanx-client';

/**
 * Placeholder interface for future Phalanx SDK integration.
 * This will be replaced when the SDK exposes built-in RNG.
 */
interface PhalanxInstance {
  Math: {
    Random: {
      float(): number;
      floatRange(min: number, max: number): number;
      int(min: number, max: number): number;
      boolean(probability?: number): boolean;
      pick<T>(array: T[]): T;
      shuffle<T>(array: T[]): T[];
    };
  };
}

class GameRandomInstance {
  private rng: DeterministicRandom | null = null;
  private phalanxInstance: PhalanxInstance | null = null;
  private seed: number = 0;

  /**
   * Initialize the RNG with a seed (legacy mode)
   * @param seed - The random seed received from game-start event
   */
  initialize(seed: number): void {
    this.seed = seed;
    this.rng = new DeterministicRandom(seed);
    console.log(`[GameRandom] Initialized with seed: ${seed}`);
  }

  /**
   * Use Phalanx SDK's built-in RNG (new mode)
   * @param phalanx - The Phalanx SDK instance
   */
  usePhalanxRng(phalanx: PhalanxInstance): void {
    this.phalanxInstance = phalanx;
    console.log('[GameRandom] Using Phalanx SDK Math.Random');
  }

  /**
   * Reset the RNG to its initial state (for testing/replay)
   */
  reset(): void {
    if (this.seed !== 0) {
      this.rng = new DeterministicRandom(this.seed);
    }
  }

  /**
   * Get the current seed
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Check if RNG is initialized
   */
  isInitialized(): boolean {
    return this.rng !== null || this.phalanxInstance !== null;
  }

  /**
   * Get next random float in range [0, 1)
   */
  float(): number {
    if (this.phalanxInstance) {
      return this.phalanxInstance.Math.Random.float();
    }
    return this.ensureInitialized().float();
  }

  /**
   * Get next random float in range [min, max)
   */
  floatRange(min: number, max: number): number {
    if (this.phalanxInstance) {
      return this.phalanxInstance.Math.Random.floatRange(min, max);
    }
    return this.ensureInitialized().floatRange(min, max);
  }

  /**
   * Get next random integer in range [min, max]
   */
  intRange(min: number, max: number): number {
    if (this.phalanxInstance) {
      return this.phalanxInstance.Math.Random.int(min, max);
    }
    return this.ensureInitialized().intRange(min, max);
  }

  /**
   * Get next random integer in range [0, max)
   */
  int(max: number): number {
    if (this.phalanxInstance) {
      return this.phalanxInstance.Math.Random.int(0, max - 1);
    }
    return this.ensureInitialized().int(max);
  }

  /**
   * Get next random boolean
   * @param probability - Probability of true (default 0.5)
   */
  boolean(probability: number = 0.5): boolean {
    if (this.phalanxInstance) {
      return this.phalanxInstance.Math.Random.boolean(probability);
    }
    return this.ensureInitialized().boolean(probability);
  }

  /**
   * Get a random element from an array
   */
  pick<T>(array: readonly T[]): T {
    if (this.phalanxInstance) {
      return this.phalanxInstance.Math.Random.pick([...array]);
    }
    return this.ensureInitialized().pick(array);
  }

  /**
   * Shuffle an array in place
   */
  shuffle<T>(array: T[]): T[] {
    if (this.phalanxInstance) {
      return this.phalanxInstance.Math.Random.shuffle(array);
    }
    return this.ensureInitialized().shuffle(array);
  }

  /**
   * Create a fork of the RNG for independent random stream
   * Note: Only available in legacy mode
   */
  fork(): DeterministicRandom {
    if (this.phalanxInstance) {
      // SDK doesn't expose fork, create new instance with derived seed
      const derivedSeed = this.phalanxInstance.Math.Random.int(0, 2147483647);
      return new DeterministicRandom(derivedSeed);
    }
    return this.ensureInitialized().fork();
  }

  private ensureInitialized(): DeterministicRandom {
    if (!this.rng) {
      throw new Error(
        'GameRandom not initialized! Call GameRandom.initialize(seed) or GameRandom.usePhalanxRng(phalanx) first.'
      );
    }
    return this.rng;
  }

  /**
   * Cleanup when game ends
   */
  cleanup(): void {
    this.rng = null;
    this.phalanxInstance = null;
    this.seed = 0;
  }
}

/**
 * Global singleton instance
 */
export const GameRandom = new GameRandomInstance();
