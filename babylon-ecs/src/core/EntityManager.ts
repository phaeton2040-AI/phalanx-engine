import { Entity } from "../entities/Entity";
import { ComponentType } from "../components/Component";

/**
 * EntityManager - Central registry for all game entities
 * Provides efficient component-based queries for systems
 */
export class EntityManager {
    private entities: Map<number, Entity> = new Map();

    // Component indices for fast queries
    // These are Sets of entity IDs that have each component
    private componentIndices: Map<symbol, Set<number>> = new Map();

    constructor() {
        // Initialize indices for known component types
        Object.values(ComponentType).forEach(type => {
            this.componentIndices.set(type, new Set());
        });
    }

    /**
     * Register an entity with the manager
     */
    public addEntity(entity: Entity): void {
        this.entities.set(entity.id, entity);

        // Update component indices
        Object.values(ComponentType).forEach(type => {
            if (entity.hasComponent(type)) {
                this.componentIndices.get(type)?.add(entity.id);
            }
        });
    }

    /**
     * Remove an entity from the manager
     */
    public removeEntity(entity: Entity): void {
        // Remove from component indices
        Object.values(ComponentType).forEach(type => {
            this.componentIndices.get(type)?.delete(entity.id);
        });

        this.entities.delete(entity.id);
    }

    /**
     * Get entity by ID
     */
    public getEntity(id: number): Entity | undefined {
        return this.entities.get(id);
    }

    /**
     * Get all entities
     * 
     * IMPORTANT: Results are sorted by entity ID for deterministic ordering
     * across all clients in networked games.
     */
    public getAllEntities(): Entity[] {
        return Array.from(this.entities.values()).sort((a, b) => a.id - b.id);
    }

    /**
     * Query entities that have ALL specified components
     * This is the primary method systems use to get relevant entities
     * 
     * IMPORTANT: Results are sorted by entity ID for deterministic ordering
     * across all clients in networked games. This ensures that iteration
     * order is consistent, which is critical for deterministic combat.
     */
    public queryEntities(...componentTypes: symbol[]): Entity[] {
        if (componentTypes.length === 0) {
            return this.getAllEntities();
        }

        // Start with the smallest set for efficiency
        const sortedTypes = [...componentTypes].sort((a, b) => {
            const sizeA = this.componentIndices.get(a)?.size ?? 0;
            const sizeB = this.componentIndices.get(b)?.size ?? 0;
            return sizeA - sizeB;
        });

        const firstSet = this.componentIndices.get(sortedTypes[0]);
        if (!firstSet || firstSet.size === 0) {
            return [];
        }

        // Filter by intersection of all component sets
        const result: Entity[] = [];
        for (const entityId of firstSet) {
            const entity = this.entities.get(entityId);
            if (entity && !entity.isDestroyed && entity.hasComponents(...componentTypes)) {
                result.push(entity);
            }
        }

        // Sort by entity ID for deterministic ordering across all clients
        result.sort((a, b) => a.id - b.id);

        return result;
    }

    /**
     * Query entities that have at least ONE of the specified components
     * 
     * IMPORTANT: Results are sorted by entity ID for deterministic ordering
     * across all clients in networked games.
     */
    public queryEntitiesAny(...componentTypes: symbol[]): Entity[] {
        const entityIds = new Set<number>();

        for (const type of componentTypes) {
            const index = this.componentIndices.get(type);
            if (index) {
                for (const id of index) {
                    entityIds.add(id);
                }
            }
        }

        // Sort by entity ID for deterministic ordering across all clients
        return Array.from(entityIds)
            .sort((a, b) => a - b)
            .map(id => this.entities.get(id))
            .filter((e): e is Entity => e !== undefined && !e.isDestroyed);
    }

    /**
     * Update component index when a component is added to an entity
     */
    public onComponentAdded(entity: Entity, componentType: symbol): void {
        this.componentIndices.get(componentType)?.add(entity.id);
    }

    /**
     * Update component index when a component is removed from an entity
     */
    public onComponentRemoved(entity: Entity, componentType: symbol): void {
        this.componentIndices.get(componentType)?.delete(entity.id);
    }

    /**
     * Remove destroyed entities
     */
    public cleanupDestroyed(): Entity[] {
        const destroyed: Entity[] = [];

        for (const entity of this.entities.values()) {
            if (entity.isDestroyed) {
                destroyed.push(entity);
            }
        }

        for (const entity of destroyed) {
            this.removeEntity(entity);
        }

        return destroyed;
    }

    /**
     * Get count of entities with a specific component
     */
    public countWithComponent(componentType: symbol): number {
        return this.componentIndices.get(componentType)?.size ?? 0;
    }

    /**
     * Get total entity count
     */
    public get count(): number {
        return this.entities.size;
    }

    /**
     * Clear all entities
     */
    public clear(): void {
        for (const entity of this.entities.values()) {
            entity.dispose();
        }
        this.entities.clear();

        for (const index of this.componentIndices.values()) {
            index.clear();
        }
    }
}

