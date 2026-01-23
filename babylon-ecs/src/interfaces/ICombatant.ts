import { Entity } from "../entities/Entity";
import { Vector3 } from "@babylonjs/core";

/**
 * Interface for entities with animation systems that need frame updates.
 */
export interface IAnimated {
    /**
     * Update animation state based on current entity state.
     * Should be called in the render loop.
     */
    updateAnimation(): void;

    /**
     * Update rotation interpolation for smooth orientation.
     * @param deltaTime Time since last frame in seconds
     */
    updateRotation(deltaTime: number): void;
}

/**
 * Interface for entities that can participate in combat with animations.
 * Provides methods for managing attack animations, combat state, and orientation.
 */
export interface ICombatant {
    /**
     * Play an attack animation with optional damage callback.
     * @param onDealDamage Callback invoked when damage should be dealt (at animation hit point)
     * @returns true if attack animation started successfully
     */
    playAttackAnimation(onDealDamage?: () => void): boolean;

    /**
     * Start the deterministic attack lock timer.
     * This prevents movement for a fixed duration for network sync.
     */
    startAttackLock(): void;

    /**
     * Update the attack lock timer.
     * @param deltaTime Fixed timestep from simulation
     */
    updateAttackLock(deltaTime: number): void;

    /**
     * Orient the unit toward a target position.
     * @param targetPosition The position to face
     */
    orientToTarget(targetPosition: Vector3): void;

    /**
     * Orient the unit along its default movement direction.
     */
    orientToMovementDirection(): void;

    /**
     * Notify the unit that movement has started.
     * Triggers run animation transition.
     */
    notifyMovementStarted(): void;

    /**
     * End combat mode, allowing transition to idle/run animations.
     */
    endCombat(): void;

    /**
     * Check if the unit is currently in an attacking state.
     * Used to prevent movement during attacks.
     */
    readonly isCurrentlyAttacking: boolean;

    /**
     * Check if the unit is currently in combat mode.
     */
    readonly isInCombat: boolean;
}

/**
 * Interface for entities with death sequences.
 * Provides methods for starting death animations and tracking dying state.
 */
export interface IDeathSequence {
    /**
     * Check if the unit is currently dying.
     */
    readonly isDying: boolean;

    /**
     * Start the death sequence with a callback for when it completes.
     * @param onComplete Called when death animation finishes
     */
    startDeathSequence(onComplete: () => void): void;
}

/**
 * Type guard to check if an entity implements IAnimated
 */
export function isAnimated(entity: Entity): entity is Entity & IAnimated {
    return 'updateAnimation' in entity &&
           'updateRotation' in entity &&
           typeof (entity as any).updateAnimation === 'function' &&
           typeof (entity as any).updateRotation === 'function';
}

/**
 * Type guard to check if an entity implements ICombatant
 */
export function isCombatant(entity: Entity): entity is Entity & ICombatant {
    return 'playAttackAnimation' in entity &&
           'startAttackLock' in entity &&
           'orientToTarget' in entity &&
           'isCurrentlyAttacking' in entity;
}

/**
 * Type guard to check if an entity implements IDeathSequence
 */
export function hasDeathSequence(entity: Entity): entity is Entity & IDeathSequence {
    return 'isDying' in entity &&
           'startDeathSequence' in entity;
}
