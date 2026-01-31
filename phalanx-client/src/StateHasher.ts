/**
 * StateHasher - Deterministic state hasher using FNV-1a algorithm
 *
 * Works only with primitives - game-agnostic by design.
 * Games use this to hash their own state structure.
 *
 * @example
 * ```typescript
 * const hash = new StateHasher()
 *   .addInt(tick)
 *   .addInt(entityCount)
 *   .addFloat(entity.x)
 *   .addFloat(entity.y)
 *   .addString(entity.state)
 *   .finalize();
 * ```
 */
export class StateHasher {
  private static readonly FNV_OFFSET = 2166136261n;
  private static readonly FNV_PRIME = 16777619n;
  private static readonly FLOAT_PRECISION = 10000; // 4 decimal places

  private hash: bigint;

  constructor() {
    this.hash = StateHasher.FNV_OFFSET;
  }

  /**
   * Add an integer to the hash
   * @param value - Integer value to hash
   * @returns this (for chaining)
   */
  addInt(value: number): this {
    // Ensure integer
    const int = Math.floor(value) | 0;

    // Hash each byte (32-bit integer = 4 bytes)
    this.hash ^= BigInt(int & 0xff);
    this.hash *= StateHasher.FNV_PRIME;
    this.hash ^= BigInt((int >> 8) & 0xff);
    this.hash *= StateHasher.FNV_PRIME;
    this.hash ^= BigInt((int >> 16) & 0xff);
    this.hash *= StateHasher.FNV_PRIME;
    this.hash ^= BigInt((int >> 24) & 0xff);
    this.hash *= StateHasher.FNV_PRIME;

    return this;
  }

  /**
   * Add a float to the hash (converted to fixed-point for determinism)
   * @param value - Float value to hash
   * @returns this (for chaining)
   */
  addFloat(value: number): this {
    // Convert to fixed-point integer for determinism across browsers
    const fixed = Math.round(value * StateHasher.FLOAT_PRECISION);
    return this.addInt(fixed);
  }

  /**
   * Add a string to the hash
   * @param value - String value to hash
   * @returns this (for chaining)
   */
  addString(value: string): this {
    for (let i = 0; i < value.length; i++) {
      this.hash ^= BigInt(value.charCodeAt(i));
      this.hash *= StateHasher.FNV_PRIME;
    }
    // Add null terminator for safety
    this.hash ^= 0n;
    this.hash *= StateHasher.FNV_PRIME;
    return this;
  }

  /**
   * Add a boolean to the hash
   * @param value - Boolean value to hash
   * @returns this (for chaining)
   */
  addBool(value: boolean): this {
    this.hash ^= value ? 1n : 0n;
    this.hash *= StateHasher.FNV_PRIME;
    return this;
  }

  /**
   * Add multiple integers (useful for arrays)
   * @param values - Array of integers to hash
   * @returns this (for chaining)
   */
  addIntArray(values: number[]): this {
    this.addInt(values.length);
    for (const v of values) {
      this.addInt(v);
    }
    return this;
  }

  /**
   * Add multiple floats (useful for positions, etc.)
   * @param values - Array of floats to hash
   * @returns this (for chaining)
   */
  addFloatArray(values: number[]): this {
    this.addInt(values.length);
    for (const v of values) {
      this.addFloat(v);
    }
    return this;
  }

  /**
   * Finalize and get the hash as a hex string
   * @returns 8-character hex string (32-bit hash)
   */
  finalize(): string {
    // Mask to 32 bits for consistent output
    const masked = this.hash & 0xffffffffn;
    return masked.toString(16).padStart(8, '0');
  }

  /**
   * Reset hasher to initial state (for reuse)
   * @returns this (for chaining)
   */
  reset(): this {
    this.hash = StateHasher.FNV_OFFSET;
    return this;
  }

  /**
   * Create a new hasher (static factory)
   * @returns New StateHasher instance
   */
  static create(): StateHasher {
    return new StateHasher();
  }
}
