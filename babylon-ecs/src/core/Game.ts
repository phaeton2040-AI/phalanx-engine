import { Engine, Scene, Vector3, Color3 } from "@babylonjs/core";
import { SceneManager } from "./SceneManager";
import { EntityManager } from "./EntityManager";
import { EventBus } from "./EventBus";
import { InputManager } from "../systems/InputManager";
import { SelectionSystem } from "../systems/SelectionSystem";
import { MovementSystem } from "../systems/MovementSystem";
import { HealthSystem } from "../systems/HealthSystem";
import { ProjectileSystem } from "../systems/ProjectileSystem";
import { CombatSystem } from "../systems/CombatSystem";
import type { Unit } from "../entities/Unit";
import type { Tower } from "../entities/Tower";
import { TeamTag } from "../enums/TeamTag";

/**
 * Game - Main game class using component-based architecture
 * Uses EntityManager for centralized entity management
 * Uses EventBus for decoupled system communication
 */
export class Game {
    private engine: Engine;
    private scene: Scene;
    private sceneManager: SceneManager;

    // Core systems
    private eventBus: EventBus;
    private entityManager: EntityManager;
    private selectionSystem: SelectionSystem;
    private movementSystem: MovementSystem;
    private healthSystem: HealthSystem;
    private projectileSystem: ProjectileSystem;
    private combatSystem: CombatSystem;
    // @ts-ignore - InputManager registers event listeners in constructor
    private inputManager: InputManager;

    constructor(canvas: HTMLCanvasElement) {
        // Prevent context menu on right-click
        canvas.oncontextmenu = (e) => {
            e.preventDefault();
            return false;
        };

        this.engine = new Engine(canvas, true);
        this.scene = new Scene(this.engine);

        // Initialize EventBus first (no dependencies)
        this.eventBus = new EventBus();

        // Initialize EntityManager
        this.entityManager = new EntityManager();

        // Initialize scene manager (with EventBus for destination marker events)
        this.sceneManager = new SceneManager(this.scene, this.eventBus);

        // Initialize systems with EventBus for decoupled communication
        // Systems no longer depend on each other, only on EventBus
        this.selectionSystem = new SelectionSystem(this.entityManager, this.eventBus);
        this.movementSystem = new MovementSystem(this.engine, this.entityManager, this.eventBus);
        this.healthSystem = new HealthSystem(this.entityManager, this.eventBus);
        this.projectileSystem = new ProjectileSystem(this.scene, this.engine, this.entityManager, this.eventBus);
        this.combatSystem = new CombatSystem(this.engine, this.entityManager, this.eventBus);

        this.inputManager = new InputManager(
            this.scene,
            this.eventBus,
            this.selectionSystem,
            this.sceneManager
        );

        this.setupResizeHandler();
    }

    /**
     * Initialize the game world
     */
    public async initialize(): Promise<void> {
        this.sceneManager.setupCamera();
        this.sceneManager.setupLighting();
        this.sceneManager.createGround();

        // Create player units (Team1 - Blue)
        this.createUnit({
            color: new Color3(0.2, 0.4, 0.8),
            team: TeamTag.Team1,
            debug: false,
        }, new Vector3(-5, 1, 0));

        this.createUnit({
            color: new Color3(0.2, 0.4, 0.8),
            team: TeamTag.Team1,
            debug: false,
        }, new Vector3(-7, 1, 2));

        this.createUnit({
            color: new Color3(0.2, 0.4, 0.8),
            team: TeamTag.Team1,
            debug: false,
        }, new Vector3(-7, 1, -2));

        // Create player tower (Team1 - Blue)
        this.createTower({
            color: new Color3(0.2, 0.6, 0.9),
            team: TeamTag.Team1,
            debug: false,
        }, new Vector3(-10, 0, 0));

        // Create enemy units (Team2 - Red)
        this.createUnit({
            color: new Color3(0.8, 0.2, 0.2),
            team: TeamTag.Team2,
            debug: false,
        }, new Vector3(5, 1, 0));

        this.createUnit({
            color: new Color3(0.8, 0.2, 0.2),
            team: TeamTag.Team2,
            debug: false,
        }, new Vector3(7, 1, 2));

        // Create enemy towers (Team2 - Red)
        this.createTower({
            color: new Color3(0.9, 0.3, 0.2),
            team: TeamTag.Team2,
            debug: false,
        }, new Vector3(10, 0, 0));

        this.createTower({
            color: new Color3(0.9, 0.3, 0.2),
            team: TeamTag.Team2,
            debug: false,
        }, new Vector3(10, 0, 5));
    }

    private createUnit(config: import("../entities/Unit").UnitConfig, position: Vector3): Unit {
        const unit = this.sceneManager.createUnit(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(unit);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(unit);

        return unit;
    }

    private createTower(config: import("../entities/Tower").TowerConfig, position: Vector3): Tower {
        const tower = this.sceneManager.createTower(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(tower);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(tower);

        return tower;
    }

    /**
     * Start the game loop
     */
    public start(): void {
        this.engine.runRenderLoop(() => {
            this.update();
            this.scene.render();
        });
    }

    /**
     * Main update loop - called every frame
     */
    private update(): void {
        // Update all systems
        this.movementSystem.update();
        this.combatSystem.update();
        this.projectileSystem.update();

        // Cleanup destroyed entities
        this.cleanupDestroyedEntities();
    }

    /**
     * Remove destroyed entities from all systems
     */
    private cleanupDestroyedEntities(): void {
        const destroyed = this.entityManager.cleanupDestroyed();

        for (const entity of destroyed) {
            // Unregister from selection system
            if (typeof (entity as any).canBeSelected === 'function') {
                this.selectionSystem.unregisterSelectable(entity as any);
            }

            // Dispose the entity
            entity.dispose();
        }

        // Cleanup stale references in selection system
        this.selectionSystem.cleanup();
    }

    private setupResizeHandler(): void {
        window.addEventListener("resize", () => {
            this.engine.resize();
        });
    }

    /**
     * Cleanup resources
     */
    public dispose(): void {
        // Dispose all systems (unsubscribe from events)
        this.inputManager.dispose();
        this.projectileSystem.dispose();
        this.combatSystem.dispose();
        this.healthSystem.dispose();
        this.movementSystem.dispose();
        this.selectionSystem.dispose();
        this.sceneManager.dispose();

        // Clear event bus and entity manager
        this.eventBus.clearAll();
        this.entityManager.clear();

        // Dispose engine
        this.engine.dispose();
    }
}
