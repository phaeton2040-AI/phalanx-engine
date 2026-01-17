import { Engine, Scene, Vector3, Color3 } from "@babylonjs/core";
import { SceneManager } from "./SceneManager";
import { EntityManager } from "./EntityManager";
import { EventBus } from "./EventBus";
import { LockstepManager } from "./LockstepManager";
import { EntityFactory } from "./EntityFactory";
import { UIManager } from "./UIManager";
import { InputManager } from "../systems/InputManager";
import { SelectionSystem } from "../systems/SelectionSystem";
import { MovementSystem } from "../systems/MovementSystem";
import { PhysicsSystem } from "../systems/PhysicsSystem";
import { HealthSystem } from "../systems/HealthSystem";
import { ProjectileSystem } from "../systems/ProjectileSystem";
import { CombatSystem } from "../systems/CombatSystem";
import { ResourceSystem } from "../systems/ResourceSystem";
import { TerritorySystem } from "../systems/TerritorySystem";
import { FormationGridSystem } from "../systems/FormationGridSystem";
import { VictorySystem } from "../systems/VictorySystem";
import { WaveSystem } from "../systems/WaveSystem";
import { CameraController } from "../systems/CameraController";
import { InterpolationSystem } from "../systems/InterpolationSystem";
import { resetEntityIdCounter } from "../entities/Entity";
import { TeamTag } from "../enums/TeamTag";
import { arenaParams } from "../config/constants";
import { GameEvents } from "../events";
import type { MoveRequestedEvent, GameOverEvent, AggressionBonusActivatedEvent, AggressionBonusDeactivatedEvent, WaveCountdownEvent, WaveStartedEvent, WaveDeploymentEvent } from "../events";
import type { PhalanxClient, MatchFoundEvent } from "phalanx-client";
import type { NetworkMoveCommand, NetworkPlaceUnitCommand } from "./NetworkCommands";

/**
 * Game - Main game class using component-based architecture
 * Supports networked 1v1 multiplayer via Phalanx Engine
 * 
 * This class acts as an orchestrator, delegating responsibilities to:
 * - LockstepManager: Deterministic simulation and network sync
 * - EntityFactory: Entity creation and registration
 * - UIManager: All UI interactions and updates
 * - Various Systems: Game logic (combat, movement, etc.)
 */
export class Game {
    private engine: Engine;
    private scene: Scene;
    private sceneManager: SceneManager;

    // Network
    private client: PhalanxClient;
    private matchData: MatchFoundEvent;
    private localTeam: TeamTag;

    // Core systems
    private eventBus: EventBus;
    private entityManager: EntityManager;
    private selectionSystem: SelectionSystem;
    private movementSystem: MovementSystem;
    private physicsSystem: PhysicsSystem;
    private healthSystem: HealthSystem;
    private projectileSystem: ProjectileSystem;
    private combatSystem: CombatSystem;
    private resourceSystem: ResourceSystem;
    private territorySystem: TerritorySystem;
    private formationGridSystem: FormationGridSystem;
    private victorySystem: VictorySystem;
    private waveSystem: WaveSystem;
    private interpolationSystem: InterpolationSystem;
    private cameraController!: CameraController;
    // @ts-ignore - InputManager registers event listeners in constructor
    private inputManager: InputManager;

    // Managers
    private lockstepManager: LockstepManager;
    private entityFactory: EntityFactory;
    private uiManager: UIManager;

    // Callbacks
    private onExit: (() => void) | null = null;

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
        this.physicsSystem = new PhysicsSystem(this.entityManager, this.eventBus);
        this.healthSystem = new HealthSystem(this.entityManager, this.eventBus);
        this.projectileSystem = new ProjectileSystem(this.scene, this.engine, this.entityManager, this.eventBus);
        this.combatSystem = new CombatSystem(this.engine, this.entityManager, this.eventBus);

        // Set up combat system move callback for lockstep synchronization
        this.combatSystem.setMoveUnitCallback((entityId, target) => {
            this.movementSystem.moveEntityTo(entityId, target);
        });

        // Initialize gameplay systems
        this.resourceSystem = new ResourceSystem(this.engine, this.entityManager, this.eventBus);
        this.territorySystem = new TerritorySystem(this.entityManager, this.eventBus);
        this.formationGridSystem = new FormationGridSystem(this.scene, this.entityManager, this.eventBus);
        this.victorySystem = new VictorySystem(this.entityManager, this.eventBus);
        this.waveSystem = new WaveSystem(this.eventBus);
        this.interpolationSystem = new InterpolationSystem(this.entityManager);

        this.inputManager = new InputManager(
            this.scene,
            this.eventBus,
            this.selectionSystem,
            this.sceneManager
        );

        // Initialize managers
        this.entityFactory = new EntityFactory(
            this.sceneManager,
            this.entityManager,
            this.selectionSystem,
            this.physicsSystem
        );
        // Wire up interpolation system to entity factory
        this.entityFactory.setInterpolationSystem(this.interpolationSystem);

        this.uiManager = new UIManager(
            this.resourceSystem,
            this.formationGridSystem,
            this.matchData.playerId
        );

        this.lockstepManager = new LockstepManager(
            this.client,
            {
                movementSystem: this.movementSystem,
                physicsSystem: this.physicsSystem,
                combatSystem: this.combatSystem,
                projectileSystem: this.projectileSystem,
                territorySystem: this.territorySystem,
                resourceSystem: this.resourceSystem,
                formationGridSystem: this.formationGridSystem,
                waveSystem: this.waveSystem,
                eventBus: this.eventBus,
            },
            {
                onCleanupNeeded: () => this.cleanupDestroyedEntities(),
                onNotification: (msg, type) => this.uiManager.showNotification(msg, type),
                onCommitButtonUpdate: () => this.uiManager.updateFormationInfo(),
                getLocalTeam: () => this.localTeam,
                getLocalPlayerId: () => this.matchData.playerId,
                // Interpolation callbacks for smooth visual movement
                onBeforeSimulationTick: () => this.interpolationSystem.snapshotPositions(),
                onAfterSimulationTick: () => this.interpolationSystem.captureCurrentPositions(),
            }
        );

        this.setupResizeHandler();
        this.setupNetworkEventHandlers();
        this.setupMoveCommandInterceptor();
        this.setupSelectionFilter();
        this.setupGameEventHandlers();
        this.uiManager.setupBeforeUnloadWarning();
        this.uiManager.setupExitButton(() => this.handleExit());
    }

    /**
     * Setup network event handlers (disconnect, reconnect, match end)
     */
    private setupNetworkEventHandlers(): void {
        this.client.on('playerDisconnected', (event) => {
            console.log(`Player ${event.playerId} disconnected`);
            this.uiManager.showNotification('Opponent disconnected', 'warning');
            setTimeout(() => {
                this.handleExit();
            }, 3000);
        });

        this.client.on('playerReconnected', (event) => {
            console.log(`Player ${event.playerId} reconnected`);
            this.uiManager.showNotification('Opponent reconnected', 'info');
        });

        this.client.on('matchEnd', (event) => {
            console.log(`Match ended: ${event.reason}`);
            this.uiManager.showNotification(`Match ended: ${event.reason}`, 'info');
            setTimeout(() => {
                this.handleExit();
            }, 2000);
        });
    }

    /**
     * Setup game event handlers (game over, territory, resources)
     */
    private setupGameEventHandlers(): void {
        // Game over
        this.eventBus.on<GameOverEvent>(GameEvents.GAME_OVER, (event) => {
            const isWinner = event.winnerTeam === this.localTeam;
            const message = isWinner ? '🎉 Victory!' : '💀 Defeat!';
            this.uiManager.showNotification(message, isWinner ? 'info' : 'warning');

            console.log(`[Game] Game Over! Winner: Team ${event.winnerTeam}, Reason: ${event.reason}`);

            setTimeout(() => {
                this.handleExit();
            }, 5000);
        });

        // Territory changes
        this.eventBus.on<AggressionBonusActivatedEvent>(GameEvents.AGGRESSION_BONUS_ACTIVATED, (event) => {
            if (event.team === this.localTeam) {
                this.uiManager.showTerritoryIndicator();
            }
        });

        this.eventBus.on<AggressionBonusDeactivatedEvent>(GameEvents.AGGRESSION_BONUS_DEACTIVATED, (event) => {
            if (event.team === this.localTeam) {
                this.uiManager.hideTerritoryIndicator();
            }
        });

        // Resource changes
        this.eventBus.on(GameEvents.RESOURCES_GENERATED, () => {
            this.uiManager.updateResourceUI();
        });

        this.eventBus.on(GameEvents.RESOURCES_CHANGED, () => {
            this.uiManager.updateResourceUI();
        });

        // Formation placement requests
        this.eventBus.on(GameEvents.FORMATION_PLACEMENT_REQUESTED, (event: any) => {
            if (event.playerId === this.matchData.playerId) {
                const command: NetworkPlaceUnitCommand = {
                    type: 'placeUnit',
                    data: {
                        unitType: event.unitType,
                        gridX: event.gridX,
                        gridZ: event.gridZ,
                    },
                };
                this.lockstepManager.queueCommand(command);
            }
        });

        // Formation changes (UI updates)
        this.eventBus.on(GameEvents.FORMATION_UNIT_PLACED, () => {
            this.uiManager.updateFormationInfo();
        });

        this.eventBus.on(GameEvents.FORMATION_UNIT_REMOVED, () => {
            this.uiManager.updateFormationInfo();
        });

        // Wave events (UI updates)
        this.eventBus.on<WaveCountdownEvent>(GameEvents.WAVE_COUNTDOWN, (event) => {
            this.uiManager.updateWaveTimer(
                event.waveNumber,
                event.secondsRemaining,
                event.waveNumber === 0
            );
        });

        this.eventBus.on<WaveStartedEvent>(GameEvents.WAVE_STARTED, (event) => {
            if (event.isPreparationWave) {
                this.uiManager.showNotification('Preparation phase - place your units!', 'info');
            } else {
                this.uiManager.showNotification(`Wave ${event.waveNumber} - Units deploying!`, 'info');
            }
        });

        this.eventBus.on<WaveDeploymentEvent>(GameEvents.WAVE_DEPLOYMENT, (event) => {
            if (event.totalUnitsDeployed > 0) {
                console.log(`[Game] Wave ${event.waveNumber}: Deployed ${event.totalUnitsDeployed} total units`);
            }
        });
    }

    /**
     * Set callback for exit
     */
    public setOnExit(callback: () => void): void {
        this.onExit = callback;
    }

    /**
     * Handle exit
     */
    private handleExit(): void {
        this.uiManager.removeBeforeUnloadWarning();
        this.client.disconnect();
        this.onExit?.();
    }

    /**
     * Setup interceptor for local move commands to send over network
     */
    private setupMoveCommandInterceptor(): void {
        this.eventBus.on<MoveRequestedEvent>(GameEvents.MOVE_REQUESTED, (event) => {
            if ((event as any)._fromNetwork) return;

            const entity = this.entityManager.getEntity(event.entityId);
            if (!entity) return;

            if (this.entityFactory.isOwnedBy(event.entityId, this.matchData.playerId)) {
                const command: NetworkMoveCommand = {
                    type: 'move',
                    data: {
                        entityId: event.entityId,
                        targetX: event.target.x,
                        targetY: event.target.y,
                        targetZ: event.target.z,
                    },
                };
                this.lockstepManager.queueCommand(command);
            }
        });
    }

    /**
     * Setup selection filter
     */
    private setupSelectionFilter(): void {
        const originalSelectEntity = this.selectionSystem.selectEntity.bind(this.selectionSystem);

        this.selectionSystem.selectEntity = (entity: import("../systems/SelectionSystem").ISelectableEntity) => {
            console.log(`[Selection] Selecting entity ${entity.id} for info view`);
            originalSelectEntity(entity);
        };
    }

    /**
     * Initialize the game world
     */
    public async initialize(): Promise<void> {
        // Reset entity ID counter to ensure deterministic IDs across all clients
        resetEntityIdCounter();

        // Initialize RTS-style camera controller for the local player
        this.cameraController = new CameraController(this.scene, this.localTeam);

        this.sceneManager.setupLighting();
        this.sceneManager.createGround();

        // Update UI
        const color = this.localTeam === TeamTag.Team1 ? '#3366cc' : '#cc3333';
        this.uiManager.updatePlayerInfoUI(color, this.client.getUsername());
        this.uiManager.resetTerritoryIndicator();

        // Create entities
        this.createPlayerEntities();

        // Initialize gameplay systems
        this.initializeGameplaySystems();

        // Setup unit placement UI
        this.setupUnitPlacementUI();
    }

    /**
     * Initialize gameplay systems
     */
    private initializeGameplaySystems(): void {
        const opponentId = this.getOpponentId();

        let team1PlayerId: string;
        let team2PlayerId: string;

        if (this.localTeam === TeamTag.Team1) {
            team1PlayerId = this.matchData.playerId;
            team2PlayerId = opponentId;
        } else {
            team1PlayerId = opponentId;
            team2PlayerId = this.matchData.playerId;
        }

        // Initialize systems for both players
        this.resourceSystem.initializePlayer(team1PlayerId, TeamTag.Team1);
        this.resourceSystem.initializePlayer(team2PlayerId, TeamTag.Team2);

        this.formationGridSystem.initializeGrid(team1PlayerId, TeamTag.Team1);
        this.formationGridSystem.initializeGrid(team2PlayerId, TeamTag.Team2);

        // Set up callbacks for FormationGridSystem
        this.formationGridSystem.setCreateUnitCallback((unitType, team, position) => {
            return this.entityFactory.createUnitForFormation(
                unitType,
                team,
                position,
                this.matchData.playerId,
                this.localTeam,
                () => this.getOpponentId()
            );
        });

        this.formationGridSystem.setMoveUnitCallback((entityId, target) => {
            this.movementSystem.moveEntityTo(entityId, target);
        });

        // Set up affordability check callback
        this.formationGridSystem.setCanAffordCallback((playerId, unitType) => {
            return this.resourceSystem.canAfford(playerId, unitType);
        });

        // Register players in victory system
        this.victorySystem.registerPlayer(team1PlayerId, TeamTag.Team1);
        this.victorySystem.registerPlayer(team2PlayerId, TeamTag.Team2);

        // Initialize wave system
        this.waveSystem.registerPlayer(team1PlayerId);
        this.waveSystem.registerPlayer(team2PlayerId);
        
        // Set up wave deployment callback
        this.waveSystem.setDeployUnitsCallback((playerId) => {
            return this.formationGridSystem.commitFormation(playerId);
        });

        // Start the wave system (Wave 0 - preparation phase)
        this.waveSystem.start(0);

        // Initial UI update
        setTimeout(() => {
            this.uiManager.updateResourceUI();
            this.uiManager.updateFormationInfo();
        }, 100);

        console.log(`[Game] Gameplay systems initialized for players: ${team1PlayerId} (Team1), ${team2PlayerId} (Team2)`);
    }

    /**
     * Create entities for both players
     */
    private createPlayerEntities(): void {
        const team1Color = new Color3(0.2, 0.4, 0.8);
        const team2Color = new Color3(0.8, 0.2, 0.2);

        const opponentId = this.getOpponentId();

        let team1OwnerId: string;
        let team2OwnerId: string;

        if (this.localTeam === TeamTag.Team1) {
            team1OwnerId = this.matchData.playerId;
            team2OwnerId = opponentId;
        } else {
            team1OwnerId = opponentId;
            team2OwnerId = this.matchData.playerId;
        }

        console.log(`[Setup] Team 1 owner: ${team1OwnerId}, Team 2 owner: ${team2OwnerId}`);

        // Create Team 1 entities
        const team1Base = this.entityFactory.createBase({
            color: team1Color,
            team: TeamTag.Team1,
            debug: false,
        }, new Vector3(arenaParams.teamA.base.x, 0, arenaParams.teamA.base.z));
        this.entityFactory.setOwnership(team1Base.id, team1OwnerId);
        this.victorySystem.registerBase(team1Base.id, TeamTag.Team1);

        for (const towerPos of arenaParams.teamA.towers) {
            const tower = this.entityFactory.createTower({
                color: team1Color,
                team: TeamTag.Team1,
                debug: false,
            }, new Vector3(towerPos.x, 0, towerPos.z));
            this.entityFactory.setOwnership(tower.id, team1OwnerId);
            this.victorySystem.registerTower(tower.id, TeamTag.Team1);
        }

        // Create Team 2 entities
        const team2Base = this.entityFactory.createBase({
            color: team2Color,
            team: TeamTag.Team2,
            debug: false,
        }, new Vector3(arenaParams.teamB.base.x, 0, arenaParams.teamB.base.z));
        this.entityFactory.setOwnership(team2Base.id, team2OwnerId);
        this.victorySystem.registerBase(team2Base.id, TeamTag.Team2);

        for (const towerPos of arenaParams.teamB.towers) {
            const tower = this.entityFactory.createTower({
                color: team2Color,
                team: TeamTag.Team2,
                debug: false,
            }, new Vector3(towerPos.x, 0, towerPos.z));
            this.entityFactory.setOwnership(tower.id, team2OwnerId);
            this.victorySystem.registerTower(tower.id, TeamTag.Team2);
        }

        console.log(`[Setup] Entity ownership map:`, this.entityFactory.getOwnershipMap());
    }

    /**
     * Get opponent player ID
     */
    private getOpponentId(): string {
        return this.matchData.opponents[0]?.playerId
            ?? this.matchData.teammates[0]?.playerId
            ?? 'unknown-opponent';
    }

    /**
     * Setup unit placement UI
     * Note: Deployment is now automatic via wave system
     */
    private setupUnitPlacementUI(): void {
        this.uiManager.setupUnitPlacementButtons(
            () => this.handleUnitButtonClick('sphere'),
            () => this.handleUnitButtonClick('prisma')
        );
    }

    /**
     * Handle unit button click
     */
    private handleUnitButtonClick(unitType: 'sphere' | 'prisma'): void {
        if (!this.resourceSystem.canAfford(this.matchData.playerId, unitType)) {
            this.uiManager.showNotification('Not enough resources!', 'warning');
            return;
        }

        this.uiManager.setActiveUnitButton(unitType);
        this.formationGridSystem.enterPlacementMode(this.matchData.playerId, unitType);
    }

    /**
     * Start the game loop
     */
    public start(): void {
        this.engine.runRenderLoop(() => {
            this.renderUpdate();
            this.scene.render();
        });
    }

    /**
     * Render update loop
     */
    private renderUpdate(): void {
        this.lockstepManager.sendPendingCommands();
        this.resourceSystem.update(0);

        // Interpolate visual positions for smooth movement between network ticks
        const alpha = this.lockstepManager.getInterpolationAlpha();
        this.interpolationSystem.interpolate(alpha);
    }

    /**
     * Remove destroyed entities from all systems
     */
    private cleanupDestroyedEntities(): void {
        const destroyed = this.entityManager.cleanupDestroyed();

        for (const entity of destroyed) {
            this.entityFactory.removeOwnership(entity.id);
            this.physicsSystem.unregisterBody(entity.id);
            this.interpolationSystem.unregisterEntity(entity.id);

            if (typeof (entity as any).canBeSelected === 'function') {
                this.selectionSystem.unregisterSelectable(entity as any);
            }

            entity.dispose();
        }

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
        this.uiManager.dispose();

        // Dispose all systems
        this.cameraController.dispose();
        this.inputManager.dispose();
        this.projectileSystem.dispose();
        this.combatSystem.dispose();
        this.healthSystem.dispose();
        this.physicsSystem.dispose();
        this.movementSystem.dispose();
        this.selectionSystem.dispose();
        this.sceneManager.dispose();
        this.resourceSystem.dispose();
        this.territorySystem.dispose();
        this.formationGridSystem.dispose();
        this.victorySystem.dispose();
        this.waveSystem.dispose();
        this.interpolationSystem.dispose();

        // Clear managers and entity data
        this.eventBus.clearAll();
        this.entityManager.clear();
        this.entityFactory.clear();

        // Dispose engine
        this.engine.dispose();
    }
}
