import { Scene, Vector3, Mesh } from "@babylonjs/core";
import type { IComponent } from "../components/Component";

let entityIdCounter = 0;

/**
 * Base Entity class - Container for components
 * Uses composition over inheritance
 */
export abstract class Entity {
    public readonly id: number;
    protected scene: Scene;
    protected mesh: Mesh | null = null;
    protected components: Map<symbol, IComponent> = new Map();
    private _isDestroyed: boolean = false;

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
        return types.every(type => this.components.has(type));
    }

    /**
     * Remove a component from this entity
     */
    public removeComponent(type: symbol): boolean {
        return this.components.delete(type);
    }

    /**
     * Get the entity's world position
     */
    public get position(): Vector3 {
        return this.mesh?.position ?? Vector3.Zero();
    }

    /**
     * Set the entity's world position
     */
    public set position(value: Vector3) {
        if (this.mesh) {
            this.mesh.position.copyFrom(value);
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
