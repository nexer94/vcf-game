/**
 * Engine -> render event contract.
 * Domain-specific events (deploy progress, traffic, mission result...) will be
 * added later once the model exists; keep this a discriminated union.
 */
import type { GameSpeed } from './clock';

export type GameEvent =
  | { readonly type: 'speedChanged'; readonly atMs: number; readonly speed: GameSpeed }
  | {
      readonly type: 'notification';
      readonly atMs: number;
      readonly level: 'info' | 'warning' | 'error';
      readonly message: string;
    };

export type GameEventType = GameEvent['type'];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

export type Listener<E> = (event: E) => void;
export type Unsubscribe = () => void;

/** Minimal typed synchronous event bus. */
export class EventBus<E extends { type: string }> {
  private readonly listeners = new Set<Listener<E>>();

  subscribe(listener: Listener<E>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: E): void {
    // Copy so listeners may unsubscribe during dispatch.
    for (const listener of [...this.listeners]) listener(event);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
