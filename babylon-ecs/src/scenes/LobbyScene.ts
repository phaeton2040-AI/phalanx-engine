/**
 * Lobby Scene - connection and matchmaking UI for 1v1
 */

import { PhalanxClient } from 'phalanx-client';
import { AuthManager, type AuthUser } from 'phalanx-client/auth';
import type { MatchFoundEvent, CountdownEvent } from 'phalanx-client';
import { SERVER_URL, authConfig } from '../config/constants';
import { GameRandom } from '../core/GameRandom';

export class LobbyScene {
  private client: PhalanxClient | null = null;
  private authManager: AuthManager | null = null;
  private playerId: string;
  private matchData: MatchFoundEvent | null = null;

  // Auth state
  private isAuthenticated = false;
  private currentUser: AuthUser | null = null;
  private authToken: string | null = null;

  // DOM elements
  private lobbyElement: HTMLElement;
  private gameContainer: HTMLElement;
  private connectButton: HTMLButtonElement;
  private signInButton: HTMLButtonElement;
  private userInfoElement: HTMLElement;
  private statusElement: HTMLElement;

  // Callbacks
  private onGameStart:
    | ((client: PhalanxClient, matchData: MatchFoundEvent) => void)
    | null = null;

  constructor() {
    // Generate unique player ID (will be replaced by auth user ID when signed in)
    this.playerId = `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Get DOM elements
    this.lobbyElement = document.getElementById('lobby')!;
    this.gameContainer = document.getElementById('game-container')!;
    this.connectButton = document.getElementById(
      'connect-btn'
    ) as HTMLButtonElement;
    this.signInButton = document.getElementById(
      'sign-in-btn'
    ) as HTMLButtonElement;
    this.userInfoElement = document.getElementById('user-info')!;
    this.statusElement = document.getElementById('status')!;

    this.setupEventListeners();
    this.initializeAuth();
  }

  /**
   * Initialize authentication
   */
  private initializeAuth(): void {
    if (!authConfig.authEnabled || !authConfig.googleClientId) {
      console.warn('[LobbyScene] Auth disabled - no Google Client ID configured');
      this.updateUIForAuthState();
      return;
    }

    this.authManager = new AuthManager({
      provider: 'google',
      google: {
        clientId: authConfig.googleClientId,
        scopes: ['openid', 'profile', 'email'],
        // Use root URL as redirect URI
        redirectUri: window.location.origin,
        // Use backend for token exchange (keeps client_secret secure on server)
        tokenExchangeUrl: authConfig.tokenExchangeUrl,
      },
      onAuthStateChange: (state) => {
        console.log('[LobbyScene] Auth state changed:', state);
        this.isAuthenticated = state.isAuthenticated;
        this.currentUser = state.user;
        this.authToken = state.token;

        if (state.user) {
          this.playerId = state.user.id;
        }

        this.updateUIForAuthState();
      },
      onAuthError: (error) => {
        console.error('[LobbyScene] Auth error:', error);
        this.setStatus(`Auth error: ${error.message}`, 'error');
        this.signInButton.disabled = false;
      },
    });

    // Handle OAuth callback if we're returning from a redirect
    void this.handleAuthCallback().then(() => {
      // After handling callback, check for existing session
      return this.authManager!.checkSession();
    }).then((hasSession) => {
      if (hasSession) {
        console.log('[LobbyScene] Session active');
      }
    });
  }

  /**
   * Handle OAuth callback from redirect.
   * This is called when user returns from Google OAuth.
   */
  private async handleAuthCallback(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    // Check if this is an OAuth callback (has code or error)
    if (!code && !error) {
      return;
    }

    console.log('[LobbyScene] Handling OAuth callback...');
    this.setStatus('Completing sign-in...', 'info');

    try {
      if (this.authManager) {
        const result = await this.authManager.handleCallback({
          code: code || undefined,
          state: state || undefined,
          error: error || undefined,
          errorDescription: params.get('error_description') || undefined,
          url: window.location.href,
        });

        if (result.valid) {
          this.setStatus('Signed in successfully!', 'info');
        } else {
          this.setStatus(result.error || 'Sign in failed', 'error');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      this.setStatus(message, 'error');
    }

    // Clean up URL by removing OAuth params
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }


  /**
   * Update UI based on authentication state
   */
  private updateUIForAuthState(): void {
    if (!authConfig.authEnabled) {
      // Auth disabled - show connect button directly (dev mode)
      this.signInButton.style.display = 'none';
      this.userInfoElement.style.display = 'none';
      this.connectButton.style.display = 'block';
      this.connectButton.textContent = 'Find Match (Dev Mode)';
      return;
    }

    if (this.isAuthenticated && this.currentUser) {
      // Signed in - show user info and Find Game button
      this.signInButton.style.display = 'none';

      // Update user info display
      this.userInfoElement.style.display = 'flex';
      const avatarImg = this.userInfoElement.querySelector('#user-avatar') as HTMLImageElement;
      const userName = this.userInfoElement.querySelector('#user-name') as HTMLSpanElement;
      const signOutBtn = this.userInfoElement.querySelector('#sign-out-btn') as HTMLButtonElement;

      if (avatarImg && this.currentUser.avatarUrl) {
        avatarImg.src = this.currentUser.avatarUrl;
        avatarImg.style.display = 'block';
      }
      if (userName) {
        userName.textContent = this.currentUser.username || this.currentUser.email || 'Player';
      }
      if (signOutBtn) {
        signOutBtn.onclick = () => void this.handleSignOut();
      }

      // Show Find Game button
      this.connectButton.style.display = 'block';
      this.connectButton.textContent = 'Find Game';
      this.connectButton.disabled = false;

      this.setStatus('', 'info');
    } else {
      // Not signed in - show Sign In button
      this.signInButton.style.display = 'flex';
      this.userInfoElement.style.display = 'none';
      this.connectButton.style.display = 'none';

      this.setStatus('Sign in to play', 'info');
    }
  }

  /**
   * Handle sign in button click - uses redirect flow
   */
  private handleSignIn(): void {
    if (!this.authManager) {
      this.setStatus('Auth not configured', 'error');
      return;
    }

    this.signInButton.disabled = true;
    this.setStatus('Redirecting to sign-in...', 'info');

    // Use redirect flow (more reliable than popup which is often blocked)
    this.authManager.login();
  }

  /**
   * Handle sign out
   */
  private async handleSignOut(): Promise<void> {
    if (this.authManager) {
      await this.authManager.logout();
    }

    // Reset state
    this.isAuthenticated = false;
    this.currentUser = null;
    this.authToken = null;
    this.playerId = `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.updateUIForAuthState();
    this.setStatus('Signed out', 'info');
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

    this.signInButton.addEventListener('click', () => {
      this.handleSignIn();
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

    // Touch feedback for sign-in button
    this.signInButton.addEventListener('touchstart', () => {
      this.signInButton.style.transform = 'scale(0.95)';
    });

    this.signInButton.addEventListener('touchend', () => {
      this.signInButton.style.transform = 'scale(1)';
    });

    this.signInButton.addEventListener('touchcancel', () => {
      this.signInButton.style.transform = 'scale(1)';
    });
  }

  /**
   * Handle connect button click
   */
  private async handleConnect(): Promise<void> {
    // Get username from auth or input field
    let username: string;

    if (authConfig.authEnabled && this.isAuthenticated && this.currentUser) {
      username = this.currentUser.username || this.currentUser.email || 'Player';
    } else {
      username = this.usernameInput.value.trim();
      if (!username) {
        this.setStatus('Please enter a username', 'error');
        return;
      }
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
      authToken: this.authToken || undefined,
    });

    // Setup event handlers
    this.client.on('disconnected', () => {
      this.setStatus('Disconnected from server', 'error');
      this.connectButton.disabled = false;
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
    this.signInButton.disabled = false;
    this.setStatus('', 'info');
    this.client = null;
    this.matchData = null;

    // Refresh auth state
    this.updateUIForAuthState();
  }
}
