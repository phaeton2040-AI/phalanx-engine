import { Vector3 } from "@babylonjs/core";
import type { TeamTag } from "../enums/TeamTag";

/**
 * Base interface for all game events
 */
export interface GameEvent {
    readonly timestamp: number;
}

/**
 * Creates a base event with timestamp
 */
export function createEvent(): GameEvent {
    return { timestamp: performance.now() };
}

// ============================================
// Combat Events
// ============================================

export interface AttackRequestedEvent extends GameEvent {
    attackerId: number;
    targetId: number;
    damage: number;
    projectileSpeed: number;
    attackOrigin: Vector3;
    team: TeamTag;
}

export interface ProjectileSpawnedEvent extends GameEvent {
    origin: Vector3;
    direction: Vector3;
    damage: number;
    speed: number;
    team: TeamTag;
}

export interface ProjectileHitEvent extends GameEvent {
    targetId: number;
    damage: number;
    position: Vector3;
    team: TeamTag;
}

// ============================================
// Health Events
// ============================================

export interface DamageRequestedEvent extends GameEvent {
    entityId: number;
    amount: number;
    sourceId?: number;
}

export interface DamageAppliedEvent extends GameEvent {
    entityId: number;
    amount: number;
    newHealth: number;
    maxHealth: number;
}

export interface HealRequestedEvent extends GameEvent {
    entityId: number;
    amount: number;
}

export interface EntityDestroyedEvent extends GameEvent {
    entityId: number;
    position: Vector3;
}

// ============================================
// Movement Events
// ============================================

export interface MoveRequestedEvent extends GameEvent {
    entityId: number;
    target: Vector3;
}

export interface MoveStartedEvent extends GameEvent {
    entityId: number;
    target: Vector3;
}

export interface MoveCompletedEvent extends GameEvent {
    entityId: number;
    position: Vector3;
}

export interface StopRequestedEvent extends GameEvent {
    entityId: number;
}

// ============================================
// Selection Events
// ============================================

export interface SelectEntityRequestedEvent extends GameEvent {
    entityId: number;
    exclusive?: boolean; // If true, deselect all others first
}

export interface DeselectEntityRequestedEvent extends GameEvent {
    entityId: number;
}

export interface DeselectAllRequestedEvent extends GameEvent {}

export interface EntitySelectedEvent extends GameEvent {
    entityId: number;
}

export interface EntityDeselectedEvent extends GameEvent {
    entityId: number;
}

export interface SelectionClearedEvent extends GameEvent {
    previouslySelectedIds: number[];
}

// ============================================
// Input Events
// ============================================

export interface LeftClickEvent extends GameEvent {
    pickedMesh: any;
    pickedPoint: Vector3 | null;
}

export interface RightClickEvent extends GameEvent {
    pickedMesh: any;
    pickedPoint: Vector3 | null;
}

export interface GroundClickedEvent extends GameEvent {
    position: Vector3;
    button: 'left' | 'right';
}

// ============================================
// Entity Lifecycle Events
// ============================================

export interface EntityCreatedEvent extends GameEvent {
    entityId: number;
    entityType: string;
    position: Vector3;
}

export interface EntityDisposedEvent extends GameEvent {
    entityId: number;
}

// ============================================
// UI Events
// ============================================

export interface ShowDestinationMarkerEvent extends GameEvent {
    position: Vector3;
}

export interface HideDestinationMarkerEvent extends GameEvent {}

