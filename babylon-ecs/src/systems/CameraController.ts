import { Scene, FreeCamera, Vector3, KeyboardEventTypes } from "@babylonjs/core";
import { cameraConfig, arenaParams } from "../config/constants";
import { TeamTag } from "../enums/TeamTag";

/**
 * CameraController - RTS-style top-down camera with arrow key movement
 * Each player has their own camera controller that starts over their base
 */
export class CameraController {
    private scene: Scene;
    private camera: FreeCamera;
    private localTeam: TeamTag;

    // Movement state
    private moveUp: boolean = false;
    private moveDown: boolean = false;
    private moveLeft: boolean = false;
    private moveRight: boolean = false;

    // Camera bounds (to prevent going out of arena)
    private minX: number;
    private maxX: number;
    private minZ: number;
    private maxZ: number;

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

        // Calculate movement direction
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

        // Apply movement if any
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
        // Observable cleanup is handled automatically when scene is disposed
        this.camera.dispose();
    }
}
