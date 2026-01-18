import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, Mesh, PointerEventTypes } from "@babylonjs/core";
import { EntityManager } from "../core/EntityManager";
import { EventBus } from "../core/EventBus";
import { GameEvents, createEvent } from "../events";
import { TeamTag } from "../enums/TeamTag";
import { arenaParams } from "../config/constants";
import type {
    FormationModeEnteredEvent,
    FormationModeExitedEvent,
    FormationUnitPlacedEvent,
    FormationUnitRemovedEvent,
    FormationCommittedEvent,
    UnitPurchaseCompletedEvent,
    FormationUpdateModeEnteredEvent,
    FormationUpdateModeExitedEvent,
    FormationUnitMovedEvent,
} from "../events";

/**
 * Represents a cell in the formation grid
 */
interface GridCell {
    x: number;
    z: number;
    occupied: boolean;
    unitType: 'sphere' | 'prisma' | null;
    previewMesh: Mesh | null;
}

/**
 * Formation grid state for a player
 */
interface FormationGrid {
    playerId: string;
    team: TeamTag;
    cells: GridCell[][];
    gridWidth: number;  // Number of cells wide
    gridHeight: number; // Number of cells tall
    cellSize: number;   // Size of each cell in world units
    centerX: number;    // World X position of grid center
    centerZ: number;    // World Z position of grid center
    // All units placed on the grid (persistent across waves)
    placedUnits: { unitType: 'sphere' | 'prisma'; gridX: number; gridZ: number }[];
    // Units that were placed but not yet synced (for backward compatibility)
    pendingUnits: { unitType: 'sphere' | 'prisma'; gridX: number; gridZ: number }[];
}

/**
 * Callback type for creating units
 */
export type CreateUnitCallback = (
    unitType: 'sphere' | 'prisma',
    team: TeamTag,
    position: Vector3
) => { id: number; position: Vector3 };

/**
 * Callback type for moving units (bypasses event bus for lockstep simulation)
 */
export type MoveUnitCallback = (entityId: number, target: Vector3) => void;

/**
 * FormationGridSystem - Manages the formation grid for unit placement
 * Players place units on their grid before committing to battlefield
 */
export class FormationGridSystem {
    private scene: Scene;
    private eventBus: EventBus;
    private unsubscribers: (() => void)[] = [];

    private grids: Map<string, FormationGrid> = new Map();
    private activePlacementMode: { playerId: string; unitType: 'sphere' | 'prisma' } | null = null;
    private activeUpdateMode: { playerId: string; gridX: number; gridZ: number; unitType: 'sphere' | 'prisma' } | null = null;
    private gridVisuals: Map<string, Mesh[]> = new Map();
    private previewMesh: Mesh | null = null;

    // Hover highlight mesh
    private hoverHighlight: Mesh | null = null;
    private hoverHighlightMaterial: StandardMaterial | null = null;
    private invalidHighlightMaterial: StandardMaterial | null = null;

    // Grid ground planes for mouse picking
    private gridGroundPlanes: Map<string, Mesh> = new Map();

    // Callback for creating units - set by Game.ts
    private createUnitCallback: CreateUnitCallback | null = null;
    
    // Callback for moving units - set by Game.ts (for lockstep simulation)
    private moveUnitCallback: MoveUnitCallback | null = null;

    // Callback for checking if player can afford a unit - set by Game.ts
    private canAffordCallback: ((playerId: string, unitType: 'sphere' | 'prisma') => boolean) | null = null;

    constructor(scene: Scene, _entityManager: EntityManager, eventBus: EventBus) {
        this.scene = scene;
        this.eventBus = eventBus;

        this.setupEventListeners();
        this.setupMouseHandling();
        this.createHighlightMaterials();
    }

    /**
     * Set the callback for creating units
     * This should be called by Game.ts after initialization
     */
    public setCreateUnitCallback(callback: CreateUnitCallback): void {
        this.createUnitCallback = callback;
    }

    /**
     * Set the callback for moving units
     * This should be called by Game.ts after initialization
     * Used for lockstep simulation to bypass EventBus
     */
    public setMoveUnitCallback(callback: MoveUnitCallback): void {
        this.moveUnitCallback = callback;
    }

    /**
     * Set the callback for checking affordability
     * This should be called by Game.ts after initialization
     */
    public setCanAffordCallback(callback: (playerId: string, unitType: 'sphere' | 'prisma') => boolean): void {
        this.canAffordCallback = callback;
    }

    /**
     * Create materials for hover highlight
     */
    private createHighlightMaterials(): void {
        // Valid placement - green
        this.hoverHighlightMaterial = new StandardMaterial("hoverHighlight", this.scene);
        this.hoverHighlightMaterial.diffuseColor = new Color3(0.2, 0.8, 0.2);
        this.hoverHighlightMaterial.alpha = 0.5;
        this.hoverHighlightMaterial.emissiveColor = new Color3(0.1, 0.4, 0.1);

        // Invalid placement - red
        this.invalidHighlightMaterial = new StandardMaterial("invalidHighlight", this.scene);
        this.invalidHighlightMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2);
        this.invalidHighlightMaterial.alpha = 0.5;
        this.invalidHighlightMaterial.emissiveColor = new Color3(0.4, 0.1, 0.1);
    }

    /**
     * Setup mouse handling for grid interaction
     */
    private setupMouseHandling(): void {
        // Handle pointer events using observable (compatible with InputManager)
        this.scene.onPointerObservable.add((pointerInfo) => {
            const pickResult = pointerInfo.pickInfo;

            if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
                this.handlePointerMove(pickResult);
            } else if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
                const evt = pointerInfo.event as PointerEvent;
                // Only handle left click
                if (evt.button === 0) {
                    this.handlePointerDown(pickResult);
                }
            }
        });
    }

    /**
     * Handle pointer move for hover highlight
     */
    private handlePointerMove(pickResult: any): void {
        // Check for update mode first
        if (this.activeUpdateMode) {
            const { playerId, unitType } = this.activeUpdateMode;
            const grid = this.grids.get(playerId);
            if (!grid) return;

            // Check if we're hovering over the grid ground plane
            const gridPlane = this.gridGroundPlanes.get(playerId);
            if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) {
                this.hideHoverHighlight();
                return;
            }

            const hitPoint = pickResult.pickedPoint;
            if (!hitPoint) return;

            // Convert to grid coordinates
            const gridCoords = this.worldToGrid(playerId, hitPoint);
            if (!gridCoords) {
                this.hideHoverHighlight();
                return;
            }

            // Show hover highlight at this position (for moving the selected unit)
            this.showHoverHighlightForMove(playerId, gridCoords.x, gridCoords.z, unitType);
            return;
        }

        if (!this.activePlacementMode) {
            this.hideHoverHighlight();
            return;
        }

        const { playerId, unitType } = this.activePlacementMode;
        const grid = this.grids.get(playerId);
        if (!grid) return;

        // Check if we're hovering over the grid ground plane
        const gridPlane = this.gridGroundPlanes.get(playerId);
        if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) {
            this.hideHoverHighlight();
            return;
        }

        const hitPoint = pickResult.pickedPoint;
        if (!hitPoint) return;

        // Convert to grid coordinates
        const gridCoords = this.worldToGrid(playerId, hitPoint);
        if (!gridCoords) {
            this.hideHoverHighlight();
            return;
        }

        // Show hover highlight at this position
        this.showHoverHighlight(playerId, gridCoords.x, gridCoords.z, unitType);
    }

    /**
     * Handle pointer down for unit placement
     */
    private handlePointerDown(pickResult: any): void {
        // Handle update mode first - clicking on empty cell to move the unit
        if (this.activeUpdateMode) {
            const { playerId, gridX: fromGridX, gridZ: fromGridZ, unitType } = this.activeUpdateMode;
            const grid = this.grids.get(playerId);
            if (!grid) return;

            // Check if we clicked on the grid ground plane
            const gridPlane = this.gridGroundPlanes.get(playerId);
            if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) return;

            const hitPoint = pickResult.pickedPoint;
            if (!hitPoint) return;

            // Convert to grid coordinates
            const gridCoords = this.worldToGrid(playerId, hitPoint);
            if (!gridCoords) return;

            // Check if the target cell is the same as the selected unit's cell
            if (gridCoords.x === fromGridX && gridCoords.z === fromGridZ) {
                // Clicking on the same cell - just exit update mode
                this.exitUpdateMode(playerId);
                return;
            }

            // Check if clicking on another unit - select that unit instead
            const targetCell = grid.cells[gridCoords.x]?.[gridCoords.z];
            if (targetCell?.occupied && targetCell.unitType) {
                // Exit current update mode and enter update mode for the clicked unit
                this.exitUpdateMode(playerId);
                const origin = this.findUnitOrigin(playerId, gridCoords.x, gridCoords.z);
                if (origin) {
                    this.enterUpdateMode(playerId, origin.x, origin.z, targetCell.unitType);
                }
                return;
            }

            // Check if we can move the unit to this position
            if (this.canMoveUnit(playerId, fromGridX, fromGridZ, gridCoords.x, gridCoords.z, unitType)) {
                // Emit move request event - actual move happens through network lockstep
                this.eventBus.emit(GameEvents.FORMATION_UNIT_MOVE_REQUESTED, {
                    ...createEvent(),
                    playerId,
                    fromGridX,
                    fromGridZ,
                    toGridX: gridCoords.x,
                    toGridZ: gridCoords.z,
                });

                // Exit update mode after requesting move
                this.exitUpdateMode(playerId);
            }
            return;
        }

        // Not in any mode - check if clicking on an existing unit to enter update mode
        if (!this.activePlacementMode) {
            // Find which player's grid we might be clicking on
            for (const [playerId, grid] of this.grids.entries()) {
                const gridPlane = this.gridGroundPlanes.get(playerId);
                if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) continue;

                const hitPoint = pickResult.pickedPoint;
                if (!hitPoint) continue;

                // Convert to grid coordinates
                const gridCoords = this.worldToGrid(playerId, hitPoint);
                if (!gridCoords) continue;

                // Check if there's a unit at this cell
                const cell = grid.cells[gridCoords.x]?.[gridCoords.z];
                if (cell?.occupied && cell.unitType) {
                    // Find the origin cell for this unit (important for prisma units)
                    const origin = this.findUnitOrigin(playerId, gridCoords.x, gridCoords.z);
                    if (origin) {
                        this.enterUpdateMode(playerId, origin.x, origin.z, cell.unitType);
                    }
                }
                return;
            }
            return;
        }

        const { playerId, unitType } = this.activePlacementMode;
        const grid = this.grids.get(playerId);
        if (!grid) return;

        // Check if we clicked on the grid ground plane
        const gridPlane = this.gridGroundPlanes.get(playerId);
        if (!pickResult?.hit || pickResult.pickedMesh !== gridPlane) return;

        const hitPoint = pickResult.pickedPoint;
        if (!hitPoint) return;

        // Convert to grid coordinates
        const gridCoords = this.worldToGrid(playerId, hitPoint);
        if (!gridCoords) return;

        // Check if clicking on an existing unit - enter update mode instead
        const cell = grid.cells[gridCoords.x]?.[gridCoords.z];
        if (cell?.occupied && cell.unitType) {
            // Exit placement mode and enter update mode
            this.exitPlacementMode(playerId);
            const origin = this.findUnitOrigin(playerId, gridCoords.x, gridCoords.z);
            if (origin) {
                this.enterUpdateMode(playerId, origin.x, origin.z, cell.unitType);
            }
            return;
        }

        // Check if player can afford this unit
        if (this.canAffordCallback && !this.canAffordCallback(playerId, unitType)) {
            // Can't afford - exit placement mode
            this.exitPlacementMode(playerId);
            return;
        }

        // Check if placement is valid (but don't place yet - wait for network sync)
        if (this.canPlaceUnit(playerId, gridCoords.x, gridCoords.z, unitType)) {
            // Emit placement request event - actual placement happens through network lockstep
            this.eventBus.emit(GameEvents.FORMATION_PLACEMENT_REQUESTED, {
                ...createEvent(),
                playerId,
                team: grid.team,
                unitType,
                gridX: gridCoords.x,
                gridZ: gridCoords.z,
            });

            // Stay in placement mode to place more units
            // Update highlight for new position
            this.showHoverHighlight(playerId, gridCoords.x, gridCoords.z, unitType);
        }
    }

    /**
     * Show hover highlight at grid position
     */
    private showHoverHighlight(playerId: string, gridX: number, gridZ: number, unitType: 'sphere' | 'prisma'): void {
        const grid = this.grids.get(playerId);
        if (!grid) return;

        const size = unitType === 'sphere' ? 1 : 2;
        const worldSize = size * grid.cellSize;

        // Create or update highlight mesh
        if (!this.hoverHighlight) {
            this.hoverHighlight = MeshBuilder.CreateBox(
                "hoverHighlight",
                { width: worldSize, height: 0.2, depth: worldSize },
                this.scene
            );
            this.hoverHighlight.isPickable = false;
        } else {
            // Update size if needed
            this.hoverHighlight.dispose();
            this.hoverHighlight = MeshBuilder.CreateBox(
                "hoverHighlight",
                { width: worldSize, height: 0.2, depth: worldSize },
                this.scene
            );
            this.hoverHighlight.isPickable = false;
        }

        // Position the highlight
        const worldPos = this.gridToWorld(playerId, gridX, gridZ);
        if (!worldPos) return;

        // Offset for larger units
        if (unitType === 'prisma') {
            worldPos.x += grid.cellSize / 2;
            worldPos.z += grid.cellSize / 2;
        }

        this.hoverHighlight.position = new Vector3(worldPos.x, 0.15, worldPos.z);

        // Set material based on whether placement is valid
        const canPlace = this.canPlaceUnit(playerId, gridX, gridZ, unitType);
        this.hoverHighlight.material = canPlace ? this.hoverHighlightMaterial : this.invalidHighlightMaterial;
        this.hoverHighlight.isVisible = true;
    }

    /**
     * Hide the hover highlight
     */
    private hideHoverHighlight(): void {
        if (this.hoverHighlight) {
            this.hoverHighlight.isVisible = false;
        }
    }

    // Mesh for highlighting the currently selected unit in update mode
    private selectedUnitHighlight: Mesh | null = null;
    private selectedUnitHighlightMaterial: StandardMaterial | null = null;

    /**
     * Show hover highlight for move operation (in update mode)
     */
    private showHoverHighlightForMove(
        playerId: string,
        gridX: number,
        gridZ: number,
        unitType: 'sphere' | 'prisma'
    ): void {
        if (!this.activeUpdateMode) return;

        const { gridX: fromGridX, gridZ: fromGridZ } = this.activeUpdateMode;
        const grid = this.grids.get(playerId);
        if (!grid) return;

        const size = unitType === 'sphere' ? 1 : 2;
        const worldSize = size * grid.cellSize;

        // Create or update highlight mesh
        if (!this.hoverHighlight) {
            this.hoverHighlight = MeshBuilder.CreateBox(
                "hoverHighlight",
                { width: worldSize, height: 0.2, depth: worldSize },
                this.scene
            );
            this.hoverHighlight.isPickable = false;
        } else {
            this.hoverHighlight.dispose();
            this.hoverHighlight = MeshBuilder.CreateBox(
                "hoverHighlight",
                { width: worldSize, height: 0.2, depth: worldSize },
                this.scene
            );
            this.hoverHighlight.isPickable = false;
        }

        // Position the highlight
        const worldPos = this.gridToWorld(playerId, gridX, gridZ);
        if (!worldPos) return;

        // Offset for larger units
        if (unitType === 'prisma') {
            worldPos.x += grid.cellSize / 2;
            worldPos.z += grid.cellSize / 2;
        }

        this.hoverHighlight.position = new Vector3(worldPos.x, 0.15, worldPos.z);

        // Check if this is the same cell as the selected unit
        const isSameCell = gridX === fromGridX && gridZ === fromGridZ;

        // Set material based on whether move is valid
        const canMove = isSameCell || this.canMoveUnit(playerId, fromGridX, fromGridZ, gridX, gridZ, unitType);
        this.hoverHighlight.material = canMove ? this.hoverHighlightMaterial : this.invalidHighlightMaterial;
        this.hoverHighlight.isVisible = true;
    }

    /**
     * Highlight the currently selected unit in update mode
     */
    private highlightSelectedUnit(
        playerId: string,
        gridX: number,
        gridZ: number,
        unitType: 'sphere' | 'prisma'
    ): void {
        const grid = this.grids.get(playerId);
        if (!grid) return;

        this.clearSelectedUnitHighlight();

        const size = unitType === 'sphere' ? 1 : 2;
        const worldSize = size * grid.cellSize;

        // Create highlight material if needed
        if (!this.selectedUnitHighlightMaterial) {
            this.selectedUnitHighlightMaterial = new StandardMaterial("selectedUnitHighlight", this.scene);
            this.selectedUnitHighlightMaterial.diffuseColor = new Color3(1.0, 0.85, 0.2); // Yellow/gold
            this.selectedUnitHighlightMaterial.alpha = 0.6;
            this.selectedUnitHighlightMaterial.emissiveColor = new Color3(0.5, 0.4, 0.1);
        }

        // Create highlight mesh
        this.selectedUnitHighlight = MeshBuilder.CreateBox(
            "selectedUnitHighlight",
            { width: worldSize, height: 0.3, depth: worldSize },
            this.scene
        );
        this.selectedUnitHighlight.isPickable = false;

        // Position the highlight
        const worldPos = this.gridToWorld(playerId, gridX, gridZ);
        if (!worldPos) return;

        // Offset for larger units
        if (unitType === 'prisma') {
            worldPos.x += grid.cellSize / 2;
            worldPos.z += grid.cellSize / 2;
        }

        this.selectedUnitHighlight.position = new Vector3(worldPos.x, 0.25, worldPos.z);
        this.selectedUnitHighlight.material = this.selectedUnitHighlightMaterial;
    }

    /**
     * Clear the selected unit highlight
     */
    private clearSelectedUnitHighlight(): void {
        if (this.selectedUnitHighlight) {
            this.selectedUnitHighlight.dispose();
            this.selectedUnitHighlight = null;
        }
    }

    /**
     * Initialize formation grid for a player
     */
    public initializeGrid(playerId: string, team: TeamTag): void {
        const gridConfig = arenaParams.formationGrid;
        const teamConfig = team === TeamTag.Team1 ? arenaParams.teamA : arenaParams.teamB;

        const gridWidth = 5;  // 5 cells wide
        const gridHeight = 10; // 10 cells tall
        const cellSize = gridConfig.gridSpacing;

        // Initialize cells
        const cells: GridCell[][] = [];
        for (let x = 0; x < gridWidth; x++) {
            cells[x] = [];
            for (let z = 0; z < gridHeight; z++) {
                cells[x][z] = {
                    x,
                    z,
                    occupied: false,
                    unitType: null,
                    previewMesh: null,
                };
            }
        }

        const grid: FormationGrid = {
            playerId,
            team,
            cells,
            gridWidth,
            gridHeight,
            cellSize,
            centerX: teamConfig.formationGridCenter.x,
            centerZ: teamConfig.formationGridCenter.z,
            placedUnits: [],
            pendingUnits: [],
        };

        this.grids.set(playerId, grid);
        this.createGridVisualization(playerId, grid);
        this.createGridGroundPlane(playerId, grid);

        console.log(`[FormationGridSystem] Initialized grid for player ${playerId}, team ${team}`);
    }

    private setupEventListeners(): void {
        // Listen for unit purchase completion to place on grid
        this.unsubscribers.push(
            this.eventBus.on<UnitPurchaseCompletedEvent>(GameEvents.UNIT_PURCHASE_COMPLETED, (_event) => {
                // Unit is queued for placement, actual spawn happens on commit
            })
        );
    }

    /**
     * Create visual representation of the formation grid
     */
    private createGridVisualization(playerId: string, grid: FormationGrid): void {
        const meshes: Mesh[] = [];
        const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
        const halfHeight = (grid.gridHeight * grid.cellSize) / 2;

        // Create grid lines
        const material = new StandardMaterial(`gridMat_${playerId}`, this.scene);
        const color = arenaParams.colors.gridLine;
        material.diffuseColor = new Color3(color.r, color.g, color.b);
        material.alpha = 0.5;

        // Horizontal lines
        for (let z = 0; z <= grid.gridHeight; z++) {
            const line = MeshBuilder.CreateBox(
                `gridLineH_${playerId}_${z}`,
                { width: grid.gridWidth * grid.cellSize, height: 0.1, depth: 0.1 },
                this.scene
            );
            line.position = new Vector3(
                grid.centerX,
                0.1,
                grid.centerZ - halfHeight + z * grid.cellSize
            );
            line.material = material;
            line.isPickable = false;
            meshes.push(line);
        }

        // Vertical lines
        for (let x = 0; x <= grid.gridWidth; x++) {
            const line = MeshBuilder.CreateBox(
                `gridLineV_${playerId}_${x}`,
                { width: 0.1, height: 0.1, depth: grid.gridHeight * grid.cellSize },
                this.scene
            );
            line.position = new Vector3(
                grid.centerX - halfWidth + x * grid.cellSize,
                0.1,
                grid.centerZ
            );
            line.material = material;
            line.isPickable = false;
            meshes.push(line);
        }

        this.gridVisuals.set(playerId, meshes);
    }

    /**
     * Create an invisible ground plane for the grid for mouse picking
     */
    private createGridGroundPlane(playerId: string, grid: FormationGrid): void {
        const totalWidth = grid.gridWidth * grid.cellSize;
        const totalHeight = grid.gridHeight * grid.cellSize;

        const plane = MeshBuilder.CreateGround(
            `gridPlane_${playerId}`,
            { width: totalWidth, height: totalHeight },
            this.scene
        );

        plane.position = new Vector3(grid.centerX, 0.05, grid.centerZ);

        // Make it invisible but pickable
        const material = new StandardMaterial(`gridPlaneMat_${playerId}`, this.scene);
        material.alpha = 0; // Invisible
        plane.material = material;
        plane.isPickable = true;

        this.gridGroundPlanes.set(playerId, plane);
    }

    /**
     * Enter placement mode for a unit type
     */
    public enterPlacementMode(playerId: string, unitType: 'sphere' | 'prisma'): void {
        // Exit update mode if active
        if (this.activeUpdateMode?.playerId === playerId) {
            this.exitUpdateMode(playerId);
        }

        this.activePlacementMode = { playerId, unitType };

        this.eventBus.emit<FormationModeEnteredEvent>(GameEvents.FORMATION_MODE_ENTERED, {
            ...createEvent(),
            playerId,
            unitType,
        });

        console.log(`[FormationGridSystem] Player ${playerId} entered placement mode for ${unitType}`);
    }

    /**
     * Exit placement mode
     */
    public exitPlacementMode(playerId: string): void {
        if (this.activePlacementMode?.playerId === playerId) {
            this.activePlacementMode = null;
            this.clearPreviewMesh();
            this.hideHoverHighlight();

            this.eventBus.emit<FormationModeExitedEvent>(GameEvents.FORMATION_MODE_EXITED, {
                ...createEvent(),
                playerId,
            });
        }
    }

    /**
     * Enter update mode for repositioning an existing unit
     */
    public enterUpdateMode(playerId: string, gridX: number, gridZ: number, unitType: 'sphere' | 'prisma'): void {
        // Exit placement mode if active
        if (this.activePlacementMode?.playerId === playerId) {
            this.activePlacementMode = null;
            this.clearPreviewMesh();
        }

        this.activeUpdateMode = { playerId, gridX, gridZ, unitType };

        // Highlight the selected unit
        this.highlightSelectedUnit(playerId, gridX, gridZ, unitType);

        this.eventBus.emit<FormationUpdateModeEnteredEvent>(GameEvents.FORMATION_UPDATE_MODE_ENTERED, {
            ...createEvent(),
            playerId,
            gridX,
            gridZ,
            unitType,
        });

        console.log(`[FormationGridSystem] Player ${playerId} entered update mode for ${unitType} at (${gridX}, ${gridZ})`);
    }

    /**
     * Exit update mode
     */
    public exitUpdateMode(playerId: string): void {
        if (this.activeUpdateMode?.playerId === playerId) {
            this.activeUpdateMode = null;
            this.hideHoverHighlight();
            this.clearSelectedUnitHighlight();

            this.eventBus.emit<FormationUpdateModeExitedEvent>(GameEvents.FORMATION_UPDATE_MODE_EXITED, {
                ...createEvent(),
                playerId,
            });
        }
    }

    /**
     * Check if we're currently in update mode
     */
    public isInUpdateMode(playerId: string): boolean {
        return this.activeUpdateMode?.playerId === playerId;
    }

    /**
     * Check if we're currently in placement mode
     */
    public isInPlacementMode(playerId: string): boolean {
        return this.activePlacementMode?.playerId === playerId;
    }

    /**
     * Convert world position to grid coordinates
     */
    public worldToGrid(playerId: string, worldPos: Vector3): { x: number; z: number } | null {
        const grid = this.grids.get(playerId);
        if (!grid) return null;

        const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
        const halfHeight = (grid.gridHeight * grid.cellSize) / 2;

        const localX = worldPos.x - (grid.centerX - halfWidth);
        const localZ = worldPos.z - (grid.centerZ - halfHeight);

        const gridX = Math.floor(localX / grid.cellSize);
        const gridZ = Math.floor(localZ / grid.cellSize);

        if (gridX < 0 || gridX >= grid.gridWidth || gridZ < 0 || gridZ >= grid.gridHeight) {
            return null;
        }

        return { x: gridX, z: gridZ };
    }

    /**
     * Convert grid coordinates to world position
     */
    public gridToWorld(playerId: string, gridX: number, gridZ: number): Vector3 | null {
        const grid = this.grids.get(playerId);
        if (!grid) return null;

        const halfWidth = (grid.gridWidth * grid.cellSize) / 2;
        const halfHeight = (grid.gridHeight * grid.cellSize) / 2;

        const worldX = grid.centerX - halfWidth + (gridX + 0.5) * grid.cellSize;
        const worldZ = grid.centerZ - halfHeight + (gridZ + 0.5) * grid.cellSize;

        return new Vector3(worldX, 1, worldZ);
    }

    /**
     * Check if a position is valid for placing a unit
     */
    public canPlaceUnit(playerId: string, gridX: number, gridZ: number, unitType: 'sphere' | 'prisma'): boolean {
        const grid = this.grids.get(playerId);
        if (!grid) return false;

        const size = unitType === 'sphere' ? 1 : 2;

        // Check bounds
        if (gridX < 0 || gridX + size > grid.gridWidth) return false;
        if (gridZ < 0 || gridZ + size > grid.gridHeight) return false;

        // Check if cells are occupied
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                if (grid.cells[gridX + dx][gridZ + dz].occupied) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Check if a unit can be moved from one position to another
     * The target cells must be empty (excluding the unit being moved)
     */
    public canMoveUnit(
        playerId: string,
        fromGridX: number,
        fromGridZ: number,
        toGridX: number,
        toGridZ: number,
        unitType: 'sphere' | 'prisma'
    ): boolean {
        const grid = this.grids.get(playerId);
        if (!grid) return false;

        const size = unitType === 'sphere' ? 1 : 2;

        // Check bounds for target position
        if (toGridX < 0 || toGridX + size > grid.gridWidth) return false;
        if (toGridZ < 0 || toGridZ + size > grid.gridHeight) return false;

        // Check if target cells are occupied (ignoring cells occupied by the unit being moved)
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                const targetCell = grid.cells[toGridX + dx][toGridZ + dz];
                if (targetCell.occupied) {
                    // Check if this cell is part of the source unit
                    const isPartOfSource =
                        (toGridX + dx >= fromGridX && toGridX + dx < fromGridX + size) &&
                        (toGridZ + dz >= fromGridZ && toGridZ + dz < fromGridZ + size);
                    if (!isPartOfSource) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Find the origin cell (top-left corner) of a unit at a given position
     * For sphere units, returns the same position
     * For prisma units, finds the top-left corner of the 2x2 area
     */
    public findUnitOrigin(playerId: string, gridX: number, gridZ: number): { x: number; z: number } | null {
        const grid = this.grids.get(playerId);
        if (!grid) return null;

        const cell = grid.cells[gridX]?.[gridZ];
        if (!cell?.occupied || !cell.unitType) return null;

        const unitType = cell.unitType;

        if (unitType === 'sphere') {
            return { x: gridX, z: gridZ };
        }

        // For prisma, find the top-left corner
        // Check all four possible corners and find the one that's actually the origin
        for (let dx = 0; dx >= -1; dx--) {
            for (let dz = 0; dz >= -1; dz--) {
                const checkX = gridX + dx;
                const checkZ = gridZ + dz;
                if (checkX >= 0 && checkZ >= 0) {
                    const checkCell = grid.cells[checkX]?.[checkZ];
                    if (checkCell?.unitType === 'prisma') {
                        // Verify this is actually an origin by checking if all 2x2 cells match
                        const isOrigin =
                            checkX + 1 < grid.gridWidth &&
                            checkZ + 1 < grid.gridHeight &&
                            grid.cells[checkX][checkZ]?.unitType === 'prisma' &&
                            grid.cells[checkX + 1][checkZ]?.unitType === 'prisma' &&
                            grid.cells[checkX][checkZ + 1]?.unitType === 'prisma' &&
                            grid.cells[checkX + 1][checkZ + 1]?.unitType === 'prisma';

                        if (isOrigin) {
                            // Check if this origin's placedUnit matches
                            const hasPlacedUnit = grid.placedUnits.some(
                                u => u.gridX === checkX && u.gridZ === checkZ && u.unitType === 'prisma'
                            );
                            if (hasPlacedUnit) {
                                return { x: checkX, z: checkZ };
                            }
                        }
                    }
                }
            }
        }

        // Fallback: find the origin from placedUnits
        for (const unit of grid.placedUnits) {
            if (unit.unitType === 'prisma') {
                const size = 2;
                if (gridX >= unit.gridX && gridX < unit.gridX + size &&
                    gridZ >= unit.gridZ && gridZ < unit.gridZ + size) {
                    return { x: unit.gridX, z: unit.gridZ };
                }
            }
        }

        return null;
    }

    /**
     * Move a unit from one grid position to another
     */
    public moveUnit(
        playerId: string,
        fromGridX: number,
        fromGridZ: number,
        toGridX: number,
        toGridZ: number
    ): boolean {
        const grid = this.grids.get(playerId);
        if (!grid) return false;

        const cell = grid.cells[fromGridX]?.[fromGridZ];
        if (!cell?.occupied || !cell.unitType) return false;

        const unitType = cell.unitType;

        // Check if move is valid
        if (!this.canMoveUnit(playerId, fromGridX, fromGridZ, toGridX, toGridZ, unitType)) {
            return false;
        }

        const size = unitType === 'sphere' ? 1 : 2;

        // Clear old cells
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                const cx = fromGridX + dx;
                const cz = fromGridZ + dz;
                grid.cells[cx][cz].occupied = false;
                grid.cells[cx][cz].unitType = null;
                if (grid.cells[cx][cz].previewMesh) {
                    grid.cells[cx][cz].previewMesh!.dispose();
                    grid.cells[cx][cz].previewMesh = null;
                }
            }
        }

        // Mark new cells as occupied
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                grid.cells[toGridX + dx][toGridZ + dz].occupied = true;
                grid.cells[toGridX + dx][toGridZ + dz].unitType = unitType;
            }
        }

        // Update placedUnits
        const placedIndex = grid.placedUnits.findIndex(
            u => u.gridX === fromGridX && u.gridZ === fromGridZ
        );
        if (placedIndex !== -1) {
            grid.placedUnits[placedIndex].gridX = toGridX;
            grid.placedUnits[placedIndex].gridZ = toGridZ;
        }

        // Update pendingUnits
        const pendingIndex = grid.pendingUnits.findIndex(
            u => u.gridX === fromGridX && u.gridZ === fromGridZ
        );
        if (pendingIndex !== -1) {
            grid.pendingUnits[pendingIndex].gridX = toGridX;
            grid.pendingUnits[pendingIndex].gridZ = toGridZ;
        }

        // Create new preview mesh
        this.createUnitPreview(playerId, toGridX, toGridZ, unitType, grid);

        this.eventBus.emit<FormationUnitMovedEvent>(GameEvents.FORMATION_UNIT_MOVED, {
            ...createEvent(),
            playerId,
            unitType,
            fromGridX,
            fromGridZ,
            toGridX,
            toGridZ,
        });

        console.log(`[FormationGridSystem] Moved ${unitType} from (${fromGridX}, ${fromGridZ}) to (${toGridX}, ${toGridZ})`);
        return true;
    }

    /**
     * Place a unit on the formation grid
     */
    public placeUnit(playerId: string, gridX: number, gridZ: number, unitType: 'sphere' | 'prisma'): boolean {
        if (!this.canPlaceUnit(playerId, gridX, gridZ, unitType)) {
            return false;
        }

        const grid = this.grids.get(playerId);
        if (!grid) return false;

        const size = unitType === 'sphere' ? 1 : 2;

        // Mark cells as occupied
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                grid.cells[gridX + dx][gridZ + dz].occupied = true;
                grid.cells[gridX + dx][gridZ + dz].unitType = unitType;
            }
        }

        // Add to placed units (persistent) and pending units (for backward compatibility)
        const unitInfo = { unitType, gridX, gridZ };
        grid.placedUnits.push(unitInfo);
        grid.pendingUnits.push(unitInfo);

        // Create preview mesh
        this.createUnitPreview(playerId, gridX, gridZ, unitType, grid);

        this.eventBus.emit<FormationUnitPlacedEvent>(GameEvents.FORMATION_UNIT_PLACED, {
            ...createEvent(),
            playerId,
            unitType,
            gridX,
            gridZ,
        });

        console.log(`[FormationGridSystem] Placed ${unitType} at (${gridX}, ${gridZ})`);
        return true;
    }

    /**
     * Remove a unit from the formation grid
     */
    public removeUnit(playerId: string, gridX: number, gridZ: number): boolean {
        const grid = this.grids.get(playerId);
        if (!grid) return false;

        const cell = grid.cells[gridX]?.[gridZ];
        if (!cell || !cell.occupied) return false;

        const unitType = cell.unitType;
        if (!unitType) return false;

        const size = unitType === 'sphere' ? 1 : 2;

        // Find the origin cell of this unit
        let originX = gridX;
        let originZ = gridZ;

        // For prisma units, find the top-left cell
        if (unitType === 'prisma') {
            for (let dx = 0; dx >= -1; dx--) {
                for (let dz = 0; dz >= -1; dz--) {
                    const checkX = gridX + dx;
                    const checkZ = gridZ + dz;
                    if (checkX >= 0 && checkZ >= 0 &&
                        grid.cells[checkX][checkZ].unitType === 'prisma') {
                        originX = checkX;
                        originZ = checkZ;
                    }
                }
            }
        }

        // Clear cells
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                const cx = originX + dx;
                const cz = originZ + dz;
                if (cx < grid.gridWidth && cz < grid.gridHeight) {
                    grid.cells[cx][cz].occupied = false;
                    grid.cells[cx][cz].unitType = null;
                    if (grid.cells[cx][cz].previewMesh) {
                        grid.cells[cx][cz].previewMesh!.dispose();
                        grid.cells[cx][cz].previewMesh = null;
                    }
                }
            }
        }

        // Remove from pending units
        const index = grid.pendingUnits.findIndex(
            u => u.gridX === originX && u.gridZ === originZ
        );
        if (index !== -1) {
            grid.pendingUnits.splice(index, 1);
        }

        // Remove from placed units
        const placedIndex = grid.placedUnits.findIndex(
            u => u.gridX === originX && u.gridZ === originZ
        );
        if (placedIndex !== -1) {
            grid.placedUnits.splice(placedIndex, 1);
        }

        this.eventBus.emit<FormationUnitRemovedEvent>(GameEvents.FORMATION_UNIT_REMOVED, {
            ...createEvent(),
            playerId,
            gridX: originX,
            gridZ: originZ,
        });

        return true;
    }

    /**
     * Create a preview mesh for a placed unit
     */
    private createUnitPreview(
        playerId: string,
        gridX: number,
        gridZ: number,
        unitType: 'sphere' | 'prisma',
        grid: FormationGrid
    ): void {
        const worldPos = this.gridToWorld(playerId, gridX, gridZ);
        if (!worldPos) return;

        // Offset for prisma (center of 2x2)
        if (unitType === 'prisma') {
            worldPos.x += grid.cellSize / 2;
            worldPos.z += grid.cellSize / 2;
        }

        let mesh: Mesh;
        if (unitType === 'sphere') {
            mesh = MeshBuilder.CreateSphere(
                `preview_${playerId}_${gridX}_${gridZ}`,
                { diameter: 2 },
                this.scene
            );
        } else {
            mesh = MeshBuilder.CreateBox(
                `preview_${playerId}_${gridX}_${gridZ}`,
                { width: 3.5, height: 2.5, depth: 3.5 },
                this.scene
            );
        }

        mesh.position = worldPos;
        mesh.isPickable = false;

        const material = new StandardMaterial(`previewMat_${playerId}_${gridX}_${gridZ}`, this.scene);
        const teamColor = grid.team === TeamTag.Team1
            ? arenaParams.colors.teamA
            : arenaParams.colors.teamB;
        material.diffuseColor = new Color3(teamColor.r, teamColor.g, teamColor.b);
        material.alpha = 0.6;
        mesh.material = material;

        grid.cells[gridX][gridZ].previewMesh = mesh;
    }

    /**
     * Clear the active preview mesh
     */
    private clearPreviewMesh(): void {
        if (this.previewMesh) {
            this.previewMesh.dispose();
            this.previewMesh = null;
        }
    }

    /**
     * Commit all pending units to the battlefield
     * Units spawn preserving their formation grid positions (both X and Z)
     * The grid's X-axis maps to battlefield depth (distance from base)
     * The grid's Z-axis maps to horizontal spread
     * 
     * For Team2 (right side), the formation is rotated 180 degrees so that:
     * - The grid placement is mirrored on both axes
     * - What appears as "front-left" on the grid becomes "front-left" from player's perspective
     */
    public commitFormation(playerId: string): number {
        const grid = this.grids.get(playerId);
        if (!grid) return 0;

        let unitCount = 0;
        const spawnedUnits: { unitId: number; position: Vector3; targetX: number }[] = [];

        // Get spawn area and enemy base position
        const teamConfig = grid.team === TeamTag.Team1 ? arenaParams.teamA : arenaParams.teamB;
        const enemyTeamConfig = grid.team === TeamTag.Team1 ? arenaParams.teamB : arenaParams.teamA;

        const spawnBaseX = teamConfig.spawnArea.x;
        const enemyBaseX = enemyTeamConfig.base.x;

        // Determine direction towards enemy (Team1 goes right +X, Team2 goes left -X)
        const direction = grid.team === TeamTag.Team1 ? 1 : -1;

        // Calculate grid dimensions for relative positioning
        const halfGridWidth = (grid.gridWidth * grid.cellSize) / 2;
        const halfGridHeight = (grid.gridHeight * grid.cellSize) / 2;

        // Deploy ALL units on the grid (placedUnits), not just pending ones
        // Units stay on the grid and are deployed every wave
        for (const placed of grid.placedUnits) {
            // For Team2, we need to mirror the X coordinate so "front" on grid = "front" towards enemy
            // Z coordinate is NOT mirrored - top of grid = top of battlefield for both teams
            let effectiveGridX = placed.gridX;
            let effectiveGridZ = placed.gridZ;
            
            if (grid.team === TeamTag.Team2) {
                // Mirror only X coordinate (front/back relative to enemy)
                // Z stays the same so top of grid = top of battlefield
                effectiveGridX = (grid.gridWidth - 1) - placed.gridX;
            }

            // Calculate relative X offset from grid center (for formation depth)
            // gridX 0 = back row (closest to base), gridX 4 = front row (furthest from base)
            const relativeX = (effectiveGridX + 0.5) * grid.cellSize - halfGridWidth;

            // Calculate relative Z from grid center (horizontal spread)
            let relativeZ = (effectiveGridZ + 0.5) * grid.cellSize - halfGridHeight;
            
            // Offset for prisma (center of 2x2)
            if (placed.unitType === 'prisma') {
                relativeZ += grid.cellSize / 2;
            }

            // Spawn position: base X + relative X offset (adjusted for team direction)
            const spawnX = spawnBaseX + (relativeX * direction);
            const spawnPos = new Vector3(spawnX, 1, relativeZ);

            // Create the unit using the callback (which registers with all systems)
            if (!this.createUnitCallback) {
                console.error('[FormationGridSystem] No createUnitCallback set!');
                continue;
            }

            const unitInfo = this.createUnitCallback(placed.unitType, grid.team, spawnPos);
            spawnedUnits.push({ unitId: unitInfo.id, position: unitInfo.position, targetX: enemyBaseX });
            unitCount++;
        }

        // Clear pending units (they've been synced) but keep placedUnits and preview meshes
        // Units stay on the grid for future waves
        grid.pendingUnits = [];

        // Emit formation committed event with spawned units for move commands
        this.eventBus.emit<FormationCommittedEvent>(GameEvents.FORMATION_COMMITTED, {
            ...createEvent(),
            playerId,
            unitCount,
        });

        // Issue move commands for all spawned units to attack enemy base
        // Use direct callback instead of EventBus to avoid lockstep re-routing
        for (const { unitId, position, targetX } of spawnedUnits) {
            // Move towards enemy base (same Z position to maintain formation)
            const targetPos = new Vector3(targetX, 1, position.z);
            
            if (this.moveUnitCallback) {
                // Use direct callback (for lockstep simulation)
                this.moveUnitCallback(unitId, targetPos);
            } else {
                // Fallback to EventBus (for non-networked testing)
                this.eventBus.emit(GameEvents.MOVE_REQUESTED, {
                    ...createEvent(),
                    entityId: unitId,
                    target: targetPos,
                });
            }
        }

        console.log(`[FormationGridSystem] Committed ${unitCount} units for player ${playerId}, moving towards enemy base`);
        return unitCount;
    }

    /**
     * Get the pending units for a player (units placed but not yet synced)
     */
    public getPendingUnits(playerId: string): { unitType: 'sphere' | 'prisma'; gridX: number; gridZ: number }[] {
        return this.grids.get(playerId)?.pendingUnits ?? [];
    }

    /**
     * Get all placed units for a player (persistent on grid, deployed each wave)
     */
    public getPlacedUnits(playerId: string): { unitType: 'sphere' | 'prisma'; gridX: number; gridZ: number }[] {
        return this.grids.get(playerId)?.placedUnits ?? [];
    }

    /**
     * Get the count of placed units for a player
     */
    public getPlacedUnitCount(playerId: string): number {
        return this.grids.get(playerId)?.placedUnits.length ?? 0;
    }

    /**
     * Get the grid for a player
     */
    public getGrid(playerId: string): FormationGrid | undefined {
        return this.grids.get(playerId);
    }

    /**
     * Cleanup
     */
    public dispose(): void {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];

        // Dispose grid visuals
        for (const meshes of this.gridVisuals.values()) {
            meshes.forEach(m => m.dispose());
        }
        this.gridVisuals.clear();

        // Dispose grid ground planes
        for (const plane of this.gridGroundPlanes.values()) {
            plane.dispose();
        }
        this.gridGroundPlanes.clear();

        // Dispose hover highlight
        if (this.hoverHighlight) {
            this.hoverHighlight.dispose();
            this.hoverHighlight = null;
        }

        // Dispose selected unit highlight
        this.clearSelectedUnitHighlight();
        this.selectedUnitHighlightMaterial?.dispose();
        this.selectedUnitHighlightMaterial = null;

        // Dispose highlight materials
        this.hoverHighlightMaterial?.dispose();
        this.invalidHighlightMaterial?.dispose();

        // Dispose preview meshes
        this.clearPreviewMesh();
        for (const grid of this.grids.values()) {
            for (const row of grid.cells) {
                for (const cell of row) {
                    if (cell.previewMesh) {
                        cell.previewMesh.dispose();
                    }
                }
            }
        }
        this.grids.clear();
    }
}
