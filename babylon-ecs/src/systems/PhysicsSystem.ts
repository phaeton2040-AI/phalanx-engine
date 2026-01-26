import { Vector3 } from '@babylonjs/core';
import { EntityManager } from '../core/EntityManager';
import { ComponentType, MovementComponent, TeamComponent } from '../components';
import { isPhysicsIgnorable } from '../interfaces/IPhysicsAware';
import { networkConfig } from '../config/constants';

/**
 * Physics configuration for deterministic simulation
 */
export interface PhysicsConfig {
  fixedTimestep: number; // Fixed delta time for deterministic updates (e.g., 1/60)
  unitRadius: number; // Collision radius for units
  pushStrength: number; // How strongly units push each other
  maxVelocity: number; // Maximum velocity magnitude
  friction: number; // Friction coefficient (0-1)
  cellSize: number; // Spatial grid cell size
}

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  fixedTimestep: networkConfig.tickTimestep / networkConfig.physicsSubsteps, // Physics substeps per tick
  unitRadius: 1.0, // Units have radius of 1 (diameter 2 matches sphere mesh)
  pushStrength: 15.0, // Push force multiplier
  maxVelocity: 15.0, // Max speed
  friction: 0.92, // Velocity damping per frame
  cellSize: 8.0, // Should be >= 2 * max(unitRadius)
};

/**
 * PhysicsBody - Stores physics state for an entity
 */
export interface PhysicsBody {
  entityId: number;
  velocity: Vector3;
  radius: number;
  mass: number;
  isStatic: boolean; // Static bodies don't move (towers, bases)
  // Cached position for spatial hashing
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
 * Uses fixed timestep for reproducible results across clients
 * Uses spatial hashing for O(n) average-case collision detection
 * Minimizes allocations for mobile performance
 */
export class PhysicsSystem {
  private entityManager: EntityManager;
  private config: PhysicsConfig;
  private bodies: Map<number, PhysicsBody> = new Map();
  private accumulator: number = 0;
  private spatialGrid: SpatialGrid;

  // Pre-allocated vectors to avoid GC pressure in hot loops
  private readonly _tempVec1: Vector3 = new Vector3();
  private readonly _tempVec2: Vector3 = new Vector3();

  // Collision pair tracking to avoid duplicate checks
  private readonly checkedPairs: Set<string> = new Set();

  constructor(
    entityManager: EntityManager,
    _eventBus?: unknown,
    config?: Partial<PhysicsConfig>
  ) {
    this.entityManager = entityManager;
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...config };
    this.spatialGrid = new SpatialGrid(this.config.cellSize);
  }

  /**
   * Register an entity with the physics system
   */
  public registerBody(
    entityId: number,
    options: { radius?: number; mass?: number; isStatic?: boolean } = {}
  ): void {
    this.bodies.set(entityId, {
      entityId,
      velocity: Vector3.Zero(),
      radius: options.radius ?? this.config.unitRadius,
      mass: options.mass ?? 1.0,
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
   * Set velocity for an entity
   */
  public setVelocity(entityId: number, velocity: Vector3): void {
    const body = this.bodies.get(entityId);
    if (body && !body.isStatic) {
      body.velocity.copyFrom(velocity);
    }
  }

  /**
   * Add velocity to an entity
   */
  public addVelocity(entityId: number, velocity: Vector3): void {
    const body = this.bodies.get(entityId);
    if (body && !body.isStatic) {
      body.velocity.addInPlace(velocity);
    }
  }

  /**
   * Update physics simulation with fixed timestep (legacy frame-based update)
   * @param deltaTime Real delta time in seconds
   * @deprecated Use simulateTick() for deterministic network synchronization
   */
  public update(deltaTime: number): void {
    this.accumulator += deltaTime;

    // Run fixed timestep updates
    while (this.accumulator >= this.config.fixedTimestep) {
      this.fixedUpdate(this.config.fixedTimestep);
      this.accumulator -= this.config.fixedTimestep;
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
   * Fixed timestep physics update - deterministic
   */
  private fixedUpdate(dt: number): void {
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
   * Uses inline math to avoid Vector3 allocations
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
      if (isPhysicsIgnorable(entity) && entity.shouldIgnorePhysics()) {
        body.velocity.x = 0;
        body.velocity.z = 0;
        continue;
      }

      if (movement.isMoving) {
        const target = movement.targetPosition;
        const pos = entity.position;

        // Calculate direction inline to avoid allocations
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const distSq = dx * dx + dz * dz;
        const arrivalThresholdSq = 0.25; // 0.5^2

        if (distSq < arrivalThresholdSq) {
          // Arrived at destination
          movement.stop();
          body.velocity.x = 0;
          body.velocity.z = 0;
        } else {
          // Set velocity towards target
          const dist = Math.sqrt(distSq);
          const speed = movement.speed;
          body.velocity.x = (dx / dist) * speed;
          body.velocity.z = (dz / dist) * speed;
        }
      } else {
        // Unit is not moving - stop any residual velocity
        // This handles cases where combat system stopped the unit
        body.velocity.x = 0;
        body.velocity.z = 0;
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

      const pos = entity.position;
      body.lastX = pos.x;
      body.lastZ = pos.z;
      this.spatialGrid.insert(body.entityId, pos.x, pos.z, body.radius);
    }
  }

  /**
   * Resolve collisions using spatial hashing
   * Average case O(n) instead of O(n²)
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

      // Get only nearby bodies from spatial grid
      // Search radius includes own radius plus max possible other radius
      const nearby = this.spatialGrid.getPotentialCollisions(
        posAx,
        posAz,
        bodyA.radius + this.config.unitRadius * 2
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

        const posBx = bodyB.lastX;
        const posBz = bodyB.lastZ;

        // Calculate distance in XZ plane
        const dx = posBx - posAx;
        const dz = posBz - posAz;
        const distSq = dx * dx + dz * dz;
        const minDist = bodyA.radius + bodyB.radius;
        const minDistSq = minDist * minDist;

        if (distSq < minDistSq && distSq > 0.0001) {
          // Collision detected
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;

          // Normalize direction
          const nx = dx / dist;
          const nz = dz / dist;

          // Calculate push force based on overlap
          const pushForce = overlap * this.config.pushStrength;

          // Apply push based on mass ratio
          const totalMass = bodyA.mass + bodyB.mass;
          const ratioA = bodyB.mass / totalMass;
          const ratioB = bodyA.mass / totalMass;

          // Apply push velocities
          if (!bodyA.isStatic) {
            bodyA.velocity.x -= nx * pushForce * ratioA;
            bodyA.velocity.z -= nz * pushForce * ratioA;
          }

          if (!bodyB.isStatic) {
            bodyB.velocity.x += nx * pushForce * ratioB;
            bodyB.velocity.z += nz * pushForce * ratioB;
          }

          // Separate positions to prevent overlap
          const separation = overlap * 0.5;
          if (!bodyA.isStatic) {
            const posA = entityA.position;
            entityA.position = this._tempVec1
              .set(
                posA.x - nx * separation * ratioA,
                posA.y,
                posA.z - nz * separation * ratioA
              )
              .clone();
          }
          if (!bodyB.isStatic) {
            const posB = entityB.position;
            entityB.position = this._tempVec2
              .set(
                posB.x + nx * separation * ratioB,
                posB.y,
                posB.z + nz * separation * ratioB
              )
              .clone();
          }
        }
      }
    }
  }

  /**
   * Apply velocities to entity positions
   *
   * IMPORTANT: Processes bodies in deterministic order (sorted by entity ID)
   * for network synchronization.
   */
  private applyVelocities(dt: number): void {
    // Sort bodies by entity ID for deterministic iteration order
    const sortedBodies = Array.from(this.bodies.values()).sort(
      (a, b) => a.entityId - b.entityId
    );

    for (const body of sortedBodies) {
      if (body.isStatic) continue;

      const entity = this.entityManager.getEntity(body.entityId);
      if (!entity) continue;

      // Clamp velocity to max (using squared magnitude to avoid sqrt when possible)
      const velMagSq = body.velocity.x ** 2 + body.velocity.z ** 2;
      const maxVelSq = this.config.maxVelocity ** 2;
      if (velMagSq > maxVelSq) {
        const scale = this.config.maxVelocity / Math.sqrt(velMagSq);
        body.velocity.x *= scale;
        body.velocity.z *= scale;
      }

      // Apply velocity to position using pre-allocated vector
      const pos = entity.position;
      entity.position = this._tempVec1
        .set(
          pos.x + body.velocity.x * dt,
          pos.y, // Keep Y constant
          pos.z + body.velocity.z * dt
        )
        .clone();
    }
  }

  /**
   * Apply friction to slow down units
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
        body.velocity.x *= this.config.friction;
        body.velocity.z *= this.config.friction;

        // Stop very small velocities
        if (Math.abs(body.velocity.x) < 0.01) body.velocity.x = 0;
        if (Math.abs(body.velocity.z) < 0.01) body.velocity.z = 0;
      }
    }
  }

  /**
   * Check if collision should be skipped between two entities
   * - Entities implementing IPhysicsIgnorable can opt out of physics
   * - Units don't collide with friendly buildings (bases, towers)
   */
  private shouldSkipCollision(
    entityA: import('../entities/Entity').Entity,
    entityB: import('../entities/Entity').Entity,
    bodyA: PhysicsBody,
    bodyB: PhysicsBody
  ): boolean {
    // Skip collisions with entities that should be ignored (e.g., dying units)
    if (isPhysicsIgnorable(entityA) && entityA.shouldIgnorePhysics()) {
      return true;
    }
    if (isPhysicsIgnorable(entityB) && entityB.shouldIgnorePhysics()) {
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
    if (teamA.team === teamB.team && (bodyA.isStatic || bodyB.isStatic)) {
      return true;
    }

    return false;
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
