import type { ResourceSystem } from "../systems/ResourceSystem";
import type { FormationGridSystem } from "../systems/FormationGridSystem";

/**
 * Unit type for placement
 */
export type UnitType = 'sphere' | 'prisma' | 'lance';

/**
 * Callback for unit drag operations
 */
export interface UnitDragCallbacks {
    onDragStart: (unitType: UnitType) => void;
    onDragMove: (x: number, y: number) => void;
    onDragEnd: (x: number, y: number) => void;
    onDragCancel: () => void;
}

/**
 * UIManager - Handles all UI interactions and updates
 * 
 * Responsible for:
 * - Notifications (show/hide)
 * - Resource display updates
 * - Unit button states
 * - Wave timer display
 * - Exit/beforeunload handling
 * - Territory indicator
 */
export class UIManager {
    private resourceSystem: ResourceSystem;
    private formationGridSystem: FormationGridSystem;
    private localPlayerId: string;

    // Callbacks
    private onExitCallback: (() => void) | null = null;
    private beforeUnloadHandler: ((e: BeforeUnloadEvent) => string | undefined) | null = null;
    private notificationTimeout: number | null = null;

    // Touch drag state for unit placement
    private dragCallbacks: UnitDragCallbacks | null = null;
    private activeDragUnitType: UnitType | null = null;
    private isDragging: boolean = false;

    constructor(
        resourceSystem: ResourceSystem,
        formationGridSystem: FormationGridSystem,
        localPlayerId: string
    ) {
        this.resourceSystem = resourceSystem;
        this.formationGridSystem = formationGridSystem;
        this.localPlayerId = localPlayerId;
    }

    /**
     * Set exit callback
     */
    public setOnExit(callback: () => void): void {
        this.onExitCallback = callback;
    }

    /**
     * Trigger exit callback
     */
    public triggerExit(): void {
        this.onExitCallback?.();
    }

    /**
     * Setup exit button handler
     */
    public setupExitButton(handleExit: () => void): void {
        const exitBtn = document.getElementById('exit-btn');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => {
                handleExit();
            });
        }
    }

    /**
     * Setup warning when user tries to reload/close the page during game
     */
    public setupBeforeUnloadWarning(): void {
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
    public removeBeforeUnloadWarning(): void {
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
            this.beforeUnloadHandler = null;
        }
    }

    /**
     * Show a notification message
     */
    public showNotification(message: string, type: 'info' | 'warning' = 'info'): void {
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
    public hideNotification(): void {
        const notification = document.getElementById('notification');
        if (notification) {
            notification.className = '';
        }
        this.notificationTimeout = null;
    }

    /**
     * Update player info UI
     */
    public updatePlayerInfoUI(teamColor: string, username: string): void {
        const colorIndicator = document.getElementById('player-color-indicator');
        const playerName = document.getElementById('player-name');

        if (colorIndicator) {
            colorIndicator.style.backgroundColor = teamColor;
        }

        if (playerName) {
            playerName.textContent = `You: ${username}`;
        }
    }

    /**
     * Reset territory indicator to hidden state
     */
    public resetTerritoryIndicator(): void {
        const indicator = document.getElementById('territory-indicator');
        if (indicator) {
            indicator.classList.remove('active');
        }
    }

    /**
     * Show territory indicator
     */
    public showTerritoryIndicator(): void {
        const indicator = document.getElementById('territory-indicator');
        if (indicator) {
            indicator.classList.add('active');
        }
    }

    /**
     * Hide territory indicator
     */
    public hideTerritoryIndicator(): void {
        const indicator = document.getElementById('territory-indicator');
        if (indicator) {
            indicator.classList.remove('active');
        }
    }

    /**
     * Update resource UI display
     */
    public updateResourceUI(): void {
        const resources = this.resourceSystem.getPlayerResources(this.localPlayerId);
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
    public updateUnitButtonStates(): void {
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');
        const lanceBtn = document.getElementById('lance-btn');

        const canAffordSphere = this.resourceSystem.canAfford(this.localPlayerId, 'sphere');
        const canAffordPrisma = this.resourceSystem.canAfford(this.localPlayerId, 'prisma');
        const canAffordLance = this.resourceSystem.canAfford(this.localPlayerId, 'lance');

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

        if (lanceBtn) {
            if (canAffordLance) {
                lanceBtn.classList.remove('disabled');
            } else {
                lanceBtn.classList.add('disabled');
            }
        }
    }

    /**
     * Update wave timer display
     */
    public updateWaveTimer(waveNumber: number, secondsRemaining: number, isPreparationWave: boolean): void {
        const waveLabel = document.getElementById('wave-label');
        const waveTimer = document.getElementById('wave-timer');
        const waveContainer = document.getElementById('wave-container');

        if (waveLabel) {
            if (isPreparationWave) {
                waveLabel.textContent = 'Preparation';
            } else {
                waveLabel.textContent = `Wave ${waveNumber}`;
            }
        }

        if (waveTimer) {
            waveTimer.textContent = `${secondsRemaining}s`;
            
            // Add warning class when time is low
            if (secondsRemaining <= 5) {
                waveTimer.classList.add('warning');
            } else {
                waveTimer.classList.remove('warning');
            }
        }

        if (waveContainer) {
            if (isPreparationWave) {
                waveContainer.classList.add('preparation');
            } else {
                waveContainer.classList.remove('preparation');
            }
        }
    }

    /**
     * Update formation info display (shows how many units will deploy)
     */
    public updateFormationInfo(): void {
        const placedUnits = this.formationGridSystem.getPlacedUnitCount(this.localPlayerId);
        const formationInfo = document.getElementById('formation-info');

        if (formationInfo) {
            formationInfo.textContent = `Units in formation: ${placedUnits}`;
        }
    }

    /**
     * Update commit button state (now just shows formation info, no button needed)
     * @deprecated Use updateFormationInfo instead - waves are automatic now
     */
    public updateCommitButton(): void {
        this.updateFormationInfo();
    }

    /**
     * Set active unit button
     */
    public setActiveUnitButton(unitType: 'sphere' | 'prisma' | 'lance' | null): void {
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');
        const lanceBtn = document.getElementById('lance-btn');

        // Remove active class from all buttons
        sphereBtn?.classList.remove('active');
        prismaBtn?.classList.remove('active');
        lanceBtn?.classList.remove('active');

        // Add active class to specified button
        if (unitType === 'sphere') {
            sphereBtn?.classList.add('active');
        } else if (unitType === 'prisma') {
            prismaBtn?.classList.add('active');
        } else if (unitType === 'lance') {
            lanceBtn?.classList.add('active');
        }
    }

    /**
     * Setup unit placement button handlers
     * Note: Deployment is now automatic via wave system, no commit button needed
     *
     * Desktop: Click to enter placement mode, click on grid to place
     * Mobile: Touch and drag from button to grid, release to place
     */
    public setupUnitPlacementButtons(
        onSphereClick: () => void,
        onPrismaClick: () => void,
        onLanceClick: () => void
    ): void {
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');
        const lanceBtn = document.getElementById('lance-btn');

        // Desktop: click handlers
        sphereBtn?.addEventListener('click', onSphereClick);
        prismaBtn?.addEventListener('click', onPrismaClick);
        lanceBtn?.addEventListener('click', onLanceClick);

        // Mobile: touch drag handlers
        this.setupButtonTouchDrag(sphereBtn, 'sphere');
        this.setupButtonTouchDrag(prismaBtn, 'prisma');
        this.setupButtonTouchDrag(lanceBtn, 'lance');

        // Also add touch feedback to exit button
        const exitBtn = document.getElementById('exit-btn');
        this.addTouchFeedback(exitBtn);
    }

    /**
     * Set callbacks for unit drag operations
     */
    public setDragCallbacks(callbacks: UnitDragCallbacks): void {
        this.dragCallbacks = callbacks;
    }

    /**
     * Setup touch drag handling for a unit button
     */
    private setupButtonTouchDrag(button: HTMLElement | null, unitType: UnitType): void {
        if (!button) return;

        let dragStarted = false;

        button.addEventListener('touchstart', (e: TouchEvent) => {
            if (e.touches.length !== 1) return;

            dragStarted = false;
            this.activeDragUnitType = unitType;

            // Visual feedback
            button.style.transform = 'scale(0.95)';
        }, { passive: true });

        button.addEventListener('touchmove', (e: TouchEvent) => {
            if (e.touches.length !== 1 || !this.activeDragUnitType) return;

            const touch = e.touches[0];

            // Start drag on first move
            if (!dragStarted) {
                dragStarted = true;
                this.isDragging = true;
                this.dragCallbacks?.onDragStart(this.activeDragUnitType);
            }

            // Notify drag move
            this.dragCallbacks?.onDragMove(touch.clientX, touch.clientY);
        }, { passive: true });

        button.addEventListener('touchend', (e: TouchEvent) => {
            button.style.transform = '';

            if (this.isDragging && this.activeDragUnitType) {
                // Get the last touch position from changedTouches
                const touch = e.changedTouches[0];
                if (touch) {
                    this.dragCallbacks?.onDragEnd(touch.clientX, touch.clientY);
                } else {
                    this.dragCallbacks?.onDragCancel();
                }
            }

            this.isDragging = false;
            this.activeDragUnitType = null;
        });

        button.addEventListener('touchcancel', () => {
            button.style.transform = '';

            if (this.isDragging) {
                this.dragCallbacks?.onDragCancel();
            }

            this.isDragging = false;
            this.activeDragUnitType = null;
        });
    }

    /**
     * Add touch feedback to a button element for better mobile UX
     */
    private addTouchFeedback(element: HTMLElement | null): void {
        if (!element) return;

        element.addEventListener('touchstart', () => {
            element.style.transform = 'scale(0.95)';
        });

        element.addEventListener('touchend', () => {
            element.style.transform = '';
        });

        element.addEventListener('touchcancel', () => {
            element.style.transform = '';
        });
    }

    /**
     * Cleanup
     */
    public dispose(): void {
        this.removeBeforeUnloadWarning();
        if (this.notificationTimeout !== null) {
            clearTimeout(this.notificationTimeout);
        }
    }
}
