/**
 * Fixed-Point Math Module
 *
 * Re-exports from phalanx-math for convenience.
 * The canonical implementation is in phalanx-math.
 *
 * @example
 * ```typescript
 * import { Fixed, FixedMath } from 'phalanx-client';
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

// Re-export everything from phalanx-math
export {
  Fixed,
  FixedMath,
  FixedVector2,
  FixedVector3,
  FixedPoint,
} from 'phalanx-math';

export type { FPVector2, FPPosition } from 'phalanx-math';


