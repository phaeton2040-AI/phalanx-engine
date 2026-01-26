import { Vector3 } from '@babylonjs/core';
import type { EntityManager } from '../core/EntityManager';

/**
 * Interpolation state for an entity
 * Stores previous and current simulation positions for smooth visual interpolation
 */
interface InterpolationState {
  entityId: number;
  /** Position from previous simulation tick */
  previousPosition: Vector3;
  /** Position from current simulation tick */
  currentPosition: Vector3;
  /** Visual position applied to mesh (interpolated) */
  visualPosition: Vector3;
  /** Whether this entity needs interpolation */
  active: boolean;
}

/**
 * InterpolationSystem - Provides smooth visual movement between network ticks
 *
 * ARCHITECTURE:
 * - Simulation runs at 20 ticks/sec (deterministic, synchronized)
 * - Rendering runs at 60 FPS (visual only, local)
 * - This system interpolates visual positions between simulation positions
 *
 * USAGE:
 * 1. Call snapshotPositions() BEFORE each simulation tick to save previous state
 * 2. Call captureCurrentPositions() AFTER each simulation tick to get new state
 * 3. Call interpolate(alpha) each render frame to smoothly blend positions
 *
 * The alpha value represents how far we are between the last tick and next tick:
 * - alpha = 0: Show position from previous tick
 * - alpha = 1: Show position from current tick
 * - alpha = 0.5: Show position halfway between
 */
export class InterpolationSystem {
  private entityManager: EntityManager;
  private states: Map<number, InterpolationState> = new Map();

  // Entities that should NOT be interpolated (static structures)
  private staticEntities: Set<number> = new Set();

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;
  }

  /**
   * Register an entity for interpolation
   * Call this when a new entity is created
   */
  public registerEntity(entityId: number, isStatic: boolean = false): void {
    if (isStatic) {
      this.staticEntities.add(entityId);
      return;
    }

    const entity = this.entityManager.getEntity(entityId);
    if (!entity) return;

    const pos = entity.position.clone();
    this.states.set(entityId, {
      entityId,
      previousPosition: pos.clone(),
      currentPosition: pos.clone(),
      visualPosition: pos.clone(),
      active: true,
    });
  }

  /**
   * Unregister an entity from interpolation
   * Call this when an entity is destroyed
   */
  public unregisterEntity(entityId: number): void {
    this.states.delete(entityId);
    this.staticEntities.delete(entityId);
  }

  /**
   * Snapshot current positions as "previous" positions
   * Call this BEFORE running simulation tick
   */
  public snapshotPositions(): void {
    for (const state of this.states.values()) {
      // Previous becomes what was current
      state.previousPosition.copyFrom(state.currentPosition);
    }
  }

  /**
   * Capture current simulation positions
   * Call this AFTER running simulation tick
   */
  public captureCurrentPositions(): void {
    for (const state of this.states.values()) {
      const entity = this.entityManager.getEntity(state.entityId);
      if (!entity) continue;

      // Capture the new authoritative simulation position
      state.currentPosition.copyFrom(entity.position);
    }
  }

  /**
   * Interpolate visual positions and apply to meshes
   * Call this every render frame
   *
   * @param alpha Interpolation factor (0 = previous tick, 1 = current tick)
   */
  public interpolate(alpha: number): void {
    // Clamp alpha to valid range
    alpha = Math.max(0, Math.min(1, alpha));

    for (const state of this.states.values()) {
      const entity = this.entityManager.getEntity(state.entityId);
      if (!entity) continue;

      // Lerp between previous and current positions
      const prev = state.previousPosition;
      const curr = state.currentPosition;

      state.visualPosition.x = prev.x + (curr.x - prev.x) * alpha;
      state.visualPosition.y = prev.y + (curr.y - prev.y) * alpha;
      state.visualPosition.z = prev.z + (curr.z - prev.z) * alpha;

      // Apply visual position to the entity's mesh
      entity.setVisualPosition(state.visualPosition);
    }
  }

  /**
   * Snap all visual positions to current simulation positions
   * Use this when teleporting or on initial spawn
   */
  public snapToCurrentPositions(): void {
    for (const state of this.states.values()) {
      const entity = this.entityManager.getEntity(state.entityId);
      if (!entity) continue;

      state.previousPosition.copyFrom(entity.position);
      state.currentPosition.copyFrom(entity.position);
      state.visualPosition.copyFrom(entity.position);
      entity.setVisualPosition(entity.position);
    }
  }

  /**
   * Clear all interpolation states
   */
  public clear(): void {
    this.states.clear();
    this.staticEntities.clear();
  }

  /**
   * Dispose of the system
   */
  public dispose(): void {
    this.clear();
  }
}
