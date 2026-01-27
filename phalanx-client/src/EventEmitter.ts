/**
 * EventEmitter - Generic typed event emitter
 *
 * Provides a type-safe event subscription system with support for:
 * - Multiple handlers per event
 * - One-time handlers (once)
 * - Unsubscribe functions
 * - Removing all listeners
 */

/**
 * Generic event emitter with type-safe event handling
 * @typeParam TEvents - Interface mapping event names to handler signatures
 */

export class EventEmitter<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEvents extends { [K in keyof TEvents]: (...args: any[]) => void },
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: Map<keyof TEvents, Set<any>> = new Map();

  /**
   * Subscribe to an event
   * @param event Event name
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  on<K extends keyof TEvents>(event: K, handler: TEvents[K]): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    this.handlers.get(event)!.add(handler);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Subscribe to an event once (automatically unsubscribes after first call)
   * @param event Event name
   * @param handler Event handler function
   */
  once<K extends keyof TEvents>(event: K, handler: TEvents[K]): void {
    const wrapper = ((...args: Parameters<TEvents[K]>) => {
      this.off(event, wrapper);
      (handler as (...args: Parameters<TEvents[K]>) => void)(...args);
    }) as TEvents[K];

    this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event
   * @param event Event name
   * @param handler Event handler function to remove
   */
  off<K extends keyof TEvents>(event: K, handler: TEvents[K]): void {
    const eventHandlers = this.handlers.get(event);
    eventHandlers?.delete(handler);
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(): void {
    this.handlers.clear();
  }

  /**
   * Remove all listeners for a specific event
   * @param event Event name
   */
  removeListeners<K extends keyof TEvents>(event: K): void {
    this.handlers.delete(event);
  }

  /**
   * Emit an event to all subscribers
   * @param event Event name
   * @param args Event arguments
   */
  protected emit<K extends keyof TEvents>(
    event: K,
    ...args: Parameters<TEvents[K]>
  ): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        try {
          (handler as (...args: Parameters<TEvents[K]>) => void)(...args);
        } catch (error) {
          console.error(`Error in event handler for ${String(event)}:`, error);
        }
      }
    }
  }

  /**
   * Check if there are any listeners for an event
   * @param event Event name
   * @returns True if there are listeners
   */
  hasListeners<K extends keyof TEvents>(event: K): boolean {
    const eventHandlers = this.handlers.get(event);
    return eventHandlers !== undefined && eventHandlers.size > 0;
  }

  /**
   * Get the number of listeners for an event
   * @param event Event name
   * @returns Number of listeners
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
