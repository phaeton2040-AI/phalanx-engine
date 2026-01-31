/**
 * Phalanx Auth Storage
 *
 * Storage interface and implementations for persisting auth data.
 */

import type { StoredAuthData } from './types.js';

// ============================================
// Storage Interface
// ============================================

/**
 * Interface for auth data storage.
 * Implement this interface to provide custom storage (e.g., React Native SecureStore).
 */
export interface AuthStorage {
  /**
   * Retrieve stored auth data.
   * @returns Stored data or null if not found
   */
  get(): Promise<StoredAuthData | null>;

  /**
   * Store auth data.
   * @param data - Auth data to store
   */
  set(data: StoredAuthData): Promise<void>;

  /**
   * Clear stored auth data.
   */
  clear(): Promise<void>;
}

// ============================================
// LocalStorage Implementation
// ============================================

/**
 * Default storage implementation using localStorage.
 * Suitable for web browsers.
 *
 * Note: For production, consider using httpOnly cookies for refresh tokens
 * or a custom storage implementation with encryption.
 */
export class LocalStorageAdapter implements AuthStorage {
  private key: string;

  /**
   * Create a new LocalStorageAdapter.
   * @param key - Storage key prefix (default: 'phalanx_auth')
   */
  constructor(key: string = 'phalanx_auth') {
    this.key = key;
  }

  async get(): Promise<StoredAuthData | null> {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async set(data: StoredAuthData): Promise<void> {
    if (typeof localStorage === 'undefined') {
      console.warn('[AuthStorage] localStorage is not available');
      return;
    }

    // Security warning for production
    if (
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV === 'production' &&
      data.refreshToken
    ) {
      console.warn(
        '[AuthStorage] Storing refresh token in localStorage is not recommended for production. ' +
          'Consider using httpOnly cookies or a custom storage implementation.'
      );
    }

    localStorage.setItem(this.key, JSON.stringify(data));
  }

  async clear(): Promise<void> {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.removeItem(this.key);
  }
}

// ============================================
// Memory Storage Implementation
// ============================================

/**
 * In-memory storage implementation.
 * Useful for testing or environments without persistent storage.
 * Data is lost on page refresh.
 */
export class MemoryStorageAdapter implements AuthStorage {
  private data: StoredAuthData | null = null;

  async get(): Promise<StoredAuthData | null> {
    return this.data;
  }

  async set(data: StoredAuthData): Promise<void> {
    this.data = data;
  }

  async clear(): Promise<void> {
    this.data = null;
  }
}
