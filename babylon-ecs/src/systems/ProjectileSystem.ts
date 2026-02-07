import { Scene, Engine, Vector3 } from '@babylonjs/core';
import { Projectile } from '../entities/Projectile';
import { ExplosionEffect } from '../effects/ExplosionEffect';
import { EntityManager } from '../core/EntityManager';
import { EventBus } from '../core/EventBus';
import { Entity } from '../entities/Entity';
import { ComponentType, TeamComponent } from '../components';
import { GameEvents, createEvent } from '../events';
import type {
  ProjectileSpawnedEvent,
  DamageRequestedEvent,
  ProjectileHitEvent,
} from '../events';
import type { TeamTag } from '../enums/TeamTag';
import { networkConfig } from '../config/constants';
import { FP, FPVector3 } from 'phalanx-math';

// Pre-computed fixed-point constants for projectile collision
const FP_HIT_RADIUS_SQ = FP.FromFloat(1.5 * 1.5); // hitRadius^2 = 2.25
const FP_GROUND_LEVEL = FP._0;

export interface ProjectileSpawnConfig {
  damage: number;
  speed?: number;
  lifetime?: number;
  team: TeamTag;
  sourceId: number; // ID of the entity that fired the projectile
}

/**
 * Projectile system configuration for deterministic simulation
 */
export interface ProjectileConfig {
  fixedTimestep: number; // Fixed delta time for deterministic updates (e.g., 1/60)
}

const DEFAULT_PROJECTILE_CONFIG: ProjectileConfig = {
  // Projectiles update once per network tick for deterministic lockstep
  fixedTimestep: networkConfig.tickTimestep,
};

/**
 * ProjectileSystem - Manages all projectiles in the game
 * Uses EntityManager for target queries
 * Uses EventBus for decoupled damage dealing
 *
 * IMPORTANT: Uses fixed timestep for deterministic projectile movement.
 * This ensures projectile hit detection is identical across all clients.
 */
export class ProjectileSystem {
  private scene: Scene;
  private engine: Engine;
  private entityManager: EntityManager;
  private eventBus: EventBus;
  private config: ProjectileConfig;
  private projectiles: Projectile[] = [];
  private unsubscribers: (() => void)[] = [];

  // Fixed timestep accumulator for deterministic updates
  private accumulator: number = 0;

  constructor(
    scene: Scene,
    engine: Engine,
    entityManager: EntityManager,
    eventBus: EventBus,
    config?: Partial<ProjectileConfig>
  ) {
    this.scene = scene;
    this.engine = engine;
    this.entityManager = entityManager;
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_PROJECTILE_CONFIG, ...config };

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for projectile spawn requests from combat system
    this.unsubscribers.push(
      this.eventBus.on<ProjectileSpawnedEvent>(
        GameEvents.PROJECTILE_SPAWNED,
        (event) => {
          this.spawnProjectile(event.origin, event.direction, {
            damage: event.damage,
            speed: event.speed,
            team: event.team,
            sourceId: event.sourceId,
          });
        }
      )
    );
  }

  /**
   * Spawn a new projectile
   */
  public spawnProjectile(
    origin: Vector3,
    direction: Vector3,
    config: ProjectileSpawnConfig
  ): Projectile {
    const projectile = new Projectile(this.scene, origin, direction, {
      damage: config.damage,
      speed: config.speed,
      lifetime: config.lifetime,
      team: config.team,
      sourceId: config.sourceId,
    });
    this.projectiles.push(projectile);
    return projectile;
  }

  /**
   * Update all projectiles - uses fixed timestep for determinism (legacy)
   * @deprecated Use simulateTick() for deterministic network synchronization
   */
  public update(): void {
    const deltaTime = this.engine.getDeltaTime() / 1000;
    this.accumulator += deltaTime;

    // Run fixed timestep updates for deterministic projectile movement
    while (this.accumulator >= this.config.fixedTimestep) {
      this.fixedUpdate(this.config.fixedTimestep);
      this.accumulator -= this.config.fixedTimestep;
    }
  }

  /**
   * Simulate one network tick worth of projectile updates
   * Called exactly once per network tick for deterministic lockstep simulation
   */
  public simulateTick(): void {
    this.fixedUpdate(this.config.fixedTimestep);
  }

  /**
   * Fixed timestep projectile update - deterministic
   */
  private fixedUpdate(deltaTime: number): void {
    const projectilesToRemove: Projectile[] = [];

    // Get all potential targets (entities with Health and Team components)
    // queryEntities already returns entities sorted by ID for determinism
    const potentialTargets = this.entityManager.queryEntities(
      ComponentType.Health,
      ComponentType.Team
    );

    for (const projectile of this.projectiles) {
      // Build target list for this projectile (only hostile entities)
      const targets = potentialTargets.filter((entity) => {
        if (entity.isDestroyed) return false;
        const team = entity.getComponent<TeamComponent>(ComponentType.Team);
        if (!team) return false;

        // Only hit entities from different teams
        return team.team !== projectile.team;
      });

      // Update projectile and check collisions with fixed timestep
      const shouldDestroy = this.updateProjectile(
        projectile,
        deltaTime,
        targets
      );

      if (shouldDestroy) {
        projectilesToRemove.push(projectile);
      }
    }

    // Remove and dispose destroyed projectiles
    for (const projectile of projectilesToRemove) {
      this.removeProjectile(projectile);
    }
  }

  private updateProjectile(
    projectile: Projectile,
    deltaTime: number,
    targets: Entity[]
  ): boolean {
    if (projectile.isDestroyed) return true;

    // Update lifetime and movement (using fixed-point internally)
    const wasDestroyed = projectile.update(deltaTime, []);
    if (wasDestroyed && projectile.isDestroyed) return true;

    // Check if projectile hit the ground using fixed-point
    if (FP.Lte(projectile.fpPosition.y, FP_GROUND_LEVEL)) {
      projectile.destroy();
      return true;
    }

    // Check collisions with targets using fixed-point squared distance
    for (const target of targets) {
      const distanceSq = FPVector3.SqrDistance(
        projectile.fpPosition,
        target.fpPosition
      );

      if (FP.Lt(distanceSq, FP_HIT_RADIUS_SQ)) {
        // Emit damage request event instead of directly calling HealthSystem
        this.eventBus.emit<DamageRequestedEvent>(GameEvents.DAMAGE_REQUESTED, {
          ...createEvent(),
          entityId: target.id,
          amount: projectile.damage,
          sourceId: projectile.sourceId,
        });

        // Emit projectile hit event for effects/sounds
        this.eventBus.emit<ProjectileHitEvent>(GameEvents.PROJECTILE_HIT, {
          ...createEvent(),
          targetId: target.id,
          damage: projectile.damage,
          position: projectile.position.clone(),
          team: projectile.team,
          sourceId: projectile.sourceId,
        });

        projectile.destroy();
        return true;
      }
    }

    return false;
  }

  /**
   * Remove a projectile from the system
   */
  private removeProjectile(projectile: Projectile): void {
    const index = this.projectiles.indexOf(projectile);
    if (index > -1) {
      this.projectiles.splice(index, 1);
    }

    // Create explosion effect if projectile hit something
    if (projectile.isDestroyed) {
      new ExplosionEffect(this.scene, projectile.position);
    }

    projectile.dispose();
  }

  /**
   * Clear all projectiles
   */
  public clear(): void {
    for (const projectile of this.projectiles) {
      projectile.dispose();
    }
    this.projectiles = [];
  }

  public dispose(): void {
    // Unsubscribe from all events
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.clear();
  }
}
