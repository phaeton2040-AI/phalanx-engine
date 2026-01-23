import {
    Scene,
    Vector3,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Mesh,
    AnimationGroup,
    TransformNode,
    AbstractMesh,
} from "@babylonjs/core";
import { Entity } from "./Entity";
import {
    ComponentType,
    TeamComponent,
    HealthComponent,
    AttackComponent,
    MovementComponent,
    UnitTypeComponent,
    UnitType,
} from "../components";
import { TeamTag } from "../enums/TeamTag";
import { AssetManager } from "../core/AssetManager";
import { BloodEffect } from "../effects/BloodEffect";

/**
 * Animation names for the Mutant model
 */
const MutantAnimations = {
    Idle: "Mutant Idle 2_6",
    Run: "Mutant Run_5",
    Death: "Mutant Dying_3",
    Attack1: "Standing Melee Attack Backhand_2",
    Attack2: "Mutant Swiping_4",
} as const;

export interface MutantUnitConfig {
    color?: Color3;
    team?: TeamTag;
    attackRange?: number;
    detectionRange?: number;
    attackCooldown?: number;
    attackDamage?: number;
    health?: number;
    moveSpeed?: number;
    debug?: boolean;
}

/**
 * Animation state for the Mutant unit
 */
const MutantAnimationState = {
    Idle: "idle",
    Running: "running",
    Attacking: "attacking",
    Dying: "dying",
    Dead: "dead",
} as const;

type MutantAnimationState = typeof MutantAnimationState[keyof typeof MutantAnimationState];

/**
 * MutantUnit entity - A melee combat unit with animated model
 *
 * Features:
 * - GLB model with multiple animations (idle, run, attack, death)
 * - Large detection radius, small attack radius
 * - Two random attack animations
 * - Blood particle effect on damage
 * - Smooth animation transitions
 */
export class MutantUnit extends Entity {
    private selectionIndicator: Mesh;
    private rangeIndicator: Mesh | null = null;
    private _isSelected: boolean = false;
    private _debug: boolean;
    private _color: Color3;
    private _team: TeamTag;

    // Model and animations
    private modelRoot: TransformNode | null = null;
    private modelMeshes: AbstractMesh[] = [];
    private animationGroups: AnimationGroup[] = [];
    private currentAnimState: MutantAnimationState = MutantAnimationState.Idle;
    private isModelLoaded: boolean = false;

    // Attack state
    private isAttacking: boolean = false;
    private pendingDamageCallback: (() => void) | null = null;

    // Placeholder mesh while model loads
    private placeholderMesh: Mesh;

    // Dispose function for the model instance
    private modelDisposeFunc: (() => void) | null = null;

    constructor(scene: Scene, config: MutantUnitConfig = {}, position: Vector3 = new Vector3(0, 0, 0)) {
        super(scene);

        this._debug = config.debug ?? false;
        this._color = config.color ?? new Color3(0.5, 0.3, 0.2);
        this._team = config.team ?? TeamTag.Team1;

        // Create placeholder mesh while model loads
        this.placeholderMesh = this.createPlaceholderMesh();
        this.mesh = this.placeholderMesh;
        this.mesh.position = position.clone();

        this.selectionIndicator = this.createSelectionIndicator();

        // Sync simulation position with mesh position
        this.syncSimulationPosition();

        // Add components - melee unit with big detection, small attack range
        this.addComponent(new TeamComponent(this._team));
        this.addComponent(new HealthComponent(config.health ?? 50));
        this.addComponent(new AttackComponent({
            range: config.attackRange ?? 4, // Small melee attack range
            detectionRange: config.detectionRange ?? 30, // Large detection radius
            cooldown: config.attackCooldown ?? 1.2,
            damage: config.attackDamage ?? 12,
            projectileSpeed: 0, // Melee, no projectile
        }));
        this.addComponent(new MovementComponent(config.moveSpeed ?? 8));
        this.addComponent(new UnitTypeComponent(UnitType.Mutant));

        if (this._debug) {
            this.createRangeIndicator();
        }

        // Load the 3D model
        this.loadModel();
    }

    /**
     * Create a placeholder mesh while the model loads
     * Sized for a 2x2 grid unit
     */
    private createPlaceholderMesh(): Mesh {
        const mesh = MeshBuilder.CreateCapsule(
            `mutant_placeholder_${this.id}`,
            { height: 4, radius: 1.0 },
            this.scene
        );

        const material = new StandardMaterial(`mutantPlaceholderMat_${this.id}`, this.scene);
        material.diffuseColor = this._color;
        material.alpha = 0.5;
        mesh.material = material;

        return mesh;
    }

    /**
     * Load the GLB model from preloaded assets
     * Since assets are preloaded by AssetManager, this is synchronous
     */
    private loadModel(): void {
        const assetManager = AssetManager.getInstance();
        if (!assetManager) {
            console.error("[MutantUnit] AssetManager not initialized");
            return;
        }

        // Create an instance from the preloaded asset
        const instance = assetManager.createInstance("mutant", `mutant_${this.id}`);
        if (!instance) {
            console.error("[MutantUnit] Failed to create model instance");
            return;
        }

        // Store the model data
        this.modelRoot = instance.rootNode;
        this.modelMeshes = instance.meshes;
        this.animationGroups = instance.animationGroups;
        this.modelDisposeFunc = instance.dispose;

        // Parent the model root directly to the placeholder mesh
        this.modelRoot.parent = this.placeholderMesh;

        // Reset local position (relative to parent)
        this.modelRoot.position = Vector3.Zero();

        // Scale the model appropriately for 2x2 grid size
        this.modelRoot.scaling = new Vector3(0.06, 0.06, 0.06);

        // GLB files use rotationQuaternion which overrides rotation (Euler angles)
        // We need to clear it to use rotation.y
        this.modelRoot.rotationQuaternion = null;

        // Rotate the model root to face the correct direction based on team
        // The model faces along Z axis by default, but units move along X axis
        // Team1 faces +X (towards enemy on right) - rotate -90 degrees
        // Team2 faces -X (towards enemy on left) - rotate +90 degrees
        if (this._team === TeamTag.Team1) {
            this.modelRoot.rotation.y = Math.PI / 2; // Face +X
        } else {
            this.modelRoot.rotation.y = -Math.PI / 2; // Face -X
        }


        // Hide placeholder visual but keep it for physics/position tracking
        this.placeholderMesh.visibility = 0;

        // Make meshes pickable and store entity reference
        for (const m of this.modelMeshes) {
            m.isPickable = true;
            // Store reference to parent entity for selection
            (m as unknown as { entityRef: MutantUnit }).entityRef = this;
        }

        // Parent selection indicator to placeholder (which is the main mesh)
        this.selectionIndicator.parent = this.placeholderMesh;
        this.selectionIndicator.position.y = 0.1;

        this.isModelLoaded = true;

        // Start idle animation
        this.playIdleAnimation();
    }

    /**
     * Get animation group by name
     */
    private getAnimation(name: string): AnimationGroup | undefined {
        return this.animationGroups.find(ag => ag.name.includes(name));
    }

    /**
     * Play idle animation
     */
    public playIdleAnimation(): void {
        if (!this.isModelLoaded || this.currentAnimState === MutantAnimationState.Dying) return;
        if (this.currentAnimState === MutantAnimationState.Idle) return;

        this.stopAllAnimations();
        const anim = this.getAnimation(MutantAnimations.Idle);
        if (anim) {
            anim.start(true, 1.0);
            this.currentAnimState = MutantAnimationState.Idle;
        }
    }

    /**
     * Play run animation
     */
    public playRunAnimation(): void {
        if (!this.isModelLoaded || this.currentAnimState === MutantAnimationState.Dying) return;
        if (this.currentAnimState === MutantAnimationState.Running) return;
        if (this.isAttacking) return; // Don't interrupt attack

        this.stopAllAnimations();
        const anim = this.getAnimation(MutantAnimations.Run);
        if (anim) {
            anim.start(true, 1.0);
            this.currentAnimState = MutantAnimationState.Running;
        }
    }

    /**
     * Play a random attack animation
     * @param onHitPoint Callback when damage should be applied (mid-animation)
     * @returns true if attack animation started
     */
    public playAttackAnimation(onHitPoint?: () => void): boolean {
        if (!this.isModelLoaded || this.currentAnimState === MutantAnimationState.Dying) return false;
        if (this.isAttacking) return false;

        // Choose random attack animation
        const attackAnims = [MutantAnimations.Attack1, MutantAnimations.Attack2];
        const randomIndex = Math.floor(Math.random() * attackAnims.length);
        const attackAnimName = attackAnims[randomIndex];

        this.stopAllAnimations();
        const anim = this.getAnimation(attackAnimName);
        if (!anim) return false;

        this.isAttacking = true;
        this.currentAnimState = MutantAnimationState.Attacking;
        this.pendingDamageCallback = onHitPoint ?? null;

        // Start attack animation (no loop)
        anim.start(false, 1.2); // Slightly faster attack

        // Set up hit point detection (at 50% of animation)
        const totalFrames = anim.to - anim.from;
        const hitFrame = anim.from + (totalFrames * 0.5);
        let hitTriggered = false;

        const checkHit = () => {
            if (!anim.isPlaying || hitTriggered) return;

            const currentFrame = anim.animatables[0]?.masterFrame ?? 0;
            if (currentFrame >= hitFrame) {
                hitTriggered = true;
                this.pendingDamageCallback?.();
                this.pendingDamageCallback = null;
            }

            if (anim.isPlaying && !hitTriggered) {
                requestAnimationFrame(checkHit);
            }
        };
        requestAnimationFrame(checkHit);

        // On animation end, return to idle
        anim.onAnimationGroupEndObservable.addOnce(() => {
            this.isAttacking = false;
            if (this.currentAnimState !== MutantAnimationState.Dying) {
                this.playIdleAnimation();
            }
        });

        return true;
    }

    /**
     * Play death animation
     */
    public playDeathAnimation(): void {
        if (!this.isModelLoaded) return;
        if (this.currentAnimState === MutantAnimationState.Dying ||
            this.currentAnimState === MutantAnimationState.Dead) return;

        this.stopAllAnimations();
        const anim = this.getAnimation(MutantAnimations.Death);
        if (anim) {
            anim.start(false, 1.0);
            this.currentAnimState = MutantAnimationState.Dying;

            anim.onAnimationGroupEndObservable.addOnce(() => {
                this.currentAnimState = MutantAnimationState.Dead;
            });
        }
    }

    /**
     * Stop all animations
     */
    private stopAllAnimations(): void {
        for (const anim of this.animationGroups) {
            anim.stop();
        }
    }

    /**
     * Show blood effect when taking damage
     */
    public showBloodEffect(): void {
        const position = this.position.clone();
        position.y += 1; // Blood at chest height
        new BloodEffect(this.scene, position);
    }

    /**
     * Update animation based on movement state
     * Should be called by the game update loop
     */
    public updateAnimation(): void {
        if (!this.isModelLoaded) return;
        if (this.currentAnimState === MutantAnimationState.Dying ||
            this.currentAnimState === MutantAnimationState.Dead) return;
        if (this.isAttacking) return;

        const movement = this.getComponent<MovementComponent>(ComponentType.Movement);
        if (movement?.isMoving) {
            this.playRunAnimation();
        } else {
            this.playIdleAnimation();
        }
    }

    /**
     * Check if the unit is currently attacking
     */
    public get isCurrentlyAttacking(): boolean {
        return this.isAttacking;
    }

    // Note: position updates automatically move the model since it's parented to the placeholder mesh

    private createRangeIndicator(): void {
        const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
        if (!attack) return;

        this.rangeIndicator = MeshBuilder.CreateSphere(
            `mutantRange_${this.id}`,
            { diameter: attack.range * 2, segments: 32 },
            this.scene
        );
        this.rangeIndicator.parent = this.mesh;
        this.rangeIndicator.position.y = 0;
        this.rangeIndicator.isPickable = false;

        const material = new StandardMaterial(`mutantRangeMat_${this.id}`, this.scene);
        material.diffuseColor = new Color3(1, 0.5, 0);
        material.alpha = 0.15;
        material.wireframe = true;
        this.rangeIndicator.material = material;
    }

    private createSelectionIndicator(): Mesh {
        const indicator = MeshBuilder.CreateTorus(
            `mutantSelCircle_${this.id}`,
            { diameter: 5, thickness: 0.25, tessellation: 32 },
            this.scene
        );
        indicator.scaling.y = 0.01;
        indicator.position.y = 0.1;
        indicator.parent = this.mesh;
        indicator.isVisible = false;
        indicator.isPickable = false;

        const material = new StandardMaterial(`mutantSelMat_${this.id}`, this.scene);
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

        // Dispose the model instance (handles animations and meshes)
        if (this.modelDisposeFunc) {
            this.modelDisposeFunc();
            this.modelDisposeFunc = null;
        }


        this.animationGroups = [];
        this.modelMeshes = [];
        this.modelRoot = null;

        // Dispose placeholder
        this.placeholderMesh.dispose();

        super.dispose();
    }
}
