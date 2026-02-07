/**
 * Phalanx Math - Deterministic Fixed-Point Math Library
 *
 * Provides cross-platform deterministic arithmetic for lockstep multiplayer games.
 * All operations produce identical results regardless of hardware or platform.
 *
 * @packageDocumentation
 */

export {
  // Core types
  FixedPoint,
  // Factory functions
  Fixed,
  // Arithmetic operations
  FixedMath,
  // 2D vector utilities
  FixedVector2,
  // 3D vector/position utilities
  FixedVector3,
} from './FixedMath.js';

export type {
  // 2D vector interface
  FPVector2,
  // 3D position interface
  FPPosition,
} from './FixedMath.js';

