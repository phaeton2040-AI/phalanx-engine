import { Engine, Vector3 } from "@babylonjs/core";
import { Entity } from "../entities/Entity";
import { EntityManager } from "../core/EntityManager";
import { EventBus } from "../core/EventBus";
import { ComponentType, TeamComponent, HealthComponent, AttackComponent } from "../components";
import { GameEvents, createEvent } from "../events";
import type { ProjectileSpawnedEvent } from "../events";

/**
 * CombatSystem - Handles attack range detection and combat logic
 * Uses component-based entity queries
 * Uses EventBus for decoupled projectile spawning
 */
export class CombatSystem {
    private engine: Engine;
    private entityManager: EntityManager;
    private eventBus: EventBus;
    private currentTargets: Map<number, number> = new Map(); // attacker ID -> target ID

    constructor(engine: Engine, entityManager: EntityManager, eventBus: EventBus) {
        this.engine = engine;
        this.entityManager = entityManager;
        this.eventBus = eventBus;
    }

    /**
     * Update combat system - called every frame
     */
    public update(): void {
        const deltaTime = this.engine.getDeltaTime() / 1000;

        // Query all entities with Attack and Team components
        const attackers = this.entityManager.queryEntities(
            ComponentType.Attack,
            ComponentType.Team,
            ComponentType.Health
        );

        for (const attacker of attackers) {
            const health = attacker.getComponent<HealthComponent>(ComponentType.Health);
            if (health?.isDestroyed) continue;

            const attack = attacker.getComponent<AttackComponent>(ComponentType.Attack)!;

            // Update attack cooldown
            attack.updateCooldown(deltaTime);

            // Find target in range
            const target = this.findTarget(attacker, attackers);

            if (target) {
                this.currentTargets.set(attacker.id, target.id);

                // Attack if ready
                if (attack.canAttack()) {
                    this.performAttack(attacker, target);
                }
            } else {
                this.currentTargets.delete(attacker.id);
            }
        }
    }

    /**
     * Find the closest hostile target in attack range
     */
    private findTarget(attacker: Entity, allCombatants: Entity[]): Entity | null {
        const attackerTeam = attacker.getComponent<TeamComponent>(ComponentType.Team)!;
        const attack = attacker.getComponent<AttackComponent>(ComponentType.Attack)!;

        let closestTarget: Entity | null = null;
        let closestDistance = Infinity;

        for (const potential of allCombatants) {
            if (potential.id === attacker.id) continue;

            const health = potential.getComponent<HealthComponent>(ComponentType.Health);
            if (health?.isDestroyed) continue;

            const targetTeam = potential.getComponent<TeamComponent>(ComponentType.Team);
            if (!targetTeam || !attackerTeam.isHostileTo(targetTeam)) continue;

            const distance = Vector3.Distance(attacker.position, potential.position);

            if (distance <= attack.range && distance < closestDistance) {
                closestDistance = distance;
                closestTarget = potential;
            }
        }

        return closestTarget;
    }

    /**
     * Perform an attack from attacker to target
     */
    private performAttack(attacker: Entity, target: Entity): void {
        const attack = attacker.getComponent<AttackComponent>(ComponentType.Attack)!;
        const team = attacker.getComponent<TeamComponent>(ComponentType.Team)!;

        // Calculate direction
        const origin = attack.getAttackOrigin(attacker.position);
        const direction = target.position.subtract(origin).normalize();

        // Emit projectile spawn event instead of calling ProjectileSystem directly
        this.eventBus.emit<ProjectileSpawnedEvent>(GameEvents.PROJECTILE_SPAWNED, {
            ...createEvent(),
            origin: origin.clone(),
            direction: direction.clone(),
            damage: attack.damage,
            speed: attack.projectileSpeed,
            team: team.team,
        });

        // Reset cooldown
        attack.onAttackPerformed();
    }

    /**
     * Get the current target of an entity
     */
    public getTarget(entityId: number): Entity | null {
        const targetId = this.currentTargets.get(entityId);
        if (targetId === undefined) return null;
        return this.entityManager.getEntity(targetId) ?? null;
    }

    /**
     * Dispose and cleanup
     */
    public dispose(): void {
        this.currentTargets.clear();
    }
}
