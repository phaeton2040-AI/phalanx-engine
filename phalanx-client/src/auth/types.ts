/**
 * Phalanx Auth Types
 *
 * Type definitions for the managed OAuth authentication system.
 */

// ============================================
// Auth Adapter Interface
// ============================================

/**
 * Interface that all OAuth adapters must implement.
 * Provides a consistent API for different OAuth providers.
 */
export interface AuthAdapter {
  /** The provider name (e.g., 'google', 'discord', 'steam') */
  readonly provider: string;

  /**
   * Generate the OAuth authorization URL.
   * User will be redirected to this URL to authenticate.
   */
  getLoginUrl(options?: LoginOptions): string;

  /**
   * Handle the OAuth callback.
   * Called when user is redirected back from OAuth provider.
   */
  handleCallback(params: CallbackParams): Promise<AuthResult>;

  /**
   * Refresh an expired token.
   * Returns null if refresh is not supported or refresh token is invalid.
   */
  refreshToken(refreshToken: string): Promise<AuthResult | null>;

  /**
   * Revoke the token (logout from provider).
   * Optional - not all providers support token revocation.
   */
  revokeToken?(token: string): Promise<void>;

  /**
   * Check if this adapter supports the given token.
   * Used for multi-provider setups to route tokens to correct adapter.
   */
  canHandle?(token: string): boolean;
}

// ============================================
// Login Options
// ============================================

/**
 * Options for initiating the login flow.
 */
export interface LoginOptions {
  /** Override the redirect URI */
  redirectUri?: string;

  /** Additional OAuth scopes */
  scopes?: string[];

  /** Login hint (email) to pre-fill */
  loginHint?: string;

  /** Force account selection even if already logged in */
  prompt?: 'none' | 'consent' | 'select_account';

  /** Custom state parameter (default: random) */
  state?: string;

  /** Nonce for ID token validation */
  nonce?: string;
}

// ============================================
// Callback Parameters
// ============================================

/**
 * Parameters received from OAuth provider callback.
 */
export interface CallbackParams {
  /** Authorization code from OAuth provider */
  code?: string;

  /** State parameter for CSRF validation */
  state?: string;

  /** Error code if auth failed */
  error?: string;

  /** Error description */
  errorDescription?: string;

  /** Full URL (for parsing) */
  url?: string;
}

// ============================================
// Auth Result
// ============================================

/**
 * Result of an authentication attempt.
 */
export interface AuthResult {
  /** Whether authentication was successful */
  valid: boolean;

  // User info (present when valid=true)
  /** Unique player ID from the provider */
  playerId?: string;
  /** Display username */
  username?: string;
  /** Email address */
  email?: string;
  /** URL to user's avatar image */
  avatarUrl?: string;

  // Token info (present when valid=true)
  /** Provider name */
  provider?: string;
  /** ID token or access token (main token for auth) */
  token?: string;
  /** Access token for API calls */
  accessToken?: string;
  /** Refresh token for token refresh */
  refreshToken?: string;
  /** Token expiration timestamp in milliseconds */
  expiresAt?: number;

  // Error info (present when valid=false)
  /** Human-readable error message */
  error?: string;
  /** Error code */
  errorCode?: string;
}

// ============================================
// Auth User
// ============================================

/**
 * Authenticated user information.
 */
export interface AuthUser {
  /** Unique user ID from the provider */
  id: string;
  /** Display username */
  username?: string;
  /** Email address */
  email?: string;
  /** URL to user's avatar image */
  avatarUrl?: string;
  /** OAuth provider name */
  provider: string;
}

// ============================================
// Auth State
// ============================================

/**
 * Current authentication state.
 */
export interface AuthState {
  /** Whether user is currently authenticated */
  isAuthenticated: boolean;
  /** Whether auth check is in progress */
  isLoading: boolean;
  /** Authenticated user info (null if not authenticated) */
  user: AuthUser | null;
  /** Current auth token (null if not authenticated) */
  token: string | null;
  /** Token expiration timestamp in milliseconds */
  expiresAt: number | null;
  /** OAuth provider name */
  provider: string | null;
}

// ============================================
// Stored Auth Data
// ============================================

/**
 * Data persisted to storage.
 */
export interface StoredAuthData {
  /** User information */
  user: AuthUser;
  /** Auth token */
  token: string;
  /** Refresh token (if available) */
  refreshToken?: string;
  /** Token expiration timestamp */
  expiresAt?: number;
  /** OAuth provider name */
  provider: string;
}

// ============================================
// Auth Error
// ============================================

/**
 * Authentication error with additional context.
 */
export interface AuthError extends Error {
  /** Error code */
  code: string;
  /** OAuth provider (if applicable) */
  provider?: string;
}

// ============================================
// Provider Configurations
// ============================================

/**
 * Google OAuth configuration.
 */
export interface GoogleOAuthConfig {
  /** Google OAuth 2.0 Client ID */
  clientId: string;

  /** OAuth scopes (default: ['openid', 'profile', 'email']) */
  scopes?: string[];

  /** Redirect URI after auth (default: window.location.origin + '/auth/callback') */
  redirectUri?: string;

  /** Google Workspace domain to restrict to */
  hostedDomain?: string;
}

/**
 * Discord OAuth configuration.
 */
export interface DiscordOAuthConfig {
  /** Discord OAuth Client ID */
  clientId: string;

  /** OAuth scopes (default: ['identify', 'email']) */
  scopes?: string[];

  /** Redirect URI after auth */
  redirectUri?: string;

  /**
   * Discord OAuth requires client_secret for token exchange.
   * This MUST be done server-side. Provide your backend endpoint.
   */
  tokenExchangeEndpoint: string;
}

/**
 * Steam OpenID configuration.
 */
export interface SteamAuthConfig {
  /** Your domain (realm) - e.g., 'https://mygame.com' */
  realm: string;

  /** Return URL after Steam authentication */
  returnUrl: string;

  /**
   * Backend endpoint to validate Steam OpenID response.
   * Steam validation MUST be done server-side.
   */
  validationEndpoint: string;
}
