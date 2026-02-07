/**
 * Fixed-Point Math Module
 *
 * Provides deterministic fixed-point arithmetic for game calculations.
 * All clients using the same operations will produce identical results.
 *
 * This module wraps @hastom/fixed-point library to provide a consistent API.
 *
 * @example
 * ```typescript
 * import { Fixed, FixedMath } from 'phalanx-math';
 *
 * const position = {
 *   x: Fixed.from(10.5),
 *   y: Fixed.from(20.3)
 * };
 *
 * const distSq = FixedMath.add(
 *   FixedMath.mul(position.x, position.x),
 *   FixedMath.mul(position.y, position.y)
 * );
 * const distance = FixedMath.sqrt(distSq);
 *
 * // Convert back to number for display
 * console.log(distance.toDecimal());
 * ```
 */

import { FixedPoint, fpFromDecimal, fpFromInt } from '@hastom/fixed-point';

// Re-export FixedPoint class as the number type
export { FixedPoint };

/** Default precision for fixed-point operations (18 decimal places) */
const DEFAULT_PRECISION = 18;

/**
 * Fixed-point number creation and conversion utilities
 */
export const Fixed = {
  /**
   * Create a fixed-point number from a JavaScript number
   * @param value - Number to convert
   * @param precision - Decimal precision (default: 18)
   */
  from: (value: number, precision: number = DEFAULT_PRECISION): FixedPoint => {
    return fpFromDecimal(value.toString(), precision);
  },

  /**
   * Create a fixed-point number from a string representation
   * @param value - String representation (e.g., "10.5")
   * @param precision - Decimal precision (default: 18)
   */
  fromString: (
    value: string,
    precision: number = DEFAULT_PRECISION
  ): FixedPoint => {
    return fpFromDecimal(value, precision);
  },

  /**
   * Create a fixed-point number from an integer
   * @param value - Integer value
   * @param precision - Decimal precision (default: 18)
   */
  fromInt: (
    value: number | bigint,
    precision: number = DEFAULT_PRECISION
  ): FixedPoint => {
    return fpFromInt(BigInt(value), 0, precision);
  },

  /**
   * Convert a fixed-point number back to a JavaScript number
   */
  toNumber: (fp: FixedPoint): number => {
    return fp.toDecimal();
  },

  /**
   * Zero constant
   */
  ZERO: fpFromInt(0n, 0, DEFAULT_PRECISION),

  /**
   * One constant
   */
  ONE: fpFromInt(1n, 0, DEFAULT_PRECISION),

  /**
   * Pi constant (approximation to 18 decimal places)
   */
  PI: fpFromDecimal('3.141592653589793238', DEFAULT_PRECISION),

  /**
   * 2*Pi constant
   */
  TWO_PI: fpFromDecimal('6.283185307179586477', DEFAULT_PRECISION),

  /**
   * Pi/2 constant
   */
  HALF_PI: fpFromDecimal('1.570796326794896619', DEFAULT_PRECISION),
};

/**
 * Fixed-point arithmetic operations
 */
export const FixedMath = {
  /**
   * Add two fixed-point numbers
   */
  add: (a: FixedPoint, b: FixedPoint): FixedPoint => a.add(b),

  /**
   * Subtract two fixed-point numbers
   */
  sub: (a: FixedPoint, b: FixedPoint): FixedPoint => a.sub(b),

  /**
   * Multiply two fixed-point numbers
   */
  mul: (a: FixedPoint, b: FixedPoint): FixedPoint => a.mul(b),

  /**
   * Divide two fixed-point numbers
   */
  div: (a: FixedPoint, b: FixedPoint): FixedPoint => a.div(b),

  /**
   * Square root of a fixed-point number
   */
  sqrt: (a: FixedPoint): FixedPoint => a.sqrt(),

  /**
   * Absolute value of a fixed-point number
   */
  abs: (a: FixedPoint): FixedPoint => a.abs(),

  /**
   * Floor of a fixed-point number
   */
  floor: (a: FixedPoint): FixedPoint => a.floor(),

  /**
   * Ceiling of a fixed-point number
   */
  ceil: (a: FixedPoint): FixedPoint => a.ceil(),

  /**
   * Round a fixed-point number
   */
  round: (a: FixedPoint): FixedPoint => a.round(),

  /**
   * Minimum of two fixed-point numbers
   */
  min: (a: FixedPoint, b: FixedPoint): FixedPoint => FixedPoint.min(a, b),

  /**
   * Maximum of two fixed-point numbers
   */
  max: (a: FixedPoint, b: FixedPoint): FixedPoint => FixedPoint.max(a, b),

  /**
   * Negate a fixed-point number
   */
  neg: (a: FixedPoint): FixedPoint => a.neg(),

  /**
   * Check if two fixed-point numbers are equal
   */
  eq: (a: FixedPoint, b: FixedPoint): boolean => a.eq(b),

  /**
   * Check if first is less than second
   */
  lt: (a: FixedPoint, b: FixedPoint): boolean => a.lt(b),

  /**
   * Check if first is less than or equal to second
   */
  lte: (a: FixedPoint, b: FixedPoint): boolean => a.lte(b),

  /**
   * Check if first is greater than second
   */
  gt: (a: FixedPoint, b: FixedPoint): boolean => a.gt(b),

  /**
   * Check if first is greater than or equal to second
   */
  gte: (a: FixedPoint, b: FixedPoint): boolean => a.gte(b),

  /**
   * Calculate distance between two points
   */
  distance: (
    x1: FixedPoint,
    y1: FixedPoint,
    x2: FixedPoint,
    y2: FixedPoint
  ): FixedPoint => {
    const dx = x2.sub(x1);
    const dy = y2.sub(y1);
    return dx.mul(dx).add(dy.mul(dy)).sqrt();
  },

  /**
   * Linear interpolation between two values
   * @param a - Start value
   * @param b - End value
   * @param t - Interpolation factor (0-1)
   */
  lerp: (a: FixedPoint, b: FixedPoint, t: FixedPoint): FixedPoint => {
    return a.add(b.sub(a).mul(t));
  },

  /**
   * Clamp a value between min and max
   */
  clamp: (
    value: FixedPoint,
    minVal: FixedPoint,
    maxVal: FixedPoint
  ): FixedPoint => {
    return FixedPoint.min(FixedPoint.max(value, minVal), maxVal);
  },

  /**
   * Sine approximation using Taylor series (deterministic)
   * Note: Input should be in radians
   */
  sin: (x: FixedPoint): FixedPoint => {
    // Normalize to [-PI, PI] range
    const twoPi = Fixed.TWO_PI;
    const pi = Fixed.PI;

    // Simple modulo approximation
    let normalized = x;
    while (normalized.gt(pi)) {
      normalized = normalized.sub(twoPi);
    }
    while (normalized.lt(pi.neg())) {
      normalized = normalized.add(twoPi);
    }

    // Taylor series: sin(x) ≈ x - x³/3! + x⁵/5! - x⁷/7!
    const x2 = normalized.mul(normalized);
    const x3 = x2.mul(normalized);
    const x5 = x3.mul(x2);
    const x7 = x5.mul(x2);

    const fact3 = Fixed.fromInt(6);
    const fact5 = Fixed.fromInt(120);
    const fact7 = Fixed.fromInt(5040);

    return normalized.sub(x3.div(fact3)).add(x5.div(fact5)).sub(x7.div(fact7));
  },

  /**
   * Cosine approximation using Taylor series (deterministic)
   * Note: Input should be in radians
   */
  cos: (x: FixedPoint): FixedPoint => {
    // cos(x) = sin(x + PI/2)
    return FixedMath.sin(x.add(Fixed.HALF_PI));
  },

  /**
   * Approximate atan2 (deterministic)
   * Returns angle in radians
   */
  atan2: (y: FixedPoint, x: FixedPoint): FixedPoint => {
    // Simple approximation using polynomial
    const pi = Fixed.PI;
    const halfPi = Fixed.HALF_PI;
    const zero = Fixed.ZERO;

    if (x.isZero() && y.isZero()) {
      return zero;
    }

    if (x.isZero()) {
      return y.isPositive() ? halfPi : halfPi.neg();
    }

    const absY = y.abs();
    const absX = x.abs();

    let angle: FixedPoint;
    if (absX.gte(absY)) {
      const ratio = absY.div(absX);
      // Approximate atan using polynomial: atan(t) ≈ t - t³/3 + t⁵/5
      const t2 = ratio.mul(ratio);
      const t3 = t2.mul(ratio);
      const t5 = t3.mul(t2);
      angle = ratio.sub(t3.div(Fixed.fromInt(3))).add(t5.div(Fixed.fromInt(5)));
    } else {
      const ratio = absX.div(absY);
      const t2 = ratio.mul(ratio);
      const t3 = t2.mul(ratio);
      const t5 = t3.mul(t2);
      angle = halfPi.sub(
        ratio.sub(t3.div(Fixed.fromInt(3))).add(t5.div(Fixed.fromInt(5)))
      );
    }

    // Adjust for quadrant
    if (x.isNegative()) {
      angle = pi.sub(angle);
    }
    if (y.isNegative()) {
      angle = angle.neg();
    }

    return angle;
  },
};

/**
 * Fixed-point 2D vector utilities
 */
export interface FPVector2 {
  x: FixedPoint;
  y: FixedPoint;
}

export const FixedVector2 = {
  /**
   * Create a new vector
   */
  create: (x: FixedPoint, y: FixedPoint): FPVector2 => ({ x, y }),

  /**
   * Create a vector from numbers
   */
  fromNumbers: (x: number, y: number): FPVector2 => ({
    x: Fixed.from(x),
    y: Fixed.from(y),
  }),

  /**
   * Add two vectors
   */
  add: (a: FPVector2, b: FPVector2): FPVector2 => ({
    x: a.x.add(b.x),
    y: a.y.add(b.y),
  }),

  /**
   * Subtract two vectors
   */
  sub: (a: FPVector2, b: FPVector2): FPVector2 => ({
    x: a.x.sub(b.x),
    y: a.y.sub(b.y),
  }),

  /**
   * Scale a vector by a scalar
   */
  scale: (v: FPVector2, s: FixedPoint): FPVector2 => ({
    x: v.x.mul(s),
    y: v.y.mul(s),
  }),

  /**
   * Get the length of a vector
   */
  length: (v: FPVector2): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y)).sqrt();
  },

  /**
   * Get the squared length of a vector (faster than length)
   */
  lengthSquared: (v: FPVector2): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y));
  },

  /**
   * Normalize a vector
   */
  normalize: (v: FPVector2): FPVector2 => {
    const len = FixedVector2.length(v);
    if (len.isZero()) {
      return { x: Fixed.ZERO, y: Fixed.ZERO };
    }
    return {
      x: v.x.div(len),
      y: v.y.div(len),
    };
  },

  /**
   * Dot product of two vectors
   */
  dot: (a: FPVector2, b: FPVector2): FixedPoint => {
    return a.x.mul(b.x).add(a.y.mul(b.y));
  },

  /**
   * Distance between two vectors
   */
  distance: (a: FPVector2, b: FPVector2): FixedPoint => {
    return FixedMath.distance(a.x, a.y, b.x, b.y);
  },

  /**
   * Linear interpolation between two vectors
   */
  lerp: (a: FPVector2, b: FPVector2, t: FixedPoint): FPVector2 => ({
    x: FixedMath.lerp(a.x, b.x, t),
    y: FixedMath.lerp(a.y, b.y, t),
  }),

  /**
   * Convert to plain object with number values (for display/serialization)
   */
  toNumbers: (v: FPVector2): { x: number; y: number } => ({
    x: v.x.toDecimal(),
    y: v.y.toDecimal(),
  }),

  /**
   * Zero vector constant
   */
  ZERO: { x: Fixed.ZERO, y: Fixed.ZERO } as FPVector2,
};

/**
 * Fixed-point 3D position for entities
 * Used to store authoritative simulation positions in fixed-point format
 */
export interface FPPosition {
  x: FixedPoint;
  y: FixedPoint;
  z: FixedPoint;
}

/**
 * Fixed-point 3D vector/position utilities
 */
export const FixedVector3 = {
  /**
   * Create a new 3D position from FixedPoint values
   */
  create: (x: FixedPoint, y: FixedPoint, z: FixedPoint): FPPosition => ({
    x,
    y,
    z,
  }),

  /**
   * Create a 3D position from numbers
   */
  fromNumbers: (x: number, y: number, z: number): FPPosition => ({
    x: Fixed.from(x),
    y: Fixed.from(y),
    z: Fixed.from(z),
  }),

  /**
   * Add two 3D positions
   */
  add: (a: FPPosition, b: FPPosition): FPPosition => ({
    x: a.x.add(b.x),
    y: a.y.add(b.y),
    z: a.z.add(b.z),
  }),

  /**
   * Subtract two 3D positions
   */
  sub: (a: FPPosition, b: FPPosition): FPPosition => ({
    x: a.x.sub(b.x),
    y: a.y.sub(b.y),
    z: a.z.sub(b.z),
  }),

  /**
   * Scale a 3D position by a scalar
   */
  scale: (v: FPPosition, s: FixedPoint): FPPosition => ({
    x: v.x.mul(s),
    y: v.y.mul(s),
    z: v.z.mul(s),
  }),

  /**
   * Get the length of a 3D vector
   */
  length: (v: FPPosition): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y)).add(v.z.mul(v.z)).sqrt();
  },

  /**
   * Get the squared length of a 3D vector (faster than length)
   */
  lengthSquared: (v: FPPosition): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y)).add(v.z.mul(v.z));
  },

  /**
   * Normalize a 3D vector
   */
  normalize: (v: FPPosition): FPPosition => {
    const len = FixedVector3.length(v);
    if (len.isZero()) {
      return { x: Fixed.ZERO, y: Fixed.ZERO, z: Fixed.ZERO };
    }
    return {
      x: v.x.div(len),
      y: v.y.div(len),
      z: v.z.div(len),
    };
  },

  /**
   * Dot product of two 3D vectors
   */
  dot: (a: FPPosition, b: FPPosition): FixedPoint => {
    return a.x.mul(b.x).add(a.y.mul(b.y)).add(a.z.mul(b.z));
  },

  /**
   * Distance between two 3D positions
   */
  distance: (a: FPPosition, b: FPPosition): FixedPoint => {
    const dx = b.x.sub(a.x);
    const dy = b.y.sub(a.y);
    const dz = b.z.sub(a.z);
    return dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz)).sqrt();
  },

  /**
   * Squared distance between two 3D positions (faster than distance)
   */
  distanceSquared: (a: FPPosition, b: FPPosition): FixedPoint => {
    const dx = b.x.sub(a.x);
    const dy = b.y.sub(a.y);
    const dz = b.z.sub(a.z);
    return dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz));
  },

  /**
   * Linear interpolation between two 3D positions
   */
  lerp: (a: FPPosition, b: FPPosition, t: FixedPoint): FPPosition => ({
    x: FixedMath.lerp(a.x, b.x, t),
    y: FixedMath.lerp(a.y, b.y, t),
    z: FixedMath.lerp(a.z, b.z, t),
  }),

  /**
   * Convert to plain object with number values (for display/serialization)
   */
  toNumbers: (v: FPPosition): { x: number; y: number; z: number } => ({
    x: v.x.toDecimal(),
    y: v.y.toDecimal(),
    z: v.z.toDecimal(),
  }),

  /**
   * Zero vector constant
   */
  ZERO: { x: Fixed.ZERO, y: Fixed.ZERO, z: Fixed.ZERO } as FPPosition,
};

