## Plan: Migrate to Fixed-Point Math for Deterministic Simulation

**TL;DR:** Create a shared `phalanx-math` library with deterministic fixed-point arithmetic, consumed by both `phalanx-client` and `phalanx-server`. Then incrementally replace floating-point calculations in `babylon-ecs` simulation systems with fixed-point equivalents. This ensures identical results across all clients regardless of hardware/platform differences.

### Steps

1. ✅ **Create `phalanx-math` shared library**: Create a new workspace package `phalanx-math` containing [FixedMath.ts](phalanx-math/src/FixedMath.ts) with `Fixed`, `FixedMath`, `FixedVector2`, `FixedVector3`, `FPPosition` types. Add `@hastom/fixed-point` as dependency. Update `phalanx-client` and `phalanx-server` to depend on and re-export from `phalanx-math` for backward compatibility.

2. ✅ **Add `FPPosition` to entities**: Add fixed-point position (`fpPosition`) property to [Entity.ts](babylon-ecs/src/entities/Entity.ts) using `FPPosition` from `phalanx-math`. Keep existing `Vector3` position for Babylon.js rendering compatibility. Both positions are synchronized - `fpPosition` is authoritative for deterministic simulation.

3. ✅ **Refactor `PhysicsSystem` to use `FixedMath`**: Replace all `Math.sqrt`, division, and arithmetic in [PhysicsSystem.ts](babylon-ecs/src/systems/PhysicsSystem.ts) with `FixedMath` operations for velocity calculations, collision detection (`distSq`, `overlap`), and position updates.

4. ✅ **Refactor `CombatSystem` to use `FixedMath`**: Update distance calculations and range checks in [CombatSystem.ts](babylon-ecs/src/systems/CombatSystem.ts) to use `FPVector3.SqrDistance` and fixed-point comparisons (`FP.Lte`, `FP.Gt`) instead of `Vector3.Distance`. Uses squared distances to avoid non-deterministic sqrt operations.

5. ✅ **Refactor `ProjectileSystem` and `RotationSystem`**: Update [ProjectileSystem.ts](babylon-ecs/src/systems/ProjectileSystem.ts) movement/hit detection and [RotationSystem.ts](babylon-ecs/src/systems/RotationSystem.ts) angle calculations to use `FixedMath.sin`, `FixedMath.cos`, `FixedMath.atan2`.

6. ✅ **Add conversion utilities**: Created [MathConversions.ts](babylon-ecs/src/core/MathConversions.ts) with helpers to convert between `FPVector2`/`FPVector3` and Babylon's `Vector2`/`Vector3`. Updated [InterpolationSystem.ts](babylon-ecs/src/systems/InterpolationSystem.ts) to use fixed-point positions as authoritative source and interpolate to float Vector3 for smooth visual rendering.

### Further Considerations

1. **Gradual vs. full migration?** Start with `PhysicsSystem` as a proof-of-concept, then expand to other systems. A partial migration could cause subtle desyncs at system boundaries.

2. **Performance impact?** Fixed-point BigInt operations are slower than native floats. Consider benchmarking on target platforms (mobile) before committing.

3. **Should `phalanx-math` export pre-built WASM fixed-point math?** The `@hastom/fixed-point` library may have WASM optimization opportunities for better cross-platform performance.

