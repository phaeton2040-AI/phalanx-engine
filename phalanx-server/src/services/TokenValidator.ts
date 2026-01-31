/**
 * Phalanx Server Authentication
 *
 * Token validation for securing WebSocket connections.
 */

import type {
  AuthConfig,
  TokenValidator,
  TokenValidationResult,
} from '../types/index.js';

// Re-export types for convenience
export type { TokenValidator, TokenValidationResult };

/**
 * Cached token entry
 */
interface CachedToken {
  result: TokenValidationResult;
  expiresAt: number;
}

/**
 * Google ID Token payload structure
 */
interface GoogleIdTokenPayload {
  iss: string;
  azp: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  hd?: string;
  iat: number;
  exp: number;
}

/**
 * Google JWKS key structure
 */
interface GoogleJwk {
  kty: string;
  alg: string;
  use: string;
  kid: string;
  n: string;
  e: string;
}

/**
 * Token Validator Service
 *
 * Validates OAuth tokens for server-side authentication.
 */
export class TokenValidatorService {
  private config: AuthConfig;
  private tokenCache: Map<string, CachedToken> = new Map();
  private googleKeysCache: { keys: GoogleJwk[]; expiresAt: number } | null =
    null;

  constructor(config: AuthConfig) {
    this.config = {
      cacheTokens: true,
      cacheTtlMs: 5 * 60 * 1000, // 5 minutes
      ...config,
    };
  }

  /**
   * Validate a token
   */
  async validate(token: string): Promise<TokenValidationResult> {
    if (!token) {
      return { valid: false, error: 'No token provided' };
    }

    // Check cache first
    if (this.config.cacheTokens) {
      const cached = this.tokenCache.get(token);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
    }

    let result: TokenValidationResult;

    // Use custom validator if provided
    if (this.config.validator) {
      result = await this.config.validator(token);
    }
    // Use Google validator if configured
    else if (this.config.google) {
      result = await this.validateGoogleToken(token);
    }
    // No validator configured
    else {
      return {
        valid: false,
        error: 'No token validator configured',
      };
    }

    // Cache the result
    if (this.config.cacheTokens && result.valid) {
      const cacheTtl = this.config.cacheTtlMs || 5 * 60 * 1000;
      this.tokenCache.set(token, {
        result,
        expiresAt: Date.now() + cacheTtl,
      });
    }

    return result;
  }

  /**
   * Validate a Google ID token
   */
  private async validateGoogleToken(
    token: string
  ): Promise<TokenValidationResult> {
    try {
      // Decode the token (without verification first to get the header)
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[0] || !parts[1]) {
        return { valid: false, error: 'Invalid token format' };
      }

      // Decode payload
      const payloadJson = this.base64UrlDecode(parts[1]);
      const payload: GoogleIdTokenPayload = JSON.parse(payloadJson);

      // Validate issuer
      if (
        payload.iss !== 'https://accounts.google.com' &&
        payload.iss !== 'accounts.google.com'
      ) {
        return { valid: false, error: 'Invalid issuer' };
      }

      // Validate audience (client ID)
      if (payload.aud !== this.config.google!.clientId) {
        return { valid: false, error: 'Invalid audience' };
      }

      // Validate expiration
      if (payload.exp * 1000 < Date.now()) {
        return { valid: false, error: 'Token expired' };
      }

      // Validate hosted domain if configured
      if (this.config.google!.allowedDomains?.length) {
        if (
          !payload.hd ||
          !this.config.google!.allowedDomains.includes(payload.hd)
        ) {
          return {
            valid: false,
            error: `User must be from allowed domains: ${this.config.google!.allowedDomains.join(', ')}`,
          };
        }
      }

      // TODO: For production, verify the token signature using Google's JWKS
      // This requires fetching keys from https://www.googleapis.com/oauth2/v3/certs
      // and verifying the RS256 signature. See user story 04-id-token-signature-verification.md

      return {
        valid: true,
        userId: payload.sub,
        username: payload.name,
        email: payload.email,
        expiresAt: payload.exp * 1000,
      };
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error ? error.message : 'Token validation failed',
      };
    }
  }

  /**
   * Verify token signature using Google's JWKS (for production use)
   * TODO: Implement full signature verification
   */
  private async verifyGoogleSignature(
    _token: string,
    _kid: string
  ): Promise<boolean> {
    // This is a placeholder for full signature verification
    // See user story 04-id-token-signature-verification.md
    console.warn(
      '[TokenValidator] Signature verification not implemented - using claims-only validation'
    );
    return true;
  }

  /**
   * Base64URL decode
   */
  private base64UrlDecode(input: string): string {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Clear the token cache
   */
  clearCache(): void {
    this.tokenCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number } {
    return {
      size: this.tokenCache.size,
      hits: 0, // Would need to track this
    };
  }
}

/**
 * Create a simple custom validator that accepts any non-empty token.
 * FOR DEVELOPMENT/TESTING ONLY - DO NOT USE IN PRODUCTION!
 */
export function createDevValidator(): TokenValidator {
  console.warn(
    '[TokenValidator] Using development validator - DO NOT USE IN PRODUCTION!'
  );
  return async (token: string) => {
    if (!token) {
      return { valid: false, error: 'No token' };
    }
    // In dev mode, extract userId from token if it looks like "dev:userId"
    if (token.startsWith('dev:')) {
      const userId = token.slice(4);
      return {
        valid: true,
        userId,
        username: userId,
      };
    }
    // Accept any token in dev mode
    return {
      valid: true,
      userId: 'dev-user',
      username: 'Developer',
    };
  };
}

/**
 * Create a validator that validates tokens via an external endpoint.
 * Useful when you have a backend auth service.
 */
export function createEndpointValidator(
  endpointUrl: string,
  options?: {
    headers?: Record<string, string>;
    timeout?: number;
  }
): TokenValidator {
  return async (token: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        options?.timeout || 5000
      );

      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { valid: false, error: `Validation failed: ${response.status}` };
      }

      const result = await response.json();
      return result as TokenValidationResult;
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error ? error.message : 'Validation request failed',
      };
    }
  };
}
