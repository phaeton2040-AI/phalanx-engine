import { EntityManager } from '../core/EntityManager';
import { ComponentType, MovementComponent, TeamComponent } from '../components';
import { networkConfig } from '../config/constants';
import {
  Fixed,
  FixedMath,
  type FixedPoint,
  type FPPosition,
} from 'phalanx-math';

/**
 * Physics configuration for deterministic simulation
 * All values are in fixed-point for deterministic calculations
 */
export interface PhysicsConfig {
  fixedTimestep: FixedPoint; // Fixed delta time for deterministic updates
  unitRadius: FixedPoint; // Collision radius for units
  pushStrength: FixedPoint; // How strongly units push each other
  maxVelocity: FixedPoint; // Maximum velocity magnitude
  friction: FixedPoint; // Friction coefficient (0-1)
  cellSize: number; // Spatial grid cell size (kept as number for grid indexing)
}

// Pre-computed fixed-point constants for physics calculations
const FP_ARRIVAL_THRESHOLD_SQ = Fixed.from(0.25); // 0.5^2
const FP_MIN_DIST_SQ_EPSILON = Fixed.from(0.0001);
const FP_SEPARATION_HALF = Fixed.from(0.5);
const FP_VELOCITY_EPSILON = Fixed.from(0.01);
const FP_ZERO = Fixed.ZERO;
const FP_ONE = Fixed.ONE;

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  fixedTimestep: Fixed.from(networkConfig.tickTimestep / networkConfig.physicsSubsteps), // Physics substeps per tick
  unitRadius: Fixed.from(1.0), // Units have radius of 1 (diameter 2 matches sphere mesh)
  pushStrength: Fixed.from(15.0), // Push force multiplier
  maxVelocity: Fixed.from(15.0), // Max speed
  friction: Fixed.from(0.92), // Velocity damping per frame
  cellSize: 8.0, // Should be >= 2 * max(unitRadius)
};

/**
 * PhysicsBody - Stores physics state for an entity
 * Uses fixed-point arithmetic for deterministic simulation
 */
export interface PhysicsBody {
  entityId: number;
  velocity: FPPosition; // Fixed-point velocity for deterministic physics
  radius: FixedPoint; // Fixed-point radius
  mass: FixedPoint; // Fixed-point mass
  isStatic: boolean; // Static bodies don't move (towers, bases)
  // Cached position for spatial hashing (kept as numbers for grid indexing)
  lastX: number;
  lastZ: number;
}

/**
 * Spatial hash grid for O(n) average-case collision detection
 * Divides the world into cells and only checks collisions between entities in nearby cells
 */
class SpatialGrid {
  private cellSize: number;
  private cells: Map<string, number[]> = new Map();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  public clear(): void {
    this.cells.clear();
  }

  /**
   * Insert an entity into all cells it overlaps
   */
  public insert(entityId: number, x: number, z: number, radius: number): void {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = `${cx},${cz}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(entityId);
      }
    }
  }

  /**
   * Get all entity IDs that might collide with a circle at (x, z) with given radius
   *
   * IMPORTANT: Returns entity IDs in sorted order for deterministic collision
   * processing across all clients.
   */
  public getPotentialCollisions(
    x: number,
    z: number,
    radius: number
  ): number[] {
    const result: number[] = [];
    const seen = new Set<number>();

    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = `${cx},${cz}`;
        const cell = this.cells.get(key);
        if (cell) {
          for (const id of cell) {
            if (!seen.has(id)) {
              seen.add(id);
              result.push(id);
            }
          }
        }
      }
    }

    // Sort by entity ID for deterministic ordering across all clients
    result.sort((a, b) => a - b);

    return result;
  }
}

/**
 * PhysicsSystem - Optimized deterministic physics simulation
 * Uses fixed-point arithmetic for reproducible results across clients
 * Uses spatial hashing for O(n) average-case collision detection
 * Minimizes allocations for mobile performance
 */
export class PhysicsSystem {
  private entityManager: EntityManager;
  private config: PhysicsConfig;
  private bodies: Map<number, PhysicsBody> = new Map();
  private spatialGrid: SpatialGrid;

  // Collision pair tracking to avoid duplicate checks
  private readonly checkedPairs: Set<string> = new Set();

  // Cached number values from fixed-point config (for spatial grid operations)
  private readonly unitRadiusNum: number;

  constructor(
    entityManager: EntityManager,
    _eventBus?: unknown,
    config?: Partial<PhysicsConfig>
  ) {
    this.entityManager = entityManager;
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...config };
    this.spatialGrid = new SpatialGrid(this.config.cellSize);
    // Cache number value for spatial grid operations
    this.unitRadiusNum = Fixed.toNumber(this.config.unitRadius);
  }

  /**
   * Register an entity with the physics system
   * @param entityId - The entity ID to register
   * @param options - Optional physics body configuration (accepts numbers for convenience)
   */
  public registerBody(
    entityId: number,
    options: { radius?: number; mass?: number; isStatic?: boolean } = {}
  ): void {
    this.bodies.set(entityId, {
      entityId,
      velocity: { x: FP_ZERO, y: FP_ZERO, z: FP_ZERO },
      radius: options.radius !== undefined ? Fixed.from(options.radius) : this.config.unitRadius,
      mass: options.mass !== undefined ? Fixed.from(options.mass) : FP_ONE,
      isStatic: options.isStatic ?? false,
      lastX: 0,
      lastZ: 0,
    });
  }

  /**
   * Unregister an entity from the physics system
   */
  public unregisterBody(entityId: number): void {
    this.bodies.delete(entityId);
  }

  /**
   * Get physics body for an entity
   */
  public getBody(entityId: number): PhysicsBody | undefined {
    return this.bodies.get(entityId);
  }

  /**
   * Set velocity for an entity (using fixed-point)
   */
  public setVelocity(entityId: number, velocity: FPPosition): void {
    const body = this.bodies.get(entityId);
    if (body && !body.isStatic) {
      body.velocity.x = velocity.x;
      body.velocity.y = velocity.y;
      body.velocity.z = velocity.z;
    }
  }


  /**
   * Add velocity to an entity (using fixed-point)
   */
  public addVelocity(entityId: number, velocity: FPPosition): void {
    const body = this.bodies.get(entityId);
    if (body && !body.isStatic) {
      body.velocity.x = FixedMath.add(body.velocity.x, velocity.x);
      body.velocity.y = FixedMath.add(body.velocity.y, velocity.y);
      body.velocity.z = FixedMath.add(body.velocity.z, velocity.z);
    }
  }


  /**
   * Simulate one network tick worth of physics
   * Called exactly once per network tick for deterministic lockstep simulation
   * Runs multiple physics substeps per tick for accuracy
   */
  public simulateTick(): void {
    const substepDt = this.config.fixedTimestep;
    const substeps = networkConfig.physicsSubsteps;

    for (let i = 0; i < substeps; i++) {
      this.fixedUpdate(substepDt);
    }
  }

  /**
   * Fixed timestep physics update - deterministic using fixed-point arithmetic
   */
  private fixedUpdate(dt: FixedPoint): void {
    // Update velocities based on movement targets
    this.updateMovementVelocities();

    // Rebuild spatial grid for collision detection
    this.rebuildSpatialGrid();

    // Resolve collisions between nearby bodies
    this.resolveCollisions();

    // Apply velocities to positions
    this.applyVelocities(dt);

    // Apply friction
    this.applyFriction();
  }

  /**
   * Update velocities for entities with movement targets
   * Uses fixed-point math to avoid floating-point determinism issues
   */
  private updateMovementVelocities(): void {
    // Use sorted entity list for deterministic ordering
    const movableEntities = this.entityManager.queryEntities(
      ComponentType.Movement
    );

    for (const entity of movableEntities) {
      const movement = entity.getComponent<MovementComponent>(
        ComponentType.Movement
      );
      const body = this.bodies.get(entity.id);

      if (!movement || !body || body.isStatic) continue;

      // Skip entities that should be ignored by physics (e.g., dying units)
      if (entity.ignorePhysics) {
        body.velocity.x = FP_ZERO;
        body.velocity.z = FP_ZERO;
        continue;
      }

      if (movement.isMoving) {
        const target = movement.targetPosition;
        const pos = entity.fpPosition;

        // Calculate direction using fixed-point math
        const dx = FixedMath.sub(Fixed.from(target.x), pos.x);
        const dz = FixedMath.sub(Fixed.from(target.z), pos.z);
        const distSq = FixedMath.add(
          FixedMath.mul(dx, dx),
          FixedMath.mul(dz, dz)
        );

        if (FixedMath.lt(distSq, FP_ARRIVAL_THRESHOLD_SQ)) {
          // Arrived at destination
          movement.stop();
          body.velocity.x = FP_ZERO;
          body.velocity.z = FP_ZERO;
        } else {
          // Set velocity towards target using fixed-point
          const dist = FixedMath.sqrt(distSq);
          const speed = Fixed.from(movement.speed);
          body.velocity.x = FixedMath.mul(FixedMath.div(dx, dist), speed);
          body.velocity.z = FixedMath.mul(FixedMath.div(dz, dist), speed);
        }
      } else {
        // Unit is not moving - stop any residual velocity
        // This handles cases where combat system stopped the unit
        body.velocity.x = FP_ZERO;
        body.velocity.z = FP_ZERO;
      }
    }
  }

  /**
   * Rebuild spatial grid each physics tick
   * Caches entity positions for collision detection
   *
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();

    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const body of sortedBodies) {
      const entity = this.entityManager.getEntity(body.entityId);
      if (!entity) continue;

      // Convert fixed-point position to numbers for spatial grid indexing
      const fpPos = entity.fpPosition;
      body.lastX = Fixed.toNumber(fpPos.x);
      body.lastZ = Fixed.toNumber(fpPos.z);
      const radiusNum = Fixed.toNumber(body.radius);
      this.spatialGrid.insert(body.entityId, body.lastX, body.lastZ, radiusNum);
    }
  }

  /**
   * Resolve collisions using spatial hashing
   * Average case O(n) instead of O(n²)
   * Uses fixed-point arithmetic for deterministic collision resolution
   *
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private resolveCollisions(): void {
    this.checkedPairs.clear();

    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const bodyA of sortedBodies) {
      const entityA = this.entityManager.getEntity(bodyA.entityId);
      if (!entityA) continue;

      const posAx = bodyA.lastX;
      const posAz = bodyA.lastZ;
      const radiusANum = Fixed.toNumber(bodyA.radius);

      // Get only nearby bodies from spatial grid
      // Search radius includes own radius plus max possible other radius
      const nearby = this.spatialGrid.getPotentialCollisions(
        posAx,
        posAz,
        radiusANum + this.unitRadiusNum * 2
      );

      for (const otherEntityId of nearby) {
        // Skip self and ensure we only check each pair once (lower ID first)
        if (otherEntityId <= bodyA.entityId) continue;

        const pairKey = `${bodyA.entityId},${otherEntityId}`;
        if (this.checkedPairs.has(pairKey)) continue;
        this.checkedPairs.add(pairKey);

        const bodyB = this.bodies.get(otherEntityId);
        if (!bodyB) continue;

        const entityB = this.entityManager.getEntity(bodyB.entityId);
        if (!entityB) continue;

        // Skip collision between units and friendly buildings (bases/towers)
        // Units should pass through their own team's structures
        if (this.shouldSkipCollision(entityA, entityB, bodyA, bodyB)) {
          continue;
        }

        // Use fixed-point positions for deterministic collision calculation
        const fpPosA = entityA.fpPosition;
        const fpPosB = entityB.fpPosition;

        // Calculate distance in XZ plane using fixed-point
        const dx = FixedMath.sub(fpPosB.x, fpPosA.x);
        const dz = FixedMath.sub(fpPosB.z, fpPosA.z);
        const distSq = FixedMath.add(
          FixedMath.mul(dx, dx),
          FixedMath.mul(dz, dz)
        );
        const minDist = FixedMath.add(bodyA.radius, bodyB.radius);
        const minDistSq = FixedMath.mul(minDist, minDist);

        if (FixedMath.lt(distSq, minDistSq) && FixedMath.gt(distSq, FP_MIN_DIST_SQ_EPSILON)) {
          // Collision detected - use fixed-point math for resolution
          const dist = FixedMath.sqrt(distSq);
          const overlap = FixedMath.sub(minDist, dist);

          // Normalize direction (fixed-point)
          const nx = FixedMath.div(dx, dist);
          const nz = FixedMath.div(dz, dist);

          // Calculate push force based on overlap
          const pushForce = FixedMath.mul(overlap, this.config.pushStrength);

          // Apply push based on mass ratio
          const totalMass = FixedMath.add(bodyA.mass, bodyB.mass);
          const ratioA = FixedMath.div(bodyB.mass, totalMass);
          const ratioB = FixedMath.div(bodyA.mass, totalMass);

          // Apply push velocities (fixed-point)
          if (!bodyA.isStatic) {
            const pushA = FixedMath.mul(pushForce, ratioA);
            bodyA.velocity.x = FixedMath.sub(bodyA.velocity.x, FixedMath.mul(nx, pushA));
            bodyA.velocity.z = FixedMath.sub(bodyA.velocity.z, FixedMath.mul(nz, pushA));
          }

          if (!bodyB.isStatic) {
            const pushB = FixedMath.mul(pushForce, ratioB);
            bodyB.velocity.x = FixedMath.add(bodyB.velocity.x, FixedMath.mul(nx, pushB));
            bodyB.velocity.z = FixedMath.add(bodyB.velocity.z, FixedMath.mul(nz, pushB));
          }

          // Separate positions to prevent overlap (fixed-point)
          const separation = FixedMath.mul(overlap, FP_SEPARATION_HALF);
          if (!bodyA.isStatic) {
            const sepA = FixedMath.mul(separation, ratioA);
            entityA.fpPosition = {
              x: FixedMath.sub(fpPosA.x, FixedMath.mul(nx, sepA)),
              y: fpPosA.y,
              z: FixedMath.sub(fpPosA.z, FixedMath.mul(nz, sepA)),
            };
          }
          if (!bodyB.isStatic) {
            const sepB = FixedMath.mul(separation, ratioB);
            entityB.fpPosition = {
              x: FixedMath.add(fpPosB.x, FixedMath.mul(nx, sepB)),
              y: fpPosB.y,
              z: FixedMath.add(fpPosB.z, FixedMath.mul(nz, sepB)),
            };
          }
        }
      }
    }
  }

  /**
   * Apply velocities to entity positions using fixed-point arithmetic
   *
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private applyVelocities(dt: FixedPoint): void {
    // Pre-compute max velocity squared for clamping
    const maxVelSq = FixedMath.mul(this.config.maxVelocity, this.config.maxVelocity);

    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const body of sortedBodies) {
      if (body.isStatic) continue;

      const entity = this.entityManager.getEntity(body.entityId);
      if (!entity) continue;

      // Clamp velocity to max (using squared magnitude to avoid sqrt when possible)
      const velMagSq = FixedMath.add(
        FixedMath.mul(body.velocity.x, body.velocity.x),
        FixedMath.mul(body.velocity.z, body.velocity.z)
      );

      if (FixedMath.gt(velMagSq, maxVelSq)) {
        const scale = FixedMath.div(this.config.maxVelocity, FixedMath.sqrt(velMagSq));
        body.velocity.x = FixedMath.mul(body.velocity.x, scale);
        body.velocity.z = FixedMath.mul(body.velocity.z, scale);
      }

      // Apply velocity to position using fixed-point
      const fpPos = entity.fpPosition;
      entity.fpPosition = {
        x: FixedMath.add(fpPos.x, FixedMath.mul(body.velocity.x, dt)),
        y: fpPos.y, // Keep Y constant
        z: FixedMath.add(fpPos.z, FixedMath.mul(body.velocity.z, dt)),
      };
    }
  }

  /**
   * Apply friction to slow down units using fixed-point arithmetic
   *
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private applyFriction(): void {
    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const body of sortedBodies) {
      if (body.isStatic) continue;

      // Check if entity is actively moving to a target
      const entity = this.entityManager.getEntity(body.entityId);
      if (!entity) continue;

      const movement = entity.getComponent<MovementComponent>(
        ComponentType.Movement
      );

      // Only apply friction if not actively moving to a target
      // This allows pushing to have an effect while still allowing controlled movement
      if (!movement || !movement.isMoving) {
        body.velocity.x = FixedMath.mul(body.velocity.x, this.config.friction);
        body.velocity.z = FixedMath.mul(body.velocity.z, this.config.friction);

        // Stop very small velocities (using fixed-point comparison)
        if (FixedMath.lt(FixedMath.abs(body.velocity.x), FP_VELOCITY_EPSILON)) {
          body.velocity.x = FP_ZERO;
        }
        if (FixedMath.lt(FixedMath.abs(body.velocity.z), FP_VELOCITY_EPSILON)) {
          body.velocity.z = FP_ZERO;
        }
      }
    }
  }

  /**
   * Check if collision should be skipped between two entities
   * - Entities with ignorePhysics flag set should not participate in collisions
   * - Units don't collide with friendly buildings (bases, towers)
   */
  private shouldSkipCollision(
    entityA: import('../entities/Entity').Entity,
    entityB: import('../entities/Entity').Entity,
    bodyA: PhysicsBody,
    bodyB: PhysicsBody
  ): boolean {
    // Skip collisions with entities that should be ignored (dying, phasing, etc.)
    if (entityA.ignorePhysics || entityB.ignorePhysics) {
      return true;
    }

    // If neither is static, they should collide (unit vs unit)
    if (!bodyA.isStatic && !bodyB.isStatic) {
      return false;
    }

    // Get team components
    const teamA = entityA.getComponent<TeamComponent>(ComponentType.Team);
    const teamB = entityB.getComponent<TeamComponent>(ComponentType.Team);

    // If either doesn't have a team, let them collide
    if (!teamA || !teamB) {
      return false;
    }

    // If they're on the same team and one is static (building),
    // skip the collision so units can pass through friendly buildings
    return teamA.team === teamB.team && (bodyA.isStatic || bodyB.isStatic);
  }

  /**
   * Dispose the physics system
   */
  public dispose(): void {
    this.bodies.clear();
    this.spatialGrid.clear();
    this.checkedPairs.clear();
  }
}
