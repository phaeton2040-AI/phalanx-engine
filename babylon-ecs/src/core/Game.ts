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
import { resetEntityIdCounter } from "../entities/Entity";
import { TeamTag } from "../enums/TeamTag";
import { TEAM1_SPAWN, TEAM2_SPAWN } from "../config/constants";
import { GameEvents } from "../events";
import type { MoveRequestedEvent } from "../events";
import type { PhalanxClient, MatchFoundEvent, CommandsBatchEvent, PlayerCommand } from "phalanx-client";

/**
 * Network command types for movement
 */
interface MoveCommandData {
    entityId: number;
    targetX: number;
    targetY: number;
    targetZ: number;
}

interface NetworkMoveCommand extends PlayerCommand {
    type: 'move';
    data: MoveCommandData;
}

/**
 * Game - Main game class using component-based architecture
 * Supports networked 1v1 multiplayer via Phalanx Engine
 */
export class Game {
    private engine: Engine;
    private scene: Scene;
    private sceneManager: SceneManager;

    // Network
    private client: PhalanxClient;
    private matchData: MatchFoundEvent;
    private localTeam: TeamTag;
    private beforeUnloadHandler: ((e: BeforeUnloadEvent) => string | undefined) | null = null;

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

    // Pending commands to be sent
    private pendingCommands: NetworkMoveCommand[] = [];

    // Callbacks
    private onExit: (() => void) | null = null;
    private notificationTimeout: number | null = null;

    // Map entity IDs to player info
    private entityOwnership: Map<number, string> = new Map();

    constructor(canvas: HTMLCanvasElement, client: PhalanxClient, matchData: MatchFoundEvent) {
        // Prevent context menu on right-click
        canvas.oncontextmenu = (e) => {
            e.preventDefault();
            return false;
        };

        this.client = client;
        this.matchData = matchData;

        // Determine local team based on teamId from match data
        this.localTeam = matchData.teamId === 1 ? TeamTag.Team1 : TeamTag.Team2;

        this.engine = new Engine(canvas, true);
        this.scene = new Scene(this.engine);

        // Initialize EventBus first (no dependencies)
        this.eventBus = new EventBus();

        // Initialize EntityManager
        this.entityManager = new EntityManager();

        // Initialize scene manager (with EventBus for destination marker events)
        this.sceneManager = new SceneManager(this.scene, this.eventBus);

        // Initialize systems with EventBus for decoupled communication
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
        this.setupNetworkHandlers();
        this.setupMoveCommandInterceptor();
        this.setupSelectionFilter();
        this.setupBeforeUnloadWarning();
        this.setupExitButton();
    }

    /**
     * Set callback for exit
     */
    public setOnExit(callback: () => void): void {
        this.onExit = callback;
    }

    /**
     * Setup network event handlers
     */
    private setupNetworkHandlers(): void {
        // Handle incoming commands from server
        this.client.on('commands', (event: CommandsBatchEvent) => {
            console.log(`[Network] Received ${event.commands.length} commands at tick ${event.tick}`, event.commands);
            this.processNetworkCommands(event.commands);
        });

        // Handle player disconnect
        this.client.on('playerDisconnected', (event) => {
            console.log(`Player ${event.playerId} disconnected`);
            this.showNotification('Opponent disconnected', 'warning');
            setTimeout(() => {
                this.handleExit();
            }, 3000);
        });

        // Handle player reconnect
        this.client.on('playerReconnected', (event) => {
            console.log(`Player ${event.playerId} reconnected`);
            this.showNotification('Opponent reconnected', 'info');
        });

        // Handle match end
        this.client.on('matchEnd', (event) => {
            console.log(`Match ended: ${event.reason}`);
            this.showNotification(`Match ended: ${event.reason}`, 'info');
            setTimeout(() => {
                this.handleExit();
            }, 2000);
        });
    }

    /**
     * Setup interceptor for local move commands to send over network
     * In networked mode, we intercept local commands and send them to server
     * The server will broadcast them back and we'll execute from processNetworkCommands
     */
    private setupMoveCommandInterceptor(): void {
        // Track which commands we've already executed locally to avoid duplicates
        // This uses a simple approach: only send to server, don't execute locally
        // All execution happens when commands come back from server

        // We need to intercept BEFORE MovementSystem processes the command
        // Since EventBus doesn't support priorities, we'll use a flag system
        this.eventBus.on<MoveRequestedEvent>(GameEvents.MOVE_REQUESTED, (event) => {
            const entity = this.entityManager.getEntity(event.entityId);
            if (!entity) return;

            // Check if this entity belongs to the local player
            const ownerId = this.entityOwnership.get(event.entityId);
            if (ownerId === this.matchData.playerId) {
                // Queue command to be sent to server
                const command: NetworkMoveCommand = {
                    type: 'move',
                    data: {
                        entityId: event.entityId,
                        targetX: event.target.x,
                        targetY: event.target.y,
                        targetZ: event.target.z,
                    },
                };
                this.pendingCommands.push(command);
            }
        });
    }

    /**
     * Setup selection filter to only allow selecting own units
     */
    private setupSelectionFilter(): void {
        // Override the SelectionSystem's selectEntity to filter by ownership
        const originalSelectEntity = this.selectionSystem.selectEntity.bind(this.selectionSystem);

        this.selectionSystem.selectEntity = (entity: import("../systems/SelectionSystem").ISelectableEntity) => {
            // Only allow selection of entities owned by the local player
            const ownerId = this.entityOwnership.get(entity.id);
            console.log(`[Selection] Trying to select entity ${entity.id}, owner: ${ownerId}, localPlayer: ${this.matchData.playerId}, match: ${ownerId === this.matchData.playerId}`);
            console.log(`[Selection] Entity canBeSelected: ${entity.canBeSelected()}, isSelected: ${entity.isSelected}`);

            if (ownerId !== this.matchData.playerId) {
                console.log(`[Selection] BLOCKED - entity ${entity.id} belongs to opponent`);
                return; // Don't select enemy units
            }
            console.log(`[Selection] ALLOWED - calling originalSelectEntity for entity ${entity.id}`);
            originalSelectEntity(entity);
            console.log(`[Selection] After originalSelectEntity - entity.isSelected: ${entity.isSelected}`);
        };
    }

    /**
     * Process commands received from the server
     */
    private processNetworkCommands(commands: PlayerCommand[]): void {
        for (const cmd of commands) {
            if (cmd.type === 'move') {
                const moveCmd = cmd as NetworkMoveCommand;
                const data = moveCmd.data;

                // Check entity ownership - only process commands for opponent's entities
                // Local player's commands are already executed via InputManager -> MovementSystem
                const ownerId = this.entityOwnership.get(data.entityId);
                console.log(`[Network] Move command for entity ${data.entityId}, owner: ${ownerId}, localPlayer: ${this.matchData.playerId}`);

                if (ownerId !== this.matchData.playerId) {
                    console.log(`[Network] Executing move command for opponent's entity ${data.entityId} to (${data.targetX}, ${data.targetY}, ${data.targetZ})`);
                    // Execute the move command for opponent's units
                    const success = this.movementSystem.moveEntityTo(
                        data.entityId,
                        new Vector3(data.targetX, data.targetY, data.targetZ)
                    );
                    console.log(`[Network] Move command result: ${success}`);
                } else {
                    console.log(`[Network] Skipping move command for own entity ${data.entityId} (already executed locally)`);
                }
            }
        }
    }

    /**
     * Initialize the game world
     */
    public async initialize(): Promise<void> {
        // Reset entity ID counter to ensure deterministic IDs across all clients
        resetEntityIdCounter();

        this.sceneManager.setupCamera();
        this.sceneManager.setupLighting();
        this.sceneManager.createGround();

        // Update UI with player info
        this.updatePlayerInfoUI();

        // Create entities for both players
        this.createPlayerEntities();
    }

    /**
     * Update player info UI
     */
    private updatePlayerInfoUI(): void {
        const colorIndicator = document.getElementById('player-color-indicator');
        const playerName = document.getElementById('player-name');

        const color = this.localTeam === TeamTag.Team1 ? '#3366cc' : '#cc3333';

        if (colorIndicator) {
            colorIndicator.style.backgroundColor = color;
        }

        if (playerName) {
            playerName.textContent = `You: ${this.client.getUsername()}`;
        }
    }

    /**
     * Create entities for both players
     * Uses deterministic IDs so both clients have matching entity IDs
     * Team 1: tower=1, units=2,3,4
     * Team 2: tower=5, units=6,7,8
     */
    private createPlayerEntities(): void {
        // Always create Team 1 entities first, then Team 2
        // This ensures deterministic entity IDs on both clients

        const team1Color = new Color3(0.2, 0.4, 0.8); // Blue
        const team2Color = new Color3(0.8, 0.2, 0.2); // Red

        // Debug: Log the full match data to understand structure
        console.log(`[Setup] Full matchData:`, JSON.stringify(this.matchData, null, 2));
        console.log(`[Setup] Local team: ${this.localTeam} (teamId: ${this.matchData.teamId})`);
        console.log(`[Setup] Local playerId: ${this.matchData.playerId}`);
        console.log(`[Setup] Opponents:`, this.matchData.opponents);
        console.log(`[Setup] Teammates:`, this.matchData.teammates);

        // Get opponent player ID - check both opponents and teammates arrays
        const opponentId = this.matchData.opponents[0]?.playerId
            ?? this.matchData.teammates[0]?.playerId
            ?? 'unknown-opponent';

        // Determine which player owns which team based on localTeam
        // Team 1 (Blue) is always on the left side (TEAM1_SPAWN)
        // Team 2 (Red) is always on the right side (TEAM2_SPAWN)
        let team1OwnerId: string;
        let team2OwnerId: string;

        if (this.localTeam === TeamTag.Team1) {
            // Local player is Team 1 (Blue)
            team1OwnerId = this.matchData.playerId;
            team2OwnerId = opponentId;
        } else {
            // Local player is Team 2 (Red)
            team1OwnerId = opponentId;
            team2OwnerId = this.matchData.playerId;
        }

        console.log(`[Setup] Team 1 owner: ${team1OwnerId}`);
        console.log(`[Setup] Team 2 owner: ${team2OwnerId}`);
        console.log(`[Setup] Local player ${this.matchData.playerId} owns team ${this.localTeam}`);

        // Create Team 1 entities (IDs will be 1, 2, 3, 4)
        const team1Tower = this.createTower({
            color: team1Color,
            team: TeamTag.Team1,
            debug: false,
        }, new Vector3(TEAM1_SPAWN.tower.x, 0, TEAM1_SPAWN.tower.z));
        this.entityOwnership.set(team1Tower.id, team1OwnerId);
        console.log(`[Setup] Created Team 1 Tower with ID ${team1Tower.id}, owner: ${team1OwnerId}`);

        for (const unitPos of TEAM1_SPAWN.units) {
            const unit = this.createUnit({
                color: team1Color,
                team: TeamTag.Team1,
                debug: false,
            }, new Vector3(unitPos.x, 1, unitPos.z));
            this.entityOwnership.set(unit.id, team1OwnerId);
            console.log(`[Setup] Created Team 1 Unit with ID ${unit.id}, owner: ${team1OwnerId}`);
        }

        // Create Team 2 entities (IDs will be 5, 6, 7, 8)
        const team2Tower = this.createTower({
            color: team2Color,
            team: TeamTag.Team2,
            debug: false,
        }, new Vector3(TEAM2_SPAWN.tower.x, 0, TEAM2_SPAWN.tower.z));
        this.entityOwnership.set(team2Tower.id, team2OwnerId);
        console.log(`[Setup] Created Team 2 Tower with ID ${team2Tower.id}, owner: ${team2OwnerId}`);

        for (const unitPos of TEAM2_SPAWN.units) {
            const unit = this.createUnit({
                color: team2Color,
                team: TeamTag.Team2,
                debug: false,
            }, new Vector3(unitPos.x, 1, unitPos.z));
            this.entityOwnership.set(unit.id, team2OwnerId);
            console.log(`[Setup] Created Team 2 Unit with ID ${unit.id}, owner: ${team2OwnerId}`);
        }

        // Log final ownership map
        console.log(`[Setup] Entity ownership map:`);
        this.entityOwnership.forEach((owner, entityId) => {
            const isLocal = owner === this.matchData.playerId;
            console.log(`  Entity ${entityId} -> ${owner} ${isLocal ? '(LOCAL)' : '(OPPONENT)'}`);
        });
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
        // Send pending commands to server
        if (this.pendingCommands.length > 0) {
            const tick = this.client.getCurrentTick();
            console.log(`[Network] Sending ${this.pendingCommands.length} commands at tick ${tick}:`, JSON.stringify(this.pendingCommands));
            this.client.submitCommandsAsync(tick, this.pendingCommands);
            this.pendingCommands = [];
        }

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
            // Remove from ownership tracking
            this.entityOwnership.delete(entity.id);

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
     * Setup exit button handler
     */
    private setupExitButton(): void {
        const exitBtn = document.getElementById('exit-btn');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                this.handleExit();
            });
        }
    }

    /**
     * Handle exit button click
     */
    private handleExit(): void {
        this.removeBeforeUnloadWarning();
        this.client.disconnect();
        this.onExit?.();
    }

    /**
     * Setup warning when user tries to reload/close the page during game
     */
    private setupBeforeUnloadWarning(): void {
        this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
            const message = 'You will be kicked out of the game!';
            e.preventDefault();
            e.returnValue = message;
            return message;
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }

    /**
     * Remove beforeunload warning (when exiting properly)
     */
    private removeBeforeUnloadWarning(): void {
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
            this.beforeUnloadHandler = null;
        }
    }

    /**
     * Show a notification message
     */
    private showNotification(message: string, type: 'info' | 'warning' = 'info'): void {
        const notification = document.getElementById('notification');
        if (!notification) return;

        // Clear existing timeout
        if (this.notificationTimeout !== null) {
            clearTimeout(this.notificationTimeout);
        }

        notification.textContent = message;
        notification.className = `show ${type}`;

        // Auto-hide after 3 seconds
        this.notificationTimeout = window.setTimeout(() => {
            this.hideNotification();
        }, 3000);
    }

    /**
     * Hide the notification
     */
    private hideNotification(): void {
        const notification = document.getElementById('notification');
        if (notification) {
            notification.className = '';
        }
        this.notificationTimeout = null;
    }

    /**
     * Cleanup resources
     */
    public dispose(): void {
        this.removeBeforeUnloadWarning();

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
        this.entityOwnership.clear();

        // Dispose engine
        this.engine.dispose();
    }
}
