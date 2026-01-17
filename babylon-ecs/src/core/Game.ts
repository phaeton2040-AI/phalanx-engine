import { Engine, Scene, Vector3, Color3 } from "@babylonjs/core";
import { SceneManager } from "./SceneManager";
import { EntityManager } from "./EntityManager";
import { EventBus } from "./EventBus";
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
import { CameraController } from "../systems/CameraController";
import type { Unit } from "../entities/Unit";
import type { Tower } from "../entities/Tower";
import type { Base } from "../entities/Base";
import { resetEntityIdCounter } from "../entities/Entity";
import { TeamTag } from "../enums/TeamTag";
import { arenaParams, unitConfig, networkConfig } from "../config/constants";
import { GameEvents, createEvent } from "../events";
import type { MoveRequestedEvent, GameOverEvent, AggressionBonusActivatedEvent, AggressionBonusDeactivatedEvent } from "../events";
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
 * Network command types for unit placement
 */
interface PlaceUnitCommandData {
    unitType: 'sphere' | 'prisma';
    gridX: number;
    gridZ: number;
}

interface NetworkPlaceUnitCommand extends PlayerCommand {
    type: 'placeUnit';
    data: PlaceUnitCommandData;
}

/**
 * Network command types for deployment
 */
interface DeployUnitsCommandData {
    playerId: string;
}

interface NetworkDeployUnitsCommand extends PlayerCommand {
    type: 'deployUnits';
    data: DeployUnitsCommandData;
}

type NetworkCommand = NetworkMoveCommand | NetworkPlaceUnitCommand | NetworkDeployUnitsCommand;

/**
 * Game - Main game class using component-based architecture
 * Supports networked 1v1 multiplayer via Phalanx Engine
 * 
 * Uses LOCKSTEP SYNCHRONIZATION for deterministic gameplay:
 * - All game commands are sent to the server
 * - Server broadcasts commands to all clients at specific ticks
 * - All clients execute commands and simulate at the same tick
 * - This ensures identical game state on all clients
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
    private physicsSystem: PhysicsSystem;
    private healthSystem: HealthSystem;
    private projectileSystem: ProjectileSystem;
    private combatSystem: CombatSystem;
    private resourceSystem: ResourceSystem;
    private territorySystem: TerritorySystem;
    private formationGridSystem: FormationGridSystem;
    private victorySystem: VictorySystem;
    private cameraController!: CameraController;
    // @ts-ignore - InputManager registers event listeners in constructor
    private inputManager: InputManager;

    // Pending commands to be sent to server
    private pendingCommands: NetworkCommand[] = [];

    // Lockstep synchronization state
    private lastSimulatedTick: number = -1;
    private pendingTickCommands: Map<number, PlayerCommand[]> = new Map();

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
        this.setupGameOverHandler();
    }

    /**
     * Setup game over event handler
     */
    private setupGameOverHandler(): void {
        this.eventBus.on<GameOverEvent>(GameEvents.GAME_OVER, (event) => {
            const isWinner = event.winnerTeam === this.localTeam;
            const message = isWinner ? '🎉 Victory!' : '💀 Defeat!';
            this.showNotification(message, isWinner ? 'info' : 'warning');

            console.log(`[Game] Game Over! Winner: Team ${event.winnerTeam}, Reason: ${event.reason}`);

            // Exit after a delay
            setTimeout(() => {
                this.handleExit();
            }, 5000);
        });
    }

    /**
     * Set callback for exit
     */
    public setOnExit(callback: () => void): void {
        this.onExit = callback;
    }

    /**
     * Setup network event handlers for LOCKSTEP SYNCHRONIZATION
     * 
     * Key principle: Commands are NOT executed immediately.
     * They are queued and executed when the server broadcasts them at a specific tick.
     * This ensures all clients execute the same commands at the same simulation tick.
     */
    private setupNetworkHandlers(): void {
        // Handle incoming commands from server - this triggers simulation
        // We use the commands event (not tick event) because the server emits:
        // 1. tick-sync, 2. commands-batch - so commands arrive AFTER tick
        // By triggering simulation here, we ensure commands are stored before simulating
        this.client.on('commands', (event: CommandsBatchEvent) => {
            console.log(`[Lockstep] Received ${event.commands.length} commands for tick ${event.tick}:`, JSON.stringify(event.commands));
            // Store commands for this tick
            this.pendingTickCommands.set(event.tick, event.commands);
            // Now simulate up to this tick (commands are guaranteed to be stored)
            this.simulateToTick(event.tick);
        });

        // Handle network ticks - just update current tick, don't simulate
        // Simulation is triggered by commands event above
        this.client.on('tick', () => {
            // Keep track of server tick for command submission timing
            // But don't simulate here - wait for commands event
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
     * Simulate all game ticks up to and including the target tick
     * This is the core of the LOCKSTEP synchronization
     */
    private simulateToTick(targetTick: number): void {
        // Process all ticks we haven't simulated yet
        while (this.lastSimulatedTick < targetTick) {
            const tickToSimulate = this.lastSimulatedTick + 1;

            // Get commands for this tick (if any)
            const commands = this.pendingTickCommands.get(tickToSimulate) || [];

            // Execute all commands for this tick (from ALL players)
            this.executeTickCommands(commands);

            // Run one tick of deterministic simulation
            this.simulateTick();

            // Process resources deterministically based on tick
            this.resourceSystem.processTick(tickToSimulate);

            // Update last simulated tick
            this.lastSimulatedTick = tickToSimulate;

            // Clean up processed commands
            this.pendingTickCommands.delete(tickToSimulate);
        }
    }

    /**
     * Execute all commands for a single tick
     * Commands from ALL players are executed - no skipping of "own" commands
     */
    private executeTickCommands(commands: PlayerCommand[]): void {
        for (const cmd of commands) {
            if (cmd.type === 'move') {
                const moveCmd = cmd as NetworkMoveCommand;
                const data = moveCmd.data;

                console.log(`[Lockstep] Executing move for entity ${data.entityId} to (${data.targetX}, ${data.targetY}, ${data.targetZ})`);

                // Execute move command for ANY entity (not just opponent's)
                this.movementSystem.moveEntityTo(
                    data.entityId,
                    new Vector3(data.targetX, data.targetY, data.targetZ)
                );
            } else if (cmd.type === 'placeUnit') {
                const placeCmd = cmd as NetworkPlaceUnitCommand;
                const data = placeCmd.data;
                const commandPlayerId = (cmd as any).playerId as string | undefined;

                if (!commandPlayerId) {
                    console.warn(`[Lockstep] placeUnit command missing playerId:`, JSON.stringify(cmd));
                    continue;
                }

                console.log(`[Lockstep] Executing placeUnit for player ${commandPlayerId}: ${data.unitType} at (${data.gridX}, ${data.gridZ})`);

                // Place unit on the player's grid
                if (this.formationGridSystem.placeUnit(commandPlayerId, data.gridX, data.gridZ, data.unitType)) {
                    // Determine team based on player
                    const team = commandPlayerId === this.matchData.playerId ? this.localTeam :
                        (this.localTeam === TeamTag.Team1 ? TeamTag.Team2 : TeamTag.Team1);

                    // Deduct resources
                    this.eventBus.emit(GameEvents.UNIT_PURCHASE_REQUESTED, {
                        ...createEvent(),
                        playerId: commandPlayerId,
                        team: team,
                        unitType: data.unitType,
                        gridPosition: { x: data.gridX, z: data.gridZ },
                    });
                }
            } else if (cmd.type === 'deployUnits') {
                const commandPlayerId = (cmd as any).playerId as string | undefined;

                if (!commandPlayerId) {
                    console.warn(`[Lockstep] deployUnits command missing playerId:`, JSON.stringify(cmd));
                    continue;
                }

                console.log(`[Lockstep] Executing deployUnits for player ${commandPlayerId}`);

                // Commit the player's formation
                const unitCount = this.formationGridSystem.commitFormation(commandPlayerId);
                
                // Show notification for local player
                if (commandPlayerId === this.matchData.playerId) {
                    if (unitCount > 0) {
                        this.showNotification(`Deployed ${unitCount} units!`, 'info');
                    }
                    this.updateCommitButton();
                }
            }
        }
    }

    /**
     * Run one tick of deterministic game simulation
     * All systems update based on the fixed tick timestep
     */
    private simulateTick(): void {
        // Update physics (runs multiple substeps internally for accuracy)
        this.physicsSystem.simulateTick();

        // Update movement system (check for completed movements)
        this.movementSystem.update();

        // Update combat (target selection, attack cooldowns)
        this.combatSystem.simulateTick();

        // Update projectiles (movement, hit detection)
        this.projectileSystem.simulateTick();

        // Update territory system (for visual feedback)
        this.territorySystem.update(networkConfig.tickTimestep);

        // Cleanup destroyed entities
        this.cleanupDestroyedEntities();
    }

    /**
     * Setup interceptor for local move commands to send over network
     * In networked mode, we intercept local commands and send them to server
     * The server will broadcast them back and we'll execute from lockstep simulation
     * 
     * IMPORTANT: We do NOT execute locally. Execution only happens when commands
     * come back from the server in executeTickCommands().
     */
    private setupMoveCommandInterceptor(): void {
        // Intercept MOVE_REQUESTED events to queue for network sending
        // NOTE: MovementSystem also listens to this event, but we prevent local
        // execution by not having the event trigger actual movement.
        // Movement is only triggered from executeTickCommands().
        this.eventBus.on<MoveRequestedEvent>(GameEvents.MOVE_REQUESTED, (event) => {
            // Check if this is a network-triggered event (from executeTickCommands)
            // by checking a flag we set. If so, don't re-queue it.
            if ((event as any)._fromNetwork) return;

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
     * Setup selection filter
     * In Direct Strike mode, players can select any unit to view info
     * but cannot issue commands (movement is automatic)
     */
    private setupSelectionFilter(): void {
        // In Direct Strike mode, allow selection of any unit for viewing info
        // No command filtering needed since player cannot issue movement commands
        const originalSelectEntity = this.selectionSystem.selectEntity.bind(this.selectionSystem);

        this.selectionSystem.selectEntity = (entity: import("../systems/SelectionSystem").ISelectableEntity) => {
            console.log(`[Selection] Selecting entity ${entity.id} for info view`);
            console.log(`[Selection] Entity canBeSelected: ${entity.canBeSelected()}, isSelected: ${entity.isSelected}`);
            originalSelectEntity(entity);
            console.log(`[Selection] After selection - entity.isSelected: ${entity.isSelected}`);
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

        // Update UI with player info
        this.updatePlayerInfoUI();

        // Reset territory indicator to hidden state
        this.resetTerritoryIndicator();

        // Create entities for both players
        this.createPlayerEntities();

        // Initialize gameplay systems for both players
        this.initializeGameplaySystems();

        // Setup unit placement UI
        this.setupUnitPlacementUI();
    }

    /**
     * Reset territory indicator to hidden state
     */
    private resetTerritoryIndicator(): void {
        const indicator = document.getElementById('territory-indicator');
        if (indicator) {
            indicator.classList.remove('active');
        }
    }

    /**
     * Initialize gameplay systems (resources, formation grids, etc.)
     */
    private initializeGameplaySystems(): void {
        // Get opponent player ID
        const opponentId = this.matchData.opponents[0]?.playerId
            ?? this.matchData.teammates[0]?.playerId
            ?? 'unknown-opponent';

        // Determine player IDs for each team
        let team1PlayerId: string;
        let team2PlayerId: string;

        if (this.localTeam === TeamTag.Team1) {
            team1PlayerId = this.matchData.playerId;
            team2PlayerId = opponentId;
        } else {
            team1PlayerId = opponentId;
            team2PlayerId = this.matchData.playerId;
        }

        // Initialize resource system for both players
        this.resourceSystem.initializePlayer(team1PlayerId, TeamTag.Team1);
        this.resourceSystem.initializePlayer(team2PlayerId, TeamTag.Team2);

        // Initialize formation grids for both players
        this.formationGridSystem.initializeGrid(team1PlayerId, TeamTag.Team1);
        this.formationGridSystem.initializeGrid(team2PlayerId, TeamTag.Team2);

        // Set up unit creation callback for FormationGridSystem
        this.formationGridSystem.setCreateUnitCallback((unitType, team, position) => {
            return this.createUnitForFormation(unitType, team, position);
        });

        // Set up move unit callback for FormationGridSystem (lockstep simulation)
        // This bypasses EventBus to avoid commands being re-routed through the network
        this.formationGridSystem.setMoveUnitCallback((entityId, target) => {
            this.movementSystem.moveEntityTo(entityId, target);
        });

        // Register players in victory system
        this.victorySystem.registerPlayer(team1PlayerId, TeamTag.Team1);
        this.victorySystem.registerPlayer(team2PlayerId, TeamTag.Team2);

        // Initial UI update to show starting resources
        setTimeout(() => {
            this.updateResourceUI();
        }, 100);

        console.log(`[Game] Gameplay systems initialized for players: ${team1PlayerId} (Team1), ${team2PlayerId} (Team2)`);
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
     * Entity creation order (for deterministic IDs):
     * Team 1: base=1, towers=2,3, units=4,5,6
     * Team 2: base=7, towers=8,9, units=10,11,12
     * Units spawn on their respective formation grids
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

        // Create Team 1 base (ID will be 1)
        const team1Base = this.createBase({
            color: team1Color,
            team: TeamTag.Team1,
            debug: false,
        }, new Vector3(arenaParams.teamA.base.x, 0, arenaParams.teamA.base.z));
        this.entityOwnership.set(team1Base.id, team1OwnerId);
        this.victorySystem.registerBase(team1Base.id, TeamTag.Team1);
        console.log(`[Setup] Created Team 1 Base with ID ${team1Base.id}, owner: ${team1OwnerId}`);

        // Create Team 1 towers (IDs will be 2, 3)
        for (const towerPos of arenaParams.teamA.towers) {
            const tower = this.createTower({
                color: team1Color,
                team: TeamTag.Team1,
                debug: false,
            }, new Vector3(towerPos.x, 0, towerPos.z));
            this.entityOwnership.set(tower.id, team1OwnerId);
            this.victorySystem.registerTower(tower.id, TeamTag.Team1);
            console.log(`[Setup] Created Team 1 Tower with ID ${tower.id}, owner: ${team1OwnerId}`);
        }

        // No default units - players must purchase and deploy units using resources

        // Create Team 2 base (ID will be 7)
        const team2Base = this.createBase({
            color: team2Color,
            team: TeamTag.Team2,
            debug: false,
        }, new Vector3(arenaParams.teamB.base.x, 0, arenaParams.teamB.base.z));
        this.entityOwnership.set(team2Base.id, team2OwnerId);
        this.victorySystem.registerBase(team2Base.id, TeamTag.Team2);
        console.log(`[Setup] Created Team 2 Base with ID ${team2Base.id}, owner: ${team2OwnerId}`);

        // Create Team 2 towers (IDs will be 8, 9)
        for (const towerPos of arenaParams.teamB.towers) {
            const tower = this.createTower({
                color: team2Color,
                team: TeamTag.Team2,
                debug: false,
            }, new Vector3(towerPos.x, 0, towerPos.z));
            this.entityOwnership.set(tower.id, team2OwnerId);
            this.victorySystem.registerTower(tower.id, TeamTag.Team2);
            console.log(`[Setup] Created Team 2 Tower with ID ${tower.id}, owner: ${team2OwnerId}`);
        }

        // No default units - players must purchase and deploy units using resources

        // Log final ownership map
        console.log(`[Setup] Entity ownership map:`);
        this.entityOwnership.forEach((owner, entityId) => {
            const isLocal = owner === this.matchData.playerId;
            console.log(`  Entity ${entityId} -> ${owner} ${isLocal ? '(LOCAL)' : '(OPPONENT)'}`);
        });
    }

    /**
     * Create a unit and register it with all necessary systems
     * Used by FormationGridSystem when deploying units
     */
    public createUnit(config: import("../entities/Unit").UnitConfig, position: Vector3): Unit {
        const unit = this.sceneManager.createUnit(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(unit);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(unit);

        // Register with PhysicsSystem - units are dynamic bodies
        this.physicsSystem.registerBody(unit.id, {
            radius: 1.0,
            mass: 1.0,
            isStatic: false,
        });

        return unit;
    }

    /**
     * Create a PrismaUnit and register it with all necessary systems
     * Used by FormationGridSystem when deploying units
     */
    public createPrismaUnit(config: import("../entities/PrismaUnit").PrismaUnitConfig, position: Vector3): import("../entities/PrismaUnit").PrismaUnit {
        const unit = this.sceneManager.createPrismaUnit(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(unit);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(unit);

        // Register with PhysicsSystem - prisma units are larger dynamic bodies
        this.physicsSystem.registerBody(unit.id, {
            radius: 1.8, // Larger radius for 2x2 unit
            mass: 2.0,   // Heavier unit
            isStatic: false,
        });

        return unit;
    }

    /**
     * Create a unit for the formation system
     * Returns the unit info needed for move commands
     */
    private createUnitForFormation(
        unitType: 'sphere' | 'prisma',
        team: TeamTag,
        position: Vector3
    ): { id: number; position: Vector3 } {
        const color = team === TeamTag.Team1
            ? new Color3(arenaParams.colors.teamA.r, arenaParams.colors.teamA.g, arenaParams.colors.teamA.b)
            : new Color3(arenaParams.colors.teamB.r, arenaParams.colors.teamB.g, arenaParams.colors.teamB.b);

        let unit: Unit | import("../entities/PrismaUnit").PrismaUnit;

        if (unitType === 'sphere') {
            unit = this.createUnit({
                color,
                team,
                health: unitConfig.sphere.health,
                attackDamage: unitConfig.sphere.attackDamage,
                attackRange: unitConfig.sphere.attackRange,
                attackCooldown: unitConfig.sphere.attackCooldown,
                moveSpeed: unitConfig.sphere.moveSpeed,
            }, position);
        } else {
            unit = this.createPrismaUnit({
                color,
                team,
                health: unitConfig.prisma.health,
                attackDamage: unitConfig.prisma.attackDamage,
                attackRange: unitConfig.prisma.attackRange,
                attackCooldown: unitConfig.prisma.attackCooldown,
                moveSpeed: unitConfig.prisma.moveSpeed,
            }, position);
        }

        // Track ownership
        const playerId = team === this.localTeam ? this.matchData.playerId : this.getOpponentId();
        this.entityOwnership.set(unit.id, playerId);

        return { id: unit.id, position: unit.position.clone() };
    }

    /**
     * Get opponent player ID
     */
    private getOpponentId(): string {
        return this.matchData.opponents[0]?.playerId
            ?? this.matchData.teammates[0]?.playerId
            ?? 'unknown-opponent';
    }

    private createTower(config: import("../entities/Tower").TowerConfig, position: Vector3): Tower {
        const tower = this.sceneManager.createTower(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(tower);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(tower);

        // Register with PhysicsSystem - towers are static bodies (can push but don't move)
        this.physicsSystem.registerBody(tower.id, {
            radius: 1.5,
            mass: 10.0,
            isStatic: true,
        });

        return tower;
    }

    private createBase(config: import("../entities/Base").BaseConfig, position: Vector3): Base {
        const base = this.sceneManager.createBase(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(base);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(base);

        // Register with PhysicsSystem - bases are static bodies (can push but don't move)
        this.physicsSystem.registerBody(base.id, {
            radius: 3.0,
            mass: 100.0,
            isStatic: true,
        });

        return base;
    }

    /**
     * Start the game loop
     * 
     * LOCKSTEP ARCHITECTURE:
     * - Rendering happens every frame (smooth visuals)
     * - Simulation happens only on network ticks (deterministic)
     * - Commands are sent to server each frame if pending
     */
    public start(): void {
        this.engine.runRenderLoop(() => {
            this.renderUpdate();
            this.scene.render();
        });
    }

    /**
     * Render update loop - called every frame
     * Handles input, command sending, and UI updates
     * NOTE: Game simulation is NOT done here - it's done in simulateTick()
     */
    private renderUpdate(): void {
        // Send pending commands to server
        if (this.pendingCommands.length > 0) {
            const tick = this.client.getCurrentTick();
            console.log(`[Lockstep] Sending ${this.pendingCommands.length} commands at tick ${tick}:`, JSON.stringify(this.pendingCommands));
            this.client.submitCommandsAsync(tick, this.pendingCommands);
            this.pendingCommands = [];
        }

        // Update UI systems that need frame-rate updates (not simulation)
        this.resourceSystem.update(0); // Just UI updates, resource gen is tick-based
    }

    /**
     * Remove destroyed entities from all systems
     */
    private cleanupDestroyedEntities(): void {
        const destroyed = this.entityManager.cleanupDestroyed();

        for (const entity of destroyed) {
            // Remove from ownership tracking
            this.entityOwnership.delete(entity.id);

            // Unregister from physics system
            this.physicsSystem.unregisterBody(entity.id);

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
     * Setup UI for unit placement buttons
     */
    private setupUnitPlacementUI(): void {
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');
        const commitBtn = document.getElementById('commit-btn');

        sphereBtn?.addEventListener('click', () => {
            this.handleUnitButtonClick('sphere');
        });

        prismaBtn?.addEventListener('click', () => {
            this.handleUnitButtonClick('prisma');
        });

        commitBtn?.addEventListener('click', () => {
            this.commitFormation();
        });

        // Subscribe to resource changes to update UI
        this.eventBus.on(GameEvents.RESOURCES_GENERATED, () => {
            this.updateResourceUI();
        });

        this.eventBus.on(GameEvents.RESOURCES_CHANGED, () => {
            this.updateResourceUI();
        });

        // Subscribe to territory changes - only show for local player's team
        this.eventBus.on<AggressionBonusActivatedEvent>(GameEvents.AGGRESSION_BONUS_ACTIVATED, (event) => {
            // Only show indicator if the local player's team has the bonus
            if (event.team !== this.localTeam) return;
            
            const indicator = document.getElementById('territory-indicator');
            if (indicator) {
                indicator.classList.add('active');
            }
        });

        this.eventBus.on<AggressionBonusDeactivatedEvent>(GameEvents.AGGRESSION_BONUS_DEACTIVATED, (event) => {
            // Only hide indicator if the local player's team lost the bonus
            if (event.team !== this.localTeam) return;
            
            const indicator = document.getElementById('territory-indicator');
            if (indicator) {
                indicator.classList.remove('active');
            }
        });

        // Subscribe to formation placement requests (queue network commands)
        this.eventBus.on(GameEvents.FORMATION_PLACEMENT_REQUESTED, (event: any) => {
            // Send network command - placement will happen through lockstep
            if (event.playerId === this.matchData.playerId) {
                const command: NetworkPlaceUnitCommand = {
                    type: 'placeUnit',
                    data: {
                        unitType: event.unitType,
                        gridX: event.gridX,
                        gridZ: event.gridZ,
                    },
                };
                this.pendingCommands.push(command);
            }
        });

        // Subscribe to formation changes (for UI updates after network sync)
        this.eventBus.on(GameEvents.FORMATION_UNIT_PLACED, () => {
            this.updateCommitButton();
        });

        this.eventBus.on(GameEvents.FORMATION_UNIT_REMOVED, () => {
            this.updateCommitButton();
        });
    }

    /**
     * Handle unit button click
     */
    private handleUnitButtonClick(unitType: 'sphere' | 'prisma'): void {
        // Check if player can afford the unit
        if (!this.resourceSystem.canAfford(this.matchData.playerId, unitType)) {
            this.showNotification('Not enough resources!', 'warning');
            return;
        }

        // Toggle placement mode
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');

        // Remove active class from both buttons
        sphereBtn?.classList.remove('active');
        prismaBtn?.classList.remove('active');

        // Add active class to clicked button
        if (unitType === 'sphere') {
            sphereBtn?.classList.add('active');
        } else {
            prismaBtn?.classList.add('active');
        }

        this.formationGridSystem.enterPlacementMode(this.matchData.playerId, unitType);
    }

    /**
     * Commit formation - deploy all pending units
     * Only queues the network command - actual deployment happens through lockstep
     */
    private commitFormation(): void {
        const pendingUnits = this.formationGridSystem.getPendingUnits(this.matchData.playerId);
        if (pendingUnits.length === 0) return;

        // Send network command for deployment - actual execution happens in executeTickCommands
        const command: NetworkDeployUnitsCommand = {
            type: 'deployUnits',
            data: {
                playerId: this.matchData.playerId,
            },
        };
        this.pendingCommands.push(command);
        
        // Note: Notification and button update will happen after network sync
        // when executeTickCommands processes the deployUnits command
    }

    /**
     * Update resource UI display
     */
    private updateResourceUI(): void {
        const resources = this.resourceSystem.getPlayerResources(this.matchData.playerId);
        if (!resources) return;

        const amountEl = document.getElementById('resource-amount');
        const rateEl = document.getElementById('resource-rate');

        if (amountEl) {
            amountEl.textContent = Math.floor(resources.currentResources).toString();
        }

        if (rateEl) {
            rateEl.textContent = `(+${resources.currentGenerationRate.toFixed(1)}/s)`;
            if (resources.hasAggressionBonus) {
                rateEl.classList.add('bonus');
            } else {
                rateEl.classList.remove('bonus');
            }
        }

        // Update button states based on affordability
        this.updateUnitButtonStates();
    }

    /**
     * Update unit button states based on resources
     */
    private updateUnitButtonStates(): void {
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');

        const canAffordSphere = this.resourceSystem.canAfford(this.matchData.playerId, 'sphere');
        const canAffordPrisma = this.resourceSystem.canAfford(this.matchData.playerId, 'prisma');

        if (sphereBtn) {
            if (canAffordSphere) {
                sphereBtn.classList.remove('disabled');
            } else {
                sphereBtn.classList.add('disabled');
            }
        }

        if (prismaBtn) {
            if (canAffordPrisma) {
                prismaBtn.classList.remove('disabled');
            } else {
                prismaBtn.classList.add('disabled');
            }
        }
    }

    /**
     * Update commit button state
     */
    private updateCommitButton(): void {
        const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;
        const pendingUnits = this.formationGridSystem.getPendingUnits(this.matchData.playerId);

        if (commitBtn) {
            commitBtn.textContent = `Deploy Units (${pendingUnits.length})`;
            commitBtn.disabled = pendingUnits.length === 0;
        }
    }

    /**
     * Cleanup resources
     */
    public dispose(): void {
        this.removeBeforeUnloadWarning();

        // Dispose all systems (unsubscribe from events)
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

        // Clear event bus and entity manager
        this.eventBus.clearAll();
        this.entityManager.clear();
        this.entityOwnership.clear();

        // Dispose engine
        this.engine.dispose();
    }
}
