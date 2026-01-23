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
import { GameRandom } from "../core/GameRandom";
import { BloodEffect } from "../effects/BloodEffect";
import type { IPhysicsIgnorable } from "../interfaces";
import type { ICombatant, IDeathSequence, IAnimated } from "../interfaces";

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
 *
 * Implements:
 * - IPhysicsIgnorable: Physics system ignores dying units
 * - ICombatant: Combat animation and state management
 * - IDeathSequence: Death animation handling
 * - IAnimated: Per-frame animation updates
 */
export class MutantUnit extends Entity implements IPhysicsIgnorable, ICombatant, IDeathSequence, IAnimated {
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

    // Attack state (visual animation)
    private isAttacking: boolean = false;
    private pendingDamageCallback: (() => void) | null = null;
    private lastAttackAnimIndex: number = -1; // Track last attack anim to alternate

    // Deterministic attack lock timer (for simulation - prevents movement during attack)
    // This is separate from visual animation to ensure determinism across clients
    private attackLockTimer: number = 0;
    private readonly attackLockDuration: number = 0.8; // Seconds to lock movement after attack starts

    // Combat state - when true, chain attacks without going to idle
    private _isInCombat: boolean = false;

    // Death sequence state
    private _isDying: boolean = false;
    private onDeathAnimationComplete: (() => void) | null = null;

    // Animation sync flag - set when movement starts to force run animation
    private _shouldForceRunAnimation: boolean = false;

    // Rotation interpolation
    private targetRotationY: number | null = null;
    private readonly rotationSpeed: number = 8.0; // Radians per second

    // Animation blending
    private readonly animationBlendSpeed: number = 0.15; // Blend weight per frame (0-1)

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
     * Sized for a 2x2 grid unit with wider collision radius to prevent mesh intersection
     */
    private createPlaceholderMesh(): Mesh {
        const mesh = MeshBuilder.CreateCapsule(
            `mutant_placeholder_${this.id}`,
            { height: 4, radius: 8.0 },
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
     * Play idle animation with crossfade
     */
    public playIdleAnimation(): void {
        if (!this.isModelLoaded) return;
        if (this._isDying || this.currentAnimState === MutantAnimationState.Dying) return;
        if (this.currentAnimState === MutantAnimationState.Idle) return;

        const anim = this.getAnimation(MutantAnimations.Idle);
        if (anim) {
            this.crossFadeToAnimation(anim, true, 1.0);
            this.currentAnimState = MutantAnimationState.Idle;
        }
    }

    /**
     * Play run animation with crossfade
     */
    public playRunAnimation(): void {
        if (!this.isModelLoaded) return;
        if (this._isDying || this.currentAnimState === MutantAnimationState.Dying) return;
        if (this.currentAnimState === MutantAnimationState.Running) return;
        if (this.isAttacking) return; // Don't interrupt attack animation

        const anim = this.getAnimation(MutantAnimations.Run);
        if (anim) {
            this.crossFadeToAnimation(anim, true, 1.0);
            this.currentAnimState = MutantAnimationState.Running;
        }
    }

    /**
     * Play attack animation with crossfade
     * Chains attack animations when in combat (alternates between Attack1 and Attack2)
     * Damage is dealt once per animation at the hit point (50% of animation)
     * @param onDealDamage Callback to deal damage - called at animation hit point
     * @returns true if attack animation started
     */
    public playAttackAnimation(onDealDamage?: () => void): boolean {
        if (!this.isModelLoaded) return false;
        if (this._isDying || this.currentAnimState === MutantAnimationState.Dying) return false;

        // If already attacking, don't start another attack
        // This makes animation length act as natural cooldown
        if (this.isAttacking) return false;

        // Alternate between attack animations for variety
        const attackAnims = [MutantAnimations.Attack1, MutantAnimations.Attack2];
        let animIndex: number;

        if (GameRandom.isInitialized()) {
            // Use deterministic random but try to alternate
            if (this.lastAttackAnimIndex === -1) {
                animIndex = GameRandom.intRange(0, attackAnims.length - 1);
            } else {
                // Alternate to the other animation
                animIndex = (this.lastAttackAnimIndex + 1) % attackAnims.length;
            }
        } else {
            animIndex = (this.lastAttackAnimIndex + 1) % attackAnims.length;
        }

        this.lastAttackAnimIndex = animIndex;
        const attackAnimName = attackAnims[animIndex];

        const anim = this.getAnimation(attackAnimName);
        if (!anim) return false;

        // Mark as attacking and in combat
        this.isAttacking = true;
        this._isInCombat = true;
        this.currentAnimState = MutantAnimationState.Attacking;

        // Store the damage callback
        this.pendingDamageCallback = onDealDamage ?? null;

        // Use crossfade to smoothly transition to attack animation
        this.crossFadeToAnimation(anim, false, 1.2);

        // Set up ONE-TIME damage at hit point (50% of animation)
        const totalFrames = anim.to - anim.from;
        const hitFrame = anim.from + (totalFrames * 0.5);
        let damageDealt = false;

        const checkHit = () => {
            // Stop checking if animation stopped or damage already dealt or dying
            if (!anim.isPlaying || damageDealt || this._isDying) {
                return;
            }

            const currentFrame = anim.animatables[0]?.masterFrame ?? 0;
            if (currentFrame >= hitFrame && !damageDealt) {
                damageDealt = true;
                // Call the damage callback NOW at hit point
                if (this.pendingDamageCallback) {
                    this.pendingDamageCallback();
                    this.pendingDamageCallback = null;
                }
            }

            if (anim.isPlaying && !damageDealt) {
                requestAnimationFrame(checkHit);
            }
        };
        requestAnimationFrame(checkHit);

        // On animation end, allow next attack or transition out
        anim.onAnimationGroupEndObservable.addOnce(() => {
            // Clear pending callback if not used (e.g., target died before hit point)
            this.pendingDamageCallback = null;

            // Don't transition if dying
            if (this._isDying || this.currentAnimState === MutantAnimationState.Dying) {
                this.isAttacking = false;
                this._isInCombat = false;
                return;
            }

            // Clear attacking flag to allow next attack
            this.isAttacking = false;

            // Don't go to idle - stay in attacking state
            // Combat system will either trigger another attack or movement will resume
            // The updateAnimation() will handle transition to run/idle if we leave combat
        });

        return true;
    }

    /**
     * Signal that combat has ended (no more targets in range)
     * This allows transition back to idle/run
     */
    public endCombat(): void {
        this._isInCombat = false;
    }

    /**
     * Check if unit is currently in combat mode
     */
    public get isInCombat(): boolean {
        return this._isInCombat;
    }

    // ==========================================
    // IPhysicsIgnorable Implementation
    // ==========================================

    /**
     * Check if physics should ignore this entity.
     * Returns true when the unit is dying.
     */
    public shouldIgnorePhysics(): boolean {
        return this._isDying;
    }

    // ==========================================
    // IDeathSequence Implementation
    // ==========================================

    /**
     * Check if the unit is currently dying (playing death animation)
     */
    public get isDying(): boolean {
        return this._isDying;
    }

    /**
     * Start the death sequence
     * @param onComplete Callback when death animation finishes and unit should be removed
     */
    public startDeathSequence(onComplete: () => void): void {
        if (this._isDying) return;

        this._isDying = true;
        this.onDeathAnimationComplete = onComplete;

        // Stop any current actions
        this.isAttacking = false;
        this.attackLockTimer = 0;
        this.targetRotationY = null; // Stop any rotation interpolation

        // Stop movement
        const movement = this.getComponent<MovementComponent>(ComponentType.Movement);
        if (movement) {
            movement.stop();
        }

        // Play death animation
        this.playDeathAnimation();
    }

    /**
     * Play death animation
     */
    private playDeathAnimation(): void {
        if (!this.isModelLoaded) {
            // If model not loaded, complete immediately
            this.onDeathAnimationComplete?.();
            return;
        }

        if (this.currentAnimState === MutantAnimationState.Dying ||
            this.currentAnimState === MutantAnimationState.Dead) return;

        this.stopAllAnimations();
        const anim = this.getAnimation(MutantAnimations.Death);
        if (anim) {
            anim.start(false, 1.0);
            this.currentAnimState = MutantAnimationState.Dying;

            anim.onAnimationGroupEndObservable.addOnce(() => {
                this.currentAnimState = MutantAnimationState.Dead;
                // Call the completion callback to remove the unit
                this.onDeathAnimationComplete?.();
            });
        } else {
            // No animation found, complete immediately
            this.onDeathAnimationComplete?.();
        }
    }

    /**
     * Stop all animations immediately (used for death)
     */
    private stopAllAnimations(): void {
        for (const anim of this.animationGroups) {
            anim.stop();
        }
    }

    /**
     * Crossfade to a target animation for smooth transitions
     * @param targetAnim Animation to transition to
     * @param loop Whether the target animation should loop
     * @param speed Playback speed of the target animation
     */
    private crossFadeToAnimation(targetAnim: AnimationGroup, loop: boolean, speed: number = 1.0): void {
        // Start the target animation if not already playing
        if (!targetAnim.isPlaying) {
            targetAnim.start(loop, speed);
            targetAnim.setWeightForAllAnimatables(0);
        }

        // Fade out other animations while fading in target
        const fadeIn = () => {
            let allFaded = true;

            for (const anim of this.animationGroups) {
                if (anim === targetAnim) {
                    // Fade in target animation
                    const currentWeight = anim.animatables[0]?.weight ?? 0;
                    const newWeight = Math.min(1, currentWeight + this.animationBlendSpeed);
                    anim.setWeightForAllAnimatables(newWeight);
                    if (newWeight < 1) allFaded = false;
                } else if (anim.isPlaying) {
                    // Fade out other animations
                    const currentWeight = anim.animatables[0]?.weight ?? 1;
                    const newWeight = Math.max(0, currentWeight - this.animationBlendSpeed);
                    anim.setWeightForAllAnimatables(newWeight);
                    if (newWeight > 0) {
                        allFaded = false;
                    } else {
                        anim.stop();
                    }
                }
            }

            if (!allFaded && targetAnim.isPlaying) {
                requestAnimationFrame(fadeIn);
            }
        };

        requestAnimationFrame(fadeIn);
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
        if (this._isDying || this.currentAnimState === MutantAnimationState.Dying ||
            this.currentAnimState === MutantAnimationState.Dead) return;

        // Check if we need to force run animation (set by combat system when movement starts)
        // This takes priority over other checks to ensure smooth transition from combat to run
        if (this._shouldForceRunAnimation) {
            this._shouldForceRunAnimation = false;
            // Force run animation - bypass isAttacking check since combat just ended
            this.forcePlayRunAnimation();
            return;
        }

        // Don't interrupt active attack animation
        if (this.isAttacking) return;

        // Don't transition to idle while in combat - stay in attack state
        // Combat system will trigger next attack
        if (this._isInCombat) return;

        if (this.currentAnimState !== MutantAnimationState.Running) {
            this.playRunAnimation();
        }
    }

    /**
     * Force play run animation - used when transitioning from combat to movement
     * Bypasses normal checks to ensure immediate transition
     */
    private forcePlayRunAnimation(): void {
        if (!this.isModelLoaded) return;
        if (this._isDying || this.currentAnimState === MutantAnimationState.Dying) return;
        if (this.currentAnimState === MutantAnimationState.Running) return;

        // Clear combat state
        this._isInCombat = false;
        this.isAttacking = false;

        const anim = this.getAnimation(MutantAnimations.Run);
        if (anim) {
            this.crossFadeToAnimation(anim, true, 1.0);
            this.currentAnimState = MutantAnimationState.Running;
        }
    }

    /**
     * Check if the unit is currently attack-locked (deterministic for simulation)
     * Uses timer for deterministic network sync, but also checks visual animation state
     * to ensure smooth visuals (no movement during attack animation)
     */
    public get isCurrentlyAttacking(): boolean {
        return this.attackLockTimer > 0 || this.isAttacking;
    }

    /**
     * Start the attack lock timer (called when attack is performed)
     * This ensures movement is blocked for a deterministic duration
     */
    public startAttackLock(): void {
        this.attackLockTimer = this.attackLockDuration;
    }

    /**
     * Update the attack lock timer (called during simulation tick)
     * @param deltaTime Fixed timestep from simulation
     */
    public updateAttackLock(deltaTime: number): void {
        if (this.attackLockTimer > 0) {
            this.attackLockTimer = Math.max(0, this.attackLockTimer - deltaTime);
        }
    }

    /**
     * Orient the mutant to face a target position (smooth interpolation)
     * @param targetPosition The position to face toward
     */
    public orientToTarget(targetPosition: Vector3): void {
        if (!this.modelRoot) return;

        // Calculate direction from mutant to target
        const direction = targetPosition.subtract(this.position);
        direction.y = 0; // Ignore vertical difference

        if (direction.lengthSquared() < 0.001) return; // Too close, skip rotation

        // Calculate the angle to face the target
        // atan2(x, z) gives the angle from the positive Z axis to the direction vector
        // The model's default forward is along Z axis, so we use this angle directly
        this.targetRotationY = Math.atan2(direction.x, direction.z);
    }

    /**
     * Update rotation interpolation for smooth orientation changes
     * Should be called every frame with deltaTime in seconds
     */
    public updateRotation(deltaTime: number): void {
        if (!this.modelRoot || this.targetRotationY === null) return;

        // Clear quaternion if set
        this.modelRoot.rotationQuaternion = null;

        const currentRotation = this.modelRoot.rotation.y;
        let targetRotation = this.targetRotationY;

        // Calculate the shortest rotation direction
        let diff = targetRotation - currentRotation;

        // Normalize to [-PI, PI] for shortest path
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Check if we're close enough to snap
        const snapThreshold = 0.01;
        if (Math.abs(diff) < snapThreshold) {
            this.modelRoot.rotation.y = targetRotation;
            this.targetRotationY = null; // Clear target, we've reached it
            return;
        }

        // Interpolate towards target rotation
        const maxRotation = this.rotationSpeed * deltaTime;
        const rotationStep = Math.sign(diff) * Math.min(Math.abs(diff), maxRotation);

        this.modelRoot.rotation.y = currentRotation + rotationStep;
    }

    /**
     * Orient the mutant along its movement direction (based on team)
     * Team1 moves towards +X, Team2 moves towards -X
     * Also triggers run animation
     */
    public orientToMovementDirection(): void {
        if (!this.modelRoot) return;

        // Set target rotation for smooth interpolation
        // Team1 faces +X (towards enemy on right) - rotate to face +X
        // Team2 faces -X (towards enemy on left) - rotate to face -X
        if (this._team === TeamTag.Team1) {
            this.targetRotationY = Math.PI / 2; // Face +X
        } else {
            this.targetRotationY = -Math.PI / 2; // Face -X
        }

        // Force run animation on next update
        this._shouldForceRunAnimation = true;
    }

    /**
     * Notify that movement has started - triggers run animation
     * Called by combat system when resuming movement
     */
    public notifyMovementStarted(): void {
        this._shouldForceRunAnimation = true;
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
