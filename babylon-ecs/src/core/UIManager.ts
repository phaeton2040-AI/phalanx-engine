import type { ResourceSystem } from "../systems/ResourceSystem";
import type { FormationGridSystem } from "../systems/FormationGridSystem";

/**
 * UIManager - Handles all UI interactions and updates
 * 
 * Responsible for:
 * - Notifications (show/hide)
 * - Resource display updates
 * - Unit button states
 * - Commit button state
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

        const canAffordSphere = this.resourceSystem.canAfford(this.localPlayerId, 'sphere');
        const canAffordPrisma = this.resourceSystem.canAfford(this.localPlayerId, 'prisma');

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
    public updateCommitButton(): void {
        const commitBtn = document.getElementById('commit-btn') as HTMLButtonElement;
        const pendingUnits = this.formationGridSystem.getPendingUnits(this.localPlayerId);

        if (commitBtn) {
            commitBtn.textContent = `Deploy Units (${pendingUnits.length})`;
            commitBtn.disabled = pendingUnits.length === 0;
        }
    }

    /**
     * Set active unit button
     */
    public setActiveUnitButton(unitType: 'sphere' | 'prisma' | null): void {
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');

        // Remove active class from both buttons
        sphereBtn?.classList.remove('active');
        prismaBtn?.classList.remove('active');

        // Add active class to specified button
        if (unitType === 'sphere') {
            sphereBtn?.classList.add('active');
        } else if (unitType === 'prisma') {
            prismaBtn?.classList.add('active');
        }
    }

    /**
     * Setup unit placement button handlers
     */
    public setupUnitPlacementButtons(
        onSphereClick: () => void,
        onPrismaClick: () => void,
        onCommitClick: () => void
    ): void {
        const sphereBtn = document.getElementById('sphere-btn');
        const prismaBtn = document.getElementById('prisma-btn');
        const commitBtn = document.getElementById('commit-btn');

        sphereBtn?.addEventListener('click', onSphereClick);
        prismaBtn?.addEventListener('click', onPrismaClick);
        commitBtn?.addEventListener('click', onCommitClick);
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
