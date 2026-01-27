import {
  Scene,
  PointerEventTypes,
  PointerInfo,
  PickingInfo,
} from '@babylonjs/core';
import { EventBus } from '../core/EventBus';
import type { SelectionSystem } from './SelectionSystem';
import type { SceneManager } from '../core/SceneManager';
import { GameEvents, createEvent } from '../events';
import type { MoveCompletedEvent, HideDestinationMarkerEvent } from '../events';

/**
 * InputManager - Handles all user input
 * Uses EventBus for decoupled command issuing
 */
export class InputManager {
  private scene: Scene;
  private eventBus: EventBus;
  private selectionSystem: SelectionSystem;
  private sceneManager: SceneManager;
  private unsubscribers: (() => void)[] = [];

  // Track entities that are moving to hide marker when all complete
  private movingEntities: Set<number> = new Set();

  constructor(
    scene: Scene,
    eventBus: EventBus,
    selectionSystem: SelectionSystem,
    sceneManager: SceneManager
  ) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.selectionSystem = selectionSystem;
    this.sceneManager = sceneManager;

    this.setupPointerObserver();
    this.setupEventListeners();
  }

  private setupPointerObserver(): void {
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        this.handlePointerDown(pointerInfo);
      }
    });
  }

  private setupEventListeners(): void {
    // Listen for move completed to potentially hide destination marker
    this.unsubscribers.push(
      this.eventBus.on<MoveCompletedEvent>(
        GameEvents.MOVE_COMPLETED,
        (event) => {
          this.movingEntities.delete(event.entityId);
          if (this.movingEntities.size === 0) {
            // Emit hide destination marker event
            this.eventBus.emit<HideDestinationMarkerEvent>(
              GameEvents.HIDE_DESTINATION_MARKER,
              {
                ...createEvent(),
              }
            );
          }
        }
      )
    );
  }

  private handlePointerDown(pointerInfo: PointerInfo): void {
    const evt = pointerInfo.event as PointerEvent;
    const pickResult = pointerInfo.pickInfo;

    if (!pickResult?.hit) return;

    switch (evt.button) {
      case 0: // Left click - Selection
        this.handleLeftClick(pickResult);
        break;
    }
  }

  private handleLeftClick(pickResult: PickingInfo): void {
    const pickedMesh = pickResult.pickedMesh;
    const ground = this.sceneManager.getGround();

    // Check if we clicked on a selectable entity
    const selectable = this.selectionSystem.findSelectableByMesh(pickedMesh);

    if (selectable) {
      if (selectable.isSelected) {
        // Clicking on already selected entity - deselect it
        this.selectionSystem.deselectEntity(selectable);
      } else {
        // Clicking on a new entity - deselect all others first, then select this one
        this.selectionSystem.deselectAll();
        this.selectionSystem.selectEntity(selectable);
      }
    } else if (pickedMesh === ground) {
      // Clicked on empty ground - deselect all
      this.selectionSystem.deselectAll();
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
    this.movingEntities.clear();
  }
}
