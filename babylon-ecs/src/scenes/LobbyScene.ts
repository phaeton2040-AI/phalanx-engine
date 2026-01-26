/**
 * Lobby Scene - connection and matchmaking UI for 1v1
 */

import { PhalanxClient } from 'phalanx-client';
import type { MatchFoundEvent, CountdownEvent } from 'phalanx-client';
import { SERVER_URL } from '../config/constants';
import { GameRandom } from '../core/GameRandom';

export class LobbyScene {
  private client: PhalanxClient | null = null;
  private playerId: string;
  private matchData: MatchFoundEvent | null = null;

  // DOM elements
  private lobbyElement: HTMLElement;
  private gameContainer: HTMLElement;
  private usernameInput: HTMLInputElement;
  private connectButton: HTMLButtonElement;
  private statusElement: HTMLElement;

  // Callbacks
  private onGameStart:
    | ((client: PhalanxClient, matchData: MatchFoundEvent) => void)
    | null = null;

  constructor() {
    // Generate unique player ID
    this.playerId = `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Get DOM elements
    this.lobbyElement = document.getElementById('lobby')!;
    this.gameContainer = document.getElementById('game-container')!;
    this.usernameInput = document.getElementById(
      'username'
    ) as HTMLInputElement;
    this.connectButton = document.getElementById(
      'connect-btn'
    ) as HTMLButtonElement;
    this.statusElement = document.getElementById('status')!;

    this.setupEventListeners();
  }

  /**
   * Set callback for game start
   */
  setOnGameStart(
    callback: (client: PhalanxClient, matchData: MatchFoundEvent) => void
  ): void {
    this.onGameStart = callback;
  }

  /**
   * Setup UI event listeners
   */
  private setupEventListeners(): void {
    this.connectButton.addEventListener('click', () => this.handleConnect());

    // Support both keyboard enter and mobile users
    this.usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        // Blur input to close mobile keyboard
        this.usernameInput.blur();
        this.handleConnect();
      }
    });

    // Add touch feedback for better mobile UX
    this.connectButton.addEventListener('touchstart', () => {
      this.connectButton.style.transform = 'scale(0.95)';
    });

    this.connectButton.addEventListener('touchend', () => {
      this.connectButton.style.transform = 'scale(1)';
    });

    this.connectButton.addEventListener('touchcancel', () => {
      this.connectButton.style.transform = 'scale(1)';
    });
  }

  /**
   * Handle connect button click
   */
  private async handleConnect(): Promise<void> {
    const username = this.usernameInput.value.trim();

    if (!username) {
      this.setStatus('Please enter a username', 'error');
      return;
    }

    this.connectButton.disabled = true;
    this.usernameInput.disabled = true;

    try {
      await this.connectToServer(username);
    } catch (error) {
      this.setStatus(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
      this.connectButton.disabled = false;
      this.usernameInput.disabled = false;
    }
  }

  /**
   * Connect to server and start matchmaking
   */
  private async connectToServer(username: string): Promise<void> {
    this.setStatus('Connecting to server...');

    this.client = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: this.playerId,
      username: username,
    });

    // Setup event handlers
    this.client.on('disconnected', () => {
      this.setStatus('Disconnected from server', 'error');
      this.connectButton.disabled = false;
      this.usernameInput.disabled = false;
    });

    this.client.on('error', (error) => {
      this.setStatus(`Error: ${error.message}`, 'error');
    });

    // Connect
    await this.client.connect();
    this.setStatus('Connected! Joining queue...');

    // Join queue
    await this.client.joinQueue();
    this.setStatus('In queue. Waiting for another player...');

    // Wait for match
    this.matchData = await this.client.waitForMatch();
    this.setStatus('Match found! Starting countdown...');

    // Wait for countdown
    await this.client.waitForCountdown((event: CountdownEvent) => {
      this.setStatus(`Game starting in ${event.seconds}...`);
    });

    // Wait for game start and initialize deterministic RNG
    const gameStartEvent = await this.client.waitForGameStart();

    // Initialize deterministic RNG with server-provided seed
    if (gameStartEvent.randomSeed !== undefined) {
      GameRandom.initialize(gameStartEvent.randomSeed);
    } else {
      // Fallback for backward compatibility - use match ID hash
      console.warn(
        '[LobbyScene] No randomSeed in game-start event, using fallback'
      );
      const fallbackSeed =
        this.matchData.matchId
          .split('')
          .reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0) >>>
        0;
      GameRandom.initialize(fallbackSeed);
    }

    // Transition to game scene
    this.transitionToGame();
  }

  /**
   * Transition to game scene
   */
  private transitionToGame(): void {
    this.lobbyElement.style.display = 'none';
    this.gameContainer.style.display = 'block';

    if (this.onGameStart && this.client && this.matchData) {
      this.onGameStart(this.client, this.matchData);
    }
  }

  /**
   * Set status message
   */
  private setStatus(message: string, type: 'info' | 'error' = 'info'): void {
    this.statusElement.textContent = message;
    this.statusElement.style.color = type === 'error' ? '#ff6b6b' : '#ccc';
  }

  /**
   * Show lobby (called when returning from game)
   */
  show(): void {
    this.lobbyElement.style.display = 'flex';
    this.gameContainer.style.display = 'none';
    this.connectButton.disabled = false;
    this.usernameInput.disabled = false;
    this.setStatus('', 'info');
    this.client = null;
    this.matchData = null;
  }
}
