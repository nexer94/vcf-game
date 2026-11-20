import { describe, expect, it, vi } from 'vitest';
import { EventBus, type GameEvent } from './events';

describe('EventBus', () => {
  it('delivers events to subscribers and supports unsubscribe', () => {
    const bus = new EventBus<GameEvent>();
    const a = vi.fn();
    const off = bus.subscribe(a);
    const ev: GameEvent = { type: 'notification', atMs: 0, level: 'info', message: 'hi' };
    bus.emit(ev);
    expect(a).toHaveBeenCalledWith(ev);
    off();
    bus.emit(ev);
    expect(a).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount).toBe(0);
  });

  it('tolerates unsubscribe during dispatch', () => {
    const bus = new EventBus<GameEvent>();
    const b = vi.fn();
    const off = bus.subscribe(() => off());
    bus.subscribe(b);
    bus.emit({ type: 'speedChanged', atMs: 0, speed: 1 });
    expect(b).toHaveBeenCalledTimes(1);
  });
});
