import {
    Scene,
    Vector3,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Mesh,
} from "@babylonjs/core";
import { Entity } from "./Entity";
import {
    ComponentType,
    TeamComponent,
    HealthComponent,
    AttackComponent,
} from "../components";
import { TeamTag } from "../enums/TeamTag";

export interface TowerConfig {
    color: Color3;
    team: TeamTag;
    attackRange?: number;
    attackCooldown?: number;
    attackDamage?: number;
    health?: number;
    debug?: boolean;
}

/**
 * Tower entity - A stationary defensive structure
 * Uses component-based architecture
 */
export class Tower extends Entity {
    private selectionIndicator: Mesh;
    private rangeIndicator: Mesh | null = null;
    private _isSelected: boolean = false;
    private _debug: boolean;
    private _color: Color3;

    constructor(scene: Scene, config: TowerConfig, position: Vector3 = new Vector3(0, 0, 0)) {
        super(scene);

        this._debug = config.debug ?? false;
        this._color = config.color;

        // Create mesh
        this.mesh = this.createMesh();
        this.mesh.position = position.clone();
        this.mesh.position.y = 1.5; // Half height of cone
        this.selectionIndicator = this.createSelectionIndicator();

        // Sync simulation position with mesh position
        this.syncSimulationPosition();

        // Add components
        this.addComponent(new TeamComponent(config.team));
        this.addComponent(new HealthComponent(config.health ?? 150));

        const attackComponent = new AttackComponent({
            range: config.attackRange ?? 12,
            cooldown: config.attackCooldown ?? 0.8,
            damage: config.attackDamage ?? 15,
        });
        // Set attack origin offset to top of tower
        attackComponent.setAttackOriginOffset(new Vector3(0, 1.5, 0));
        this.addComponent(attackComponent);

        if (this._debug) {
            this.createRangeIndicator();
        }
    }

    private createMesh(): Mesh {
        const mesh = MeshBuilder.CreateCylinder(
            `tower_${this.id}`,
            {
                height: 3,
                diameterTop: 0,
                diameterBottom: 2,
                tessellation: 16,
            },
            this.scene
        );

        const material = new StandardMaterial(`towerMat_${this.id}`, this.scene);
        material.diffuseColor = this._color;
        mesh.material = material;

        return mesh;
    }

    private createRangeIndicator(): void {
        const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
        if (!attack) return;

        this.rangeIndicator = MeshBuilder.CreateSphere(
            `towerRange_${this.id}`,
            { diameter: attack.range * 2, segments: 32 },
            this.scene
        );
        this.rangeIndicator.parent = this.mesh;
        this.rangeIndicator.position.y = 0;
        this.rangeIndicator.isPickable = false;

        const material = new StandardMaterial(`towerRangeMat_${this.id}`, this.scene);
        material.diffuseColor = new Color3(1, 0, 0);
        material.alpha = 0.15;
        material.wireframe = true;
        this.rangeIndicator.material = material;
    }

    private createSelectionIndicator(): Mesh {
        const indicator = MeshBuilder.CreateTorus(
            `towerSelCircle_${this.id}`,
            { diameter: 3, thickness: 0.2, tessellation: 32 },
            this.scene
        );
        indicator.scaling.y = 0.01;
        indicator.position.y = -1.45;
        indicator.parent = this.mesh;
        indicator.isVisible = false;
        indicator.isPickable = false;

        const material = new StandardMaterial(`towerSelMat_${this.id}`, this.scene);
        material.diffuseColor = Color3.Green();
        material.emissiveColor = Color3.Green();
        indicator.material = material;

        return indicator;
    }

    // Selection methods
    public get isSelected(): boolean {
        return this._isSelected;
    }

    public select(): void {
        this._isSelected = true;
        this.selectionIndicator.isVisible = true;
    }

    public deselect(): void {
        this._isSelected = false;
        this.selectionIndicator.isVisible = false;
    }

    public canBeSelected(): boolean {
        // In multiplayer, ownership filtering is handled by Game.ts
        // Towers are always selectable from a technical standpoint
        return true;
    }

    // Debug methods
    public get debug(): boolean {
        return this._debug;
    }

    public setDebug(value: boolean): void {
        this._debug = value;
        if (value && !this.rangeIndicator) {
            this.createRangeIndicator();
        } else if (!value && this.rangeIndicator) {
            this.rangeIndicator.dispose();
            this.rangeIndicator = null;
        }
    }

    public override dispose(): void {
        this.selectionIndicator.dispose();
        if (this.rangeIndicator) {
            this.rangeIndicator.dispose();
        }
        super.dispose();
    }
}

