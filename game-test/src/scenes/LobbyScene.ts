/**
 * Lobby Scene - connection and matchmaking UI
 * Using simplified Phalanx Client API
 *
 * This is a simple anonymous authentication flow:
 * - User enters a username (no OAuth required)
 * - Client connects to server with just the username
 * - Server accepts anonymous connections (auth.enabled = false)
 */

import {
  PhalanxClient,
  type MatchFoundEvent,
  type GameStartEvent,
} from 'phalanx-client';
import { SERVER_URL } from '../game/constants';

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
    this.connectButton.addEventListener('click', () => {
      void this.handleConnect();
    });

    this.usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        void this.handleConnect();
      }
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
   * Connect to server and start matchmaking using simplified API
   */
  private async connectToServer(username: string): Promise<void> {
    this.setStatus('Connecting to server...');

    // Create and connect client
    this.client = await PhalanxClient.create({
      serverUrl: SERVER_URL,
      playerId: this.playerId,
      username: username,
      debug: true,
    });

    this.setStatus('Connected! Joining queue...');

    // Subscribe to match found event
    this.client.on('matchFound', (event: MatchFoundEvent) => {
      this.matchData = event;
      this.setStatus('Match found! Starting game...');
    });

    // Subscribe to game start event
    this.client.on('gameStart', (_event: GameStartEvent) => {
      // Transition to game scene
      this.transitionToGame();
    });

    // Subscribe to countdown
    this.client.on('countdown', (event) => {
      this.setStatus(`Starting in ${event.seconds}...`);
    });

    // Subscribe to errors
    this.client.on('error', (error) => {
      this.setStatus(`Error: ${error.message}`, 'error');
    });

    // Subscribe to disconnection
    this.client.on('disconnected', () => {
      this.setStatus('Disconnected from server', 'error');
      this.connectButton.disabled = false;
      this.usernameInput.disabled = false;
    });

    // Join matchmaking queue
    await this.client.joinQueue();
    this.setStatus('In queue. Waiting for another player...');
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

    // Cleanup previous instance
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.matchData = null;
  }
}
