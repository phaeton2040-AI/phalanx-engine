import { Mesh } from "@babylonjs/core";
import { Entity } from "../entities/Entity";
import { EntityManager } from "../core/EntityManager";
import { EventBus } from "../core/EventBus";
import { GameEvents, createEvent } from "../events";
import type {
    EntitySelectedEvent,
    EntityDeselectedEvent,
    SelectionClearedEvent,
    SelectEntityRequestedEvent,
    DeselectEntityRequestedEvent
} from "../events";

/**
 * Selectable entity interface for the selection system
 */
export interface ISelectableEntity {
    readonly id: number;
    readonly isSelected: boolean;
    select(): void;
    deselect(): void;
    canBeSelected(): boolean;
    getMesh(): Mesh | null;
}

/**
 * SelectionSystem - Manages entity selection using EntityManager
 * Follows Single Responsibility: Only handles selection logic
 * Uses EventBus for decoupled communication
 */
export class SelectionSystem {
    private entityManager: EntityManager;
    private eventBus: EventBus;
    private selectedIds: Set<number> = new Set();
    private unsubscribers: (() => void)[] = [];

    // Cache of selectable entities for mesh lookup
    private selectableCache: Map<Mesh, ISelectableEntity> = new Map();

    constructor(entityManager: EntityManager, eventBus: EventBus) {
        this.entityManager = entityManager;
        this.eventBus = eventBus;
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Listen for selection requests from other systems (e.g., InputManager)
        this.unsubscribers.push(
            this.eventBus.on<SelectEntityRequestedEvent>(GameEvents.SELECT_ENTITY_REQUESTED, (event) => {
                const entity = this.selectableCache.get(
                    this.findMeshByEntityId(event.entityId) as Mesh
                ) ?? this.findSelectableById(event.entityId);

                if (entity) {
                    if (event.exclusive) {
                        this.deselectAll();
                    }
                    this.selectEntity(entity);
                }
            })
        );

        this.unsubscribers.push(
            this.eventBus.on<DeselectEntityRequestedEvent>(GameEvents.DESELECT_ENTITY_REQUESTED, (event) => {
                const entity = this.findSelectableById(event.entityId);
                if (entity) {
                    this.deselectEntity(entity);
                }
            })
        );

        this.unsubscribers.push(
            this.eventBus.on(GameEvents.DESELECT_ALL_REQUESTED, () => {
                this.deselectAll();
            })
        );
    }

    private findSelectableById(entityId: number): ISelectableEntity | undefined {
        for (const selectable of this.selectableCache.values()) {
            if (selectable.id === entityId) {
                return selectable;
            }
        }
        return undefined;
    }

    private findMeshByEntityId(entityId: number): Mesh | undefined {
        for (const [mesh, selectable] of this.selectableCache) {
            if (selectable.id === entityId) {
                return mesh;
            }
        }
        return undefined;
    }

    /**
     * Register a selectable entity (builds mesh cache)
     */
    public registerSelectable(entity: ISelectableEntity): void {
        const mesh = entity.getMesh();
        if (mesh) {
            this.selectableCache.set(mesh, entity);
        }
    }

    /**
     * Unregister a selectable entity
     */
    public unregisterSelectable(entity: ISelectableEntity): void {
        const mesh = entity.getMesh();
        if (mesh) {
            this.selectableCache.delete(mesh);
        }
        this.selectedIds.delete(entity.id);
    }

    /**
     * Select an entity
     */
    public selectEntity(entity: ISelectableEntity): void {
        if (!entity.canBeSelected()) return;
        if (entity.isSelected) return;

        entity.select();
        this.selectedIds.add(entity.id);

        // Emit selection event
        this.eventBus.emit<EntitySelectedEvent>(GameEvents.ENTITY_SELECTED, {
            ...createEvent(),
            entityId: entity.id,
        });
    }

    /**
     * Deselect an entity
     */
    public deselectEntity(entity: ISelectableEntity): void {
        if (!entity.isSelected) return;

        entity.deselect();
        this.selectedIds.delete(entity.id);

        // Emit deselection event
        this.eventBus.emit<EntityDeselectedEvent>(GameEvents.ENTITY_DESELECTED, {
            ...createEvent(),
            entityId: entity.id,
        });
    }

    /**
     * Deselect all entities
     */
    public deselectAll(): void {
        const previouslySelectedIds = Array.from(this.selectedIds);

        for (const id of this.selectedIds) {
            const entity = this.entityManager.getEntity(id) as unknown as ISelectableEntity;
            if (entity && typeof entity.deselect === 'function') {
                entity.deselect();
            }
        }
        this.selectedIds.clear();

        // Emit selection cleared event
        if (previouslySelectedIds.length > 0) {
            this.eventBus.emit<SelectionClearedEvent>(GameEvents.SELECTION_CLEARED, {
                ...createEvent(),
                previouslySelectedIds,
            });
        }
    }

    /**
     * Toggle selection of an entity
     */
    public toggleSelection(entity: ISelectableEntity): void {
        if (!entity.canBeSelected()) return;

        if (entity.isSelected) {
            this.deselectEntity(entity);
        } else {
            this.selectEntity(entity);
        }
    }

    /**
     * Get all selected entity IDs
     */
    public getSelectedIds(): number[] {
        return Array.from(this.selectedIds);
    }

    /**
     * Get all selected entities
     */
    public getSelectedEntities(): Entity[] {
        return this.getSelectedIds()
            .map(id => this.entityManager.getEntity(id))
            .filter((e): e is Entity => e !== undefined);
    }

    /**
     * Check if there are any selected entities
     */
    public hasSelection(): boolean {
        return this.selectedIds.size > 0;
    }

    /**
     * Find selectable entity by mesh
     */
    public findSelectableByMesh(mesh: Mesh): ISelectableEntity | undefined {
        return this.selectableCache.get(mesh);
    }

    /**
     * Clean up references to destroyed entities
     */
    public cleanup(): void {
        const toRemove: number[] = [];

        for (const id of this.selectedIds) {
            const entity = this.entityManager.getEntity(id);
            if (!entity || entity.isDestroyed) {
                toRemove.push(id);
            }
        }

        for (const id of toRemove) {
            this.selectedIds.delete(id);
        }
    }

    /**
     * Dispose and unsubscribe from all events
     */
    public dispose(): void {
        for (const unsubscribe of this.unsubscribers) {
            unsubscribe();
        }
        this.unsubscribers = [];
        this.selectableCache.clear();
        this.selectedIds.clear();
    }
}

