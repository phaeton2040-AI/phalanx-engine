# Phalanx Math

Deterministic fixed-point math library for Phalanx Engine. Ensures identical calculations across all platforms and hardware for lockstep multiplayer games.

## Overview

This library wraps `@hastom/fixed-point` to provide a consistent, game-oriented API for deterministic arithmetic. All clients using the same operations will produce identical results, preventing desync in lockstep multiplayer games.

## Installation

```bash
pnpm add phalanx-math
```

## Usage

```typescript
import { Fixed, FixedMath, FixedVector2, FixedVector3 } from 'phalanx-math';

// Create fixed-point numbers
const speed = Fixed.from(5.5);
const deltaTime = Fixed.from(0.016);

// Arithmetic operations
const distance = FixedMath.mul(speed, deltaTime);

// 2D vectors
const velocity = FixedVector2.fromNumbers(3, 4);
const length = FixedVector2.length(velocity); // 5

// 3D positions (for game entities)
const position = FixedVector3.fromNumbers(10, 0, 20);
const target = FixedVector3.fromNumbers(15, 0, 25);
const dist = FixedVector3.distance(position, target);

// Convert back to numbers for rendering
console.log(Fixed.toNumber(dist));
```

## API

### Fixed

Factory functions for creating fixed-point numbers:

- `Fixed.from(value: number)` - Create from JavaScript number
- `Fixed.fromString(value: string)` - Create from string representation
- `Fixed.fromInt(value: number | bigint)` - Create from integer
- `Fixed.toNumber(fp: FixedPoint)` - Convert back to JavaScript number
- `Fixed.ZERO`, `Fixed.ONE`, `Fixed.PI`, `Fixed.TWO_PI`, `Fixed.HALF_PI` - Constants

### FixedMath

Arithmetic and mathematical operations:

- `add`, `sub`, `mul`, `div` - Basic arithmetic
- `sqrt`, `abs`, `neg` - Unary operations
- `floor`, `ceil`, `round` - Rounding
- `min`, `max`, `clamp` - Range operations
- `eq`, `lt`, `lte`, `gt`, `gte` - Comparisons
- `sin`, `cos`, `atan2` - Trigonometry (deterministic approximations)
- `lerp` - Linear interpolation
- `distance` - 2D distance between points

### FixedVector2

2D vector operations for game logic:

- `create`, `fromNumbers` - Construction
- `add`, `sub`, `scale` - Vector arithmetic
- `length`, `lengthSquared` - Magnitude
- `normalize`, `dot`, `distance` - Geometric operations
- `lerp` - Interpolation
- `toNumbers` - Convert for rendering

### FixedVector3 / FPPosition

3D vector operations for entity positions:

- `create`, `fromNumbers` - Construction
- `add`, `sub`, `scale` - Vector arithmetic
- `length`, `lengthSquared` - Magnitude
- `normalize`, `dot` - Geometric operations
- `distance`, `distanceSquared` - Distance calculations
- `lerp` - Interpolation
- `toNumbers` - Convert for rendering

## Why Fixed-Point?

JavaScript's `Number` type uses IEEE 754 floating-point, which can produce slightly different results on different platforms/hardware. In lockstep multiplayer, even tiny differences compound over time, causing desync.

Fixed-point math uses integer arithmetic with a fixed decimal scale, guaranteeing identical results everywhere.

## Performance Considerations

Fixed-point operations using BigInt are slower than native floats. For most games, this overhead is negligible. If you encounter performance issues:

1. Profile to confirm fixed-point math is the bottleneck
2. Consider batching operations
3. Only use fixed-point for deterministic simulation; use floats for visual-only calculations

