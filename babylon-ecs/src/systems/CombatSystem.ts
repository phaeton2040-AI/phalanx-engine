import { Engine, Vector3 } from "@babylonjs/core";
import { Entity } from "../entities/Entity";
import { EntityManager } from "../core/EntityManager";
import { EventBus } from "../core/EventBus";
import { GameRandom } from "../core/GameRandom";
import { ComponentType, TeamComponent, HealthComponent, AttackComponent, MovementComponent } from "../components";
import { GameEvents, createEvent } from "../events";
import type { ProjectileSpawnedEvent, DamageAppliedEvent } from "../events";
import { networkConfig } from "../config/constants";

/**
 * Combat system configuration for deterministic simulation
 */
export interface CombatConfig {
    fixedTimestep: number; // Fixed delta time for deterministic updates (e.g., 1/60)
    criticalHitChance: number; // Probability of critical hit (0-1)
    criticalHitMultiplier: number; // Damage multiplier on critical hit
}

const DEFAULT_COMBAT_CONFIG: CombatConfig = {
    // Combat updates once per network tick for deterministic lockstep
    fixedTimestep: networkConfig.tickTimestep,
    // Critical hit settings (using GameRandom for determinism)
    criticalHitChance: 0.10, // 10% base crit chance
    criticalHitMultiplier: 1.5, // 50% bonus damage on crit
};

/**
 * CombatSystem - Handles attack range detection and combat logic
 * Uses component-based entity queries
 * Uses EventBus for decoupled projectile spawning
 * 
 * IMPORTANT: Uses fixed timestep for deterministic attack cooldown updates.
 * This ensures combat outcomes are identical across all clients.
 *
 * Combat behavior:
 * - When an enemy is in range, the unit stops moving and attacks
 * - When damaged, unit moves to engage attacker if not already in range
 * - When the enemy is killed, the unit resumes moving to its original target
 * 
 * LOCKSTEP SYNCHRONIZATION:
 * Movement commands from combat use a direct callback instead of EventBus
 * to ensure they're executed synchronously during simulation.
 */
export class CombatSystem {
    private engine: Engine;
    private entityManager: EntityManager;
    private eventBus: EventBus;
    private config: CombatConfig;
    private unsubscribers: (() => void)[] = [];
    private currentTargets: Map<number, number> = new Map(); // attacker ID -> target ID
    private storedMoveTargets: Map<number, Vector3> = new Map(); // attacker ID -> original move target
    private aggroTargets: Map<number, number> = new Map(); // entity ID -> attacker ID (who damaged them)
    
    // Fixed timestep accumulator for deterministic updates
    private accumulator: number = 0;
    
    // Callback for moving units (bypasses EventBus for lockstep simulation)
    private moveUnitCallback: ((entityId: number, target: Vector3) => void) | null = null;

    constructor(engine: Engine, entityManager: EntityManager, eventBus: EventBus, config?: Partial<CombatConfig>) {
        this.engine = engine;
        this.entityManager = entityManager;
        this.eventBus = eventBus;
        this.config = { ...DEFAULT_COMBAT_CONFIG, ...config };

        this.setupEventListeners();
    }

    /**
     * Set the callback for moving units (for lockstep simulation)
     * This bypasses EventBus to ensure synchronous execution during simulation
     */
    public setMoveUnitCallback(callback: (entityId: number, target: Vector3) => void): void {
        this.moveUnitCallback = callback;
    }

    /**
     * Setup event listeners for damage tracking
     */
    private setupEventListeners(): void {
        // Listen for damage events to track who attacked whom
        this.unsubscribers.push(
            this.eventBus.on<DamageAppliedEvent>(GameEvents.DAMAGE_APPLIED, (event) => {
                if (event.sourceId !== undefined) {
                    this.handleDamageReceived(event.entityId, event.sourceId);
                }
            })
        );
    }

    /**
     * Handle when an entity receives damage - set aggro on the attacker
     */
    private handleDamageReceived(targetId: number, attackerId: number): void {
        const target = this.entityManager.getEntity(targetId);
        const attacker = this.entityManager.getEntity(attackerId);

        if (!target || !attacker) return;

        // Only mobile units can retaliate
        const movement = target.getComponent<MovementComponent>(ComponentType.Movement);
        if (!movement) return;

        // Check if the target can attack (has attack component)
        const attack = target.getComponent<AttackComponent>(ComponentType.Attack);
        if (!attack) return;

        // Check if attacker is still alive
        const attackerHealth = attacker.getComponent<HealthComponent>(ComponentType.Health);
        if (attackerHealth?.isDestroyed) return;

        // Set aggro target - this unit will prioritize attacking who hit them
        this.aggroTargets.set(targetId, attackerId);
    }

    /**
     * Update combat system - called every frame (legacy)
     * Uses fixed timestep accumulator for deterministic attack cooldown updates.
     * @deprecated Use simulateTick() for deterministic network synchronization
     */
    public update(): void {
        const deltaTime = this.engine.getDeltaTime() / 1000;
        this.accumulator += deltaTime;

        // Run fixed timestep updates for deterministic combat
        while (this.accumulator >= this.config.fixedTimestep) {
            this.fixedUpdate(this.config.fixedTimestep);
            this.accumulator -= this.config.fixedTimestep;
        }
    }

    /**
     * Simulate one network tick worth of combat
     * Called exactly once per network tick for deterministic lockstep simulation
     */
    public simulateTick(): void {
        this.fixedUpdate(this.config.fixedTimestep);
    }

    /**
     * Fixed timestep combat update - deterministic
     * 
     * IMPORTANT: For network determinism, attackers are processed in entity ID order
     * (guaranteed by queryEntities returning sorted results), and target selection
     * uses deterministic tie-breaking based on entity ID.
     */
    private fixedUpdate(deltaTime: number): void {
        // Query all entities with Attack and Team components
        // queryEntities returns entities sorted by ID for deterministic processing
        const attackers = this.entityManager.queryEntities(
            ComponentType.Attack,
            ComponentType.Team,
            ComponentType.Health
        );

        for (const attacker of attackers) {
            const health = attacker.getComponent<HealthComponent>(ComponentType.Health);
            if (health?.isDestroyed) continue;

            const attack = attacker.getComponent<AttackComponent>(ComponentType.Attack)!;
            const movement = attacker.getComponent<MovementComponent>(ComponentType.Movement);

            // Update attack cooldown with fixed timestep
            attack.updateCooldown(deltaTime);

            // Check for aggro target first (unit that attacked us)
            const aggroTargetId = this.aggroTargets.get(attacker.id);
            let aggroTarget: Entity | null = null;
            
            if (aggroTargetId !== undefined) {
                aggroTarget = this.entityManager.getEntity(aggroTargetId) ?? null;
                const aggroHealth = aggroTarget?.getComponent<HealthComponent>(ComponentType.Health);
                
                // Clear aggro if target is dead or doesn't exist
                if (!aggroTarget || aggroHealth?.isDestroyed) {
                    this.aggroTargets.delete(attacker.id);
                    aggroTarget = null;
                }
            }

            // Find target in range, or move towards aggro target if out of range
            const target = this.findTarget(attacker, attackers, aggroTarget);
            const previousTargetId = this.currentTargets.get(attacker.id);

            if (target) {
                // We have a target in range
                if (previousTargetId !== target.id) {
                    // New target - store current movement target if moving
                    if (movement?.isMoving && !this.storedMoveTargets.has(attacker.id)) {
                        this.storedMoveTargets.set(attacker.id, movement.targetPosition.clone());
                    }
                }

                this.currentTargets.set(attacker.id, target.id);

                // Stop movement while attacking
                if (movement?.isMoving) {
                    movement.stop();
                }

                // Attack if ready
                if (attack.canAttack()) {
                    this.performAttack(attacker, target);
                }
                
                // Clear aggro if we killed our aggro target
                if (aggroTargetId === target.id) {
                    const targetHealth = target.getComponent<HealthComponent>(ComponentType.Health);
                    if (targetHealth?.isDestroyed) {
                        this.aggroTargets.delete(attacker.id);
                    }
                }
            } else if (aggroTarget && movement) {
                // Aggro target exists but is out of range - move towards them
                const distance = Vector3.Distance(attacker.position, aggroTarget.position);
                
                if (distance > attack.range) {
                    // Store original target if not already stored
                    if (!this.storedMoveTargets.has(attacker.id) && movement.isMoving) {
                        this.storedMoveTargets.set(attacker.id, movement.targetPosition.clone());
                    } else if (!this.storedMoveTargets.has(attacker.id) && !movement.isMoving) {
                        // If not moving, store current position as fallback
                        this.storedMoveTargets.set(attacker.id, attacker.position.clone());
                    }
                    
                    // Move towards the aggro target (use callback for lockstep)
                    this.requestMove(attacker.id, aggroTarget.position.clone());
                }
            } else {
                // No target in range and no aggro target
                if (previousTargetId !== undefined) {
                    // We just lost our target - resume movement to original destination
                    this.currentTargets.delete(attacker.id);

                    const storedTarget = this.storedMoveTargets.get(attacker.id);
                    if (storedTarget && movement) {
                        // Resume movement (use callback for lockstep)
                        this.requestMove(attacker.id, storedTarget);
                        this.storedMoveTargets.delete(attacker.id);
                    }
                }
            }
        }
    }

    /**
     * Request movement for an entity (uses callback for lockstep synchronization)
     */
    private requestMove(entityId: number, target: Vector3): void {
        if (this.moveUnitCallback) {
            this.moveUnitCallback(entityId, target);
        } else {
            // Fallback to EventBus (for non-networked testing)
            this.eventBus.emit(GameEvents.MOVE_REQUESTED, {
                ...createEvent(),
                entityId,
                target,
            });
        }
    }

    /**
     * Find the closest hostile target in attack range
     * Prioritizes aggro target if it's in range
     * 
     * IMPORTANT: Uses deterministic tie-breaking for network synchronization.
     * When two targets are at equal distance, the one with the lower entity ID
     * is chosen. This ensures all clients select the same target.
     */
    private findTarget(attacker: Entity, allCombatants: Entity[], aggroTarget: Entity | null): Entity | null {
        const attackerTeam = attacker.getComponent<TeamComponent>(ComponentType.Team)!;
        const attack = attacker.getComponent<AttackComponent>(ComponentType.Attack)!;

        // If we have an aggro target in range, prioritize it
        if (aggroTarget) {
            const aggroHealth = aggroTarget.getComponent<HealthComponent>(ComponentType.Health);
            if (!aggroHealth?.isDestroyed) {
                const aggroDistance = Vector3.Distance(attacker.position, aggroTarget.position);
                if (aggroDistance <= attack.range) {
                    return aggroTarget;
                }
            }
        }

        let closestTarget: Entity | null = null;
        let closestDistance = Infinity;

        for (const potential of allCombatants) {
            if (potential.id === attacker.id) continue;

            const health = potential.getComponent<HealthComponent>(ComponentType.Health);
            if (health?.isDestroyed) continue;

            const targetTeam = potential.getComponent<TeamComponent>(ComponentType.Team);
            if (!targetTeam || !attackerTeam.isHostileTo(targetTeam)) continue;

            const distance = Vector3.Distance(attacker.position, potential.position);

            if (distance <= attack.range) {
                // Deterministic tie-breaking: prefer lower entity ID when distances are equal
                // Use a small epsilon for floating-point comparison
                const epsilon = 0.0001;
                const isCloser = distance < closestDistance - epsilon;
                const isSameDistance = Math.abs(distance - closestDistance) <= epsilon;
                const hasLowerIdTieBreak = isSameDistance && (closestTarget === null || potential.id < closestTarget.id);
                
                if (isCloser || hasLowerIdTieBreak) {
                    closestDistance = distance;
                    closestTarget = potential;
                }
            }
        }

        return closestTarget;
    }

    /**
     * Perform an attack from attacker to target
     * Uses GameRandom for deterministic critical hit calculation
     */
    private performAttack(attacker: Entity, target: Entity): void {
        const attack = attacker.getComponent<AttackComponent>(ComponentType.Attack)!;
        const team = attacker.getComponent<TeamComponent>(ComponentType.Team)!;

        // Calculate direction
        const origin = attack.getAttackOrigin(attacker.position);
        const direction = target.position.subtract(origin).normalize();

        // Calculate damage with critical hit chance (deterministic via GameRandom)
        let damage = attack.damage;
        let isCritical = false;

        if (GameRandom.isInitialized()) {
            isCritical = GameRandom.boolean(this.config.criticalHitChance);
            if (isCritical) {
                damage = Math.floor(damage * this.config.criticalHitMultiplier);
                console.log(`[Combat] Critical hit! ${damage} damage (${this.config.criticalHitMultiplier}x)`);
            }
        }

        // Emit projectile spawn event instead of calling ProjectileSystem directly
        this.eventBus.emit<ProjectileSpawnedEvent>(GameEvents.PROJECTILE_SPAWNED, {
            ...createEvent(),
            origin: origin.clone(),
            direction: direction.clone(),
            damage: damage,
            speed: attack.projectileSpeed,
            team: team.team,
            sourceId: attacker.id,
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
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.currentTargets.clear();
        this.storedMoveTargets.clear();
        this.aggroTargets.clear();
    }
}
