import { Scene, FreeCamera, Vector3, KeyboardEventTypes } from "@babylonjs/core";
import { cameraConfig, arenaParams } from "../config/constants";
import { TeamTag } from "../enums/TeamTag";

/**
 * CameraController - RTS-style top-down camera with arrow key movement and touch support
 * Each player has their own camera controller that starts over their base
 */
export class CameraController {
    private scene: Scene;
    private camera: FreeCamera;
    private localTeam: TeamTag;

    // Movement state (keyboard)
    private moveUp: boolean = false;
    private moveDown: boolean = false;
    private moveLeft: boolean = false;
    private moveRight: boolean = false;

    // Touch movement state
    private isTouchDragging: boolean = false;
    private lastTouchX: number = 0;
    private lastTouchY: number = 0;
    private touchVelocityX: number = 0;
    private touchVelocityZ: number = 0;
    private readonly touchSensitivity: number = 0.15;
    private readonly inertiaDecay: number = 0.92;
    private readonly minInertia: number = 0.1;

    // Camera bounds (to prevent going out of arena)
    private minX: number;
    private maxX: number;
    private minZ: number;
    private maxZ: number;

    // Touch event handlers (stored for cleanup)
    private touchStartHandler: ((e: TouchEvent) => void) | null = null;
    private touchMoveHandler: ((e: TouchEvent) => void) | null = null;
    private touchEndHandler: ((e: TouchEvent) => void) | null = null;

    constructor(scene: Scene, localTeam: TeamTag) {
        this.scene = scene;
        this.localTeam = localTeam;

        // Calculate camera bounds based on arena size
        const halfWidth = arenaParams.ground.width / 2;
        const halfHeight = arenaParams.ground.height / 2;
        this.minX = -halfWidth + cameraConfig.boundsPadding;
        this.maxX = halfWidth - cameraConfig.boundsPadding;
        this.minZ = -halfHeight + cameraConfig.boundsPadding;
        this.maxZ = halfHeight - cameraConfig.boundsPadding;

        // Create camera at starting position based on team
        this.camera = this.createCamera();

        // Setup keyboard controls
        this.setupKeyboardControls();

        // Setup touch controls for mobile
        this.setupTouchControls();

        // Start the update loop
        this.setupUpdateLoop();
    }

    /**
     * Create the camera at the appropriate starting position for the team
     */
    private createCamera(): FreeCamera {
        // Determine starting position based on team
        const startX = this.localTeam === TeamTag.Team1
            ? arenaParams.teamA.base.x
            : arenaParams.teamB.base.x;
        const startZ = 0;

        // Create camera at height looking down at an angle
        const camera = new FreeCamera(
            "rtsCamera",
            new Vector3(
                startX,
                cameraConfig.height,
                startZ - cameraConfig.lookAheadOffset
            ),
            this.scene
        );

        // Set target to look at the ground ahead of camera
        camera.setTarget(new Vector3(startX, 0, startZ));

        // Lock camera rotation - RTS cameras don't rotate
        camera.angularSensibility = 0;

        // Disable default keyboard inputs (we'll handle our own)
        camera.inputs.clear();

        return camera;
    }

    /**
     * Setup keyboard event listeners for arrow key movement
     */
    private setupKeyboardControls(): void {
        this.scene.onKeyboardObservable.add((kbInfo) => {
            const pressed = kbInfo.type === KeyboardEventTypes.KEYDOWN;

            switch (kbInfo.event.key) {
                case "ArrowUp":
                case "w":
                case "W":
                    this.moveUp = pressed;
                    kbInfo.event.preventDefault();
                    break;
                case "ArrowDown":
                case "s":
                case "S":
                    this.moveDown = pressed;
                    kbInfo.event.preventDefault();
                    break;
                case "ArrowLeft":
                case "a":
                case "A":
                    this.moveLeft = pressed;
                    kbInfo.event.preventDefault();
                    break;
                case "ArrowRight":
                case "d":
                case "D":
                    this.moveRight = pressed;
                    kbInfo.event.preventDefault();
                    break;
            }
        });
    }

    /**
     * Setup touch event listeners for mobile camera panning
     * Uses two-finger detection to avoid conflicting with unit placement
     */
    private setupTouchControls(): void {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (!canvas) return;

        this.touchStartHandler = (e: TouchEvent) => {
            // Only start camera pan with single finger
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                this.lastTouchX = touch.clientX;
                this.lastTouchY = touch.clientY;
                this.isTouchDragging = true;
                // Stop inertia when starting new touch
                this.touchVelocityX = 0;
                this.touchVelocityZ = 0;
            }
        };

        this.touchMoveHandler = (e: TouchEvent) => {
            if (!this.isTouchDragging || e.touches.length !== 1) return;

            const touch = e.touches[0];
            const deltaX = touch.clientX - this.lastTouchX;
            const deltaY = touch.clientY - this.lastTouchY;

            // Store velocity for inertia (smoothed)
            this.touchVelocityX = deltaX * this.touchSensitivity;
            this.touchVelocityZ = deltaY * this.touchSensitivity;

            // Update last position
            this.lastTouchX = touch.clientX;
            this.lastTouchY = touch.clientY;

            // Apply immediate movement (inverted for natural drag feel)
            this.applyTouchMovement(-this.touchVelocityX, this.touchVelocityZ);
        };

        this.touchEndHandler = (e: TouchEvent) => {
            if (e.touches.length === 0) {
                this.isTouchDragging = false;
                // Invert X velocity for drag direction, Z stays the same
                this.touchVelocityX = -this.touchVelocityX;
                // touchVelocityZ already has correct sign from touchMove
            }
        };

        canvas.addEventListener('touchstart', this.touchStartHandler, { passive: true });
        canvas.addEventListener('touchmove', this.touchMoveHandler, { passive: true });
        canvas.addEventListener('touchend', this.touchEndHandler, { passive: true });
        canvas.addEventListener('touchcancel', this.touchEndHandler, { passive: true });
    }

    /**
     * Apply touch movement to camera position
     */
    private applyTouchMovement(deltaX: number, deltaZ: number): void {
        const newPosition = this.camera.position.clone();
        newPosition.x += deltaX;
        newPosition.z += deltaZ;

        // Clamp to bounds
        newPosition.x = Math.max(this.minX, Math.min(this.maxX, newPosition.x));
        newPosition.z = Math.max(
            this.minZ - cameraConfig.lookAheadOffset,
            Math.min(this.maxZ - cameraConfig.lookAheadOffset, newPosition.z)
        );

        // Update camera position
        this.camera.position = newPosition;

        // Update target to maintain look direction
        const targetPosition = new Vector3(
            newPosition.x,
            0,
            newPosition.z + cameraConfig.lookAheadOffset
        );
        this.camera.setTarget(targetPosition);
    }

    /**
     * Setup the per-frame update loop for camera movement
     */
    private setupUpdateLoop(): void {
        this.scene.onBeforeRenderObservable.add(() => {
            this.update();
        });
    }

    /**
     * Update camera position based on input
     */
    private update(): void {
        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;
        const moveSpeed = cameraConfig.moveSpeed * deltaTime;

        let deltaX = 0;
        let deltaZ = 0;

        // Calculate movement direction from keyboard
        if (this.moveUp) deltaZ += moveSpeed;
        if (this.moveDown) deltaZ -= moveSpeed;
        if (this.moveLeft) deltaX -= moveSpeed;
        if (this.moveRight) deltaX += moveSpeed;

        // Normalize diagonal movement
        if (deltaX !== 0 && deltaZ !== 0) {
            const normalize = 1 / Math.sqrt(2);
            deltaX *= normalize;
            deltaZ *= normalize;
        }

        // Apply keyboard movement if any
        if (deltaX !== 0 || deltaZ !== 0) {
            const newPosition = this.camera.position.clone();
            newPosition.x += deltaX;
            newPosition.z += deltaZ;

            // Clamp to bounds
            newPosition.x = Math.max(this.minX, Math.min(this.maxX, newPosition.x));
            newPosition.z = Math.max(
                this.minZ - cameraConfig.lookAheadOffset,
                Math.min(this.maxZ - cameraConfig.lookAheadOffset, newPosition.z)
            );

            // Update camera position
            this.camera.position = newPosition;

            // Update target to maintain look direction
            const targetPosition = new Vector3(
                newPosition.x,
                0,
                newPosition.z + cameraConfig.lookAheadOffset
            );
            this.camera.setTarget(targetPosition);
        }

        // Apply touch inertia when not actively dragging
        if (!this.isTouchDragging && (Math.abs(this.touchVelocityX) > this.minInertia || Math.abs(this.touchVelocityZ) > this.minInertia)) {
            this.applyTouchMovement(this.touchVelocityX, this.touchVelocityZ);

            // Decay the velocity
            this.touchVelocityX *= this.inertiaDecay;
            this.touchVelocityZ *= this.inertiaDecay;

            // Stop if velocity is too small
            if (Math.abs(this.touchVelocityX) < this.minInertia) this.touchVelocityX = 0;
            if (Math.abs(this.touchVelocityZ) < this.minInertia) this.touchVelocityZ = 0;
        }
    }

    /**
     * Get the camera instance
     */
    public getCamera(): FreeCamera {
        return this.camera;
    }

    /**
     * Move camera to focus on a specific position
     */
    public focusOn(position: Vector3): void {
        const newPosition = new Vector3(
            position.x,
            cameraConfig.height,
            position.z - cameraConfig.lookAheadOffset
        );

        // Clamp to bounds
        newPosition.x = Math.max(this.minX, Math.min(this.maxX, newPosition.x));
        newPosition.z = Math.max(
            this.minZ - cameraConfig.lookAheadOffset,
            Math.min(this.maxZ - cameraConfig.lookAheadOffset, newPosition.z)
        );

        this.camera.position = newPosition;
        this.camera.setTarget(new Vector3(newPosition.x, 0, newPosition.z + cameraConfig.lookAheadOffset));
    }

    /**
     * Dispose of the camera controller
     */
    public dispose(): void {
        // Remove touch event listeners
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (canvas) {
            if (this.touchStartHandler) {
                canvas.removeEventListener('touchstart', this.touchStartHandler);
            }
            if (this.touchMoveHandler) {
                canvas.removeEventListener('touchmove', this.touchMoveHandler);
            }
            if (this.touchEndHandler) {
                canvas.removeEventListener('touchend', this.touchEndHandler);
                canvas.removeEventListener('touchcancel', this.touchEndHandler);
            }
        }

        // Observable cleanup is handled automatically when scene is disposed
        this.camera.dispose();
    }
}
