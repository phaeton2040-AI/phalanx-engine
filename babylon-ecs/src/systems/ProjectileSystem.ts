import { Scene, Engine, Vector3 } from "@babylonjs/core";
import { Projectile } from "../entities/Projectile";
import { ExplosionEffect } from "../effects/ExplosionEffect";
import { EntityManager } from "../core/EntityManager";
import { EventBus } from "../core/EventBus";
import { Entity } from "../entities/Entity";
import { ComponentType, TeamComponent } from "../components";
import { GameEvents, createEvent } from "../events";
import type { ProjectileSpawnedEvent, DamageRequestedEvent, ProjectileHitEvent } from "../events";
import type { TeamTag } from "../enums/TeamTag";

export interface ProjectileSpawnConfig {
    damage: number;
    speed?: number;
    lifetime?: number;
    team: TeamTag;
}

/**
 * ProjectileSystem - Manages all projectiles in the game
 * Uses EntityManager for target queries
 * Uses EventBus for decoupled damage dealing
 */
export class ProjectileSystem {
    private scene: Scene;
    private engine: Engine;
    private entityManager: EntityManager;
    private eventBus: EventBus;
    private projectiles: Projectile[] = [];
    private unsubscribers: (() => void)[] = [];

    constructor(scene: Scene, engine: Engine, entityManager: EntityManager, eventBus: EventBus) {
        this.scene = scene;
        this.engine = engine;
        this.entityManager = entityManager;
        this.eventBus = eventBus;

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Listen for projectile spawn requests from combat system
        this.unsubscribers.push(
            this.eventBus.on<ProjectileSpawnedEvent>(GameEvents.PROJECTILE_SPAWNED, (event) => {
                this.spawnProjectile(event.origin, event.direction, {
                    damage: event.damage,
                    speed: event.speed,
                    team: event.team,
                });
            })
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
        });
        this.projectiles.push(projectile);
        return projectile;
    }

    /**
     * Update all projectiles
     */
    public update(): void {
        const deltaTime = this.engine.getDeltaTime() / 1000;
        const projectilesToRemove: Projectile[] = [];

        // Get all potential targets (entities with Health and Team components)
        const potentialTargets = this.entityManager.queryEntities(
            ComponentType.Health,
            ComponentType.Team
        );

        for (const projectile of this.projectiles) {
            // Build target list for this projectile (only hostile entities)
            const targets = potentialTargets
                .filter(entity => {
                    if (entity.isDestroyed) return false;
                    const team = entity.getComponent<TeamComponent>(ComponentType.Team);
                    if (!team) return false;

                    // Only hit entities from different teams
                    return team.team !== projectile.team;
                });

            // Update projectile and check collisions
            const shouldDestroy = this.updateProjectile(projectile, deltaTime, targets);

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

        const hitRadius = 1.5;
        const groundLevel = 0;

        // Update lifetime
        const wasDestroyed = projectile.update(deltaTime, []);
        if (wasDestroyed && projectile.isDestroyed) return true;

        // Check if projectile hit the ground
        if (projectile.position.y <= groundLevel) {
            projectile.destroy();
            return true;
        }

        // Check collisions with targets
        for (const target of targets) {
            const distance = Vector3.Distance(projectile.position, target.position);

            if (distance < hitRadius) {
                // Emit damage request event instead of directly calling HealthSystem
                this.eventBus.emit<DamageRequestedEvent>(GameEvents.DAMAGE_REQUESTED, {
                    ...createEvent(),
                    entityId: target.id,
                    amount: projectile.damage,
                });

                // Emit projectile hit event for effects/sounds
                this.eventBus.emit<ProjectileHitEvent>(GameEvents.PROJECTILE_HIT, {
                    ...createEvent(),
                    targetId: target.id,
                    damage: projectile.damage,
                    position: projectile.position.clone(),
                    team: projectile.team,
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

