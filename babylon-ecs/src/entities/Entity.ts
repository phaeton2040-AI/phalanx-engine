import { Scene, Vector3, Mesh } from '@babylonjs/core';
import type { IComponent } from '../components/Component';

let entityIdCounter = 0;

/**
 * Reset the entity ID counter - used when starting a new game
 * to ensure deterministic IDs across all clients
 */
export function resetEntityIdCounter(): void {
  entityIdCounter = 0;
}

/**
 * Base Entity class - Container for components
 * Uses composition over inheritance
 *
 * INTERPOLATION ARCHITECTURE:
 * - simulationPosition: The authoritative position updated by physics (deterministic)
 * - mesh.position: The visual position used for rendering (can be interpolated)
 * - By default, they are the same. InterpolationSystem can separate them for smooth visuals.
 */
export abstract class Entity {
  public readonly id: number;
  protected scene: Scene;
  protected mesh: Mesh | null = null;
  protected components: Map<symbol, IComponent> = new Map();
  private _isDestroyed: boolean = false;

  // Simulation position (authoritative, used by physics/combat)
  private _simulationPosition: Vector3 = new Vector3();

  constructor(scene: Scene) {
    this.id = ++entityIdCounter;
    this.scene = scene;
  }

  /**
   * Add a component to this entity
   */
  public addComponent<T extends IComponent>(component: T): T {
    this.components.set(component.type, component);
    return component;
  }

  /**
   * Get a component by type with type assertion
   * Use: entity.getComponent<AttackComponent>(ComponentType.Attack)
   */
  public getComponent<T extends IComponent>(type: symbol): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  /**
   * Check if entity has a component
   */
  public hasComponent(type: symbol): boolean {
    return this.components.has(type);
  }

  /**
   * Check if entity has all specified components
   */
  public hasComponents(...types: symbol[]): boolean {
    return types.every((type) => this.components.has(type));
  }

  /**
   * Remove a component from this entity
   */
  public removeComponent(type: symbol): boolean {
    return this.components.delete(type);
  }

  /**
   * Get the entity's simulation position (authoritative, deterministic)
   * This is the position used by physics, combat, and other gameplay systems.
   */
  public get position(): Vector3 {
    return this._simulationPosition;
  }

  /**
   * Set the entity's simulation position (authoritative, deterministic)
   * By default, also updates the visual (mesh) position.
   * InterpolationSystem may override the visual position separately.
   */
  public set position(value: Vector3) {
    this._simulationPosition.copyFrom(value);
    // Also update mesh position (visual) by default
    if (this.mesh) {
      this.mesh.position.copyFrom(value);
    }
  }

  /**
   * Set only the visual position (mesh) without affecting simulation position
   * Used by InterpolationSystem for smooth rendering between ticks
   */
  public setVisualPosition(value: Vector3): void {
    if (this.mesh) {
      this.mesh.position.copyFrom(value);
    }
  }

  /**
   * Get the visual position (mesh position)
   */
  public getVisualPosition(): Vector3 {
    return this.mesh?.position ?? this._simulationPosition.clone();
  }

  /**
   * Sync simulation position from mesh (call after mesh is created)
   * Used during entity initialization
   */
  public syncSimulationPosition(): void {
    if (this.mesh) {
      this._simulationPosition.copyFrom(this.mesh.position);
    }
  }

  /**
   * Get the main mesh of this entity
   */
  public getMesh(): Mesh | null {
    return this.mesh;
  }

  /**
   * Check if entity is destroyed
   */
  public get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Mark entity as destroyed (actual cleanup done by EntityManager)
   */
  public destroy(): void {
    this._isDestroyed = true;
  }

  /**
   * Cleanup resources - called by EntityManager
   */
  public dispose(): void {
    this._isDestroyed = true;
    this.components.clear();
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
  }
}
