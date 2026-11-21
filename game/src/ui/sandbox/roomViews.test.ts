import { describe, expect, it } from 'vitest';
import { formatRoomView, parentView, parseRoomView, viewDepth, type RoomView } from './roomViews';

describe('room view stack', () => {
  it('round-trips views', () => {
    const views: RoomView[] = [
      { kind: 'room' },
      { kind: 'rack', rackId: 'rack-1' },
      { kind: 'host', rackId: 'rack-1', hostId: 'srv-2' },
      { kind: 'board' },
      { kind: 'pc', app: 'navrh' },
    ];
    for (const v of views) expect(parseRoomView(formatRoomView(v).split('/').filter(Boolean))).toEqual(v);
  });

  it('Esc goes one level up', () => {
    expect(parentView({ kind: 'host', rackId: 'R', hostId: 'H' })).toEqual({ kind: 'rack', rackId: 'R' });
    expect(parentView({ kind: 'rack', rackId: 'R' })).toEqual({ kind: 'room' });
    expect(parentView({ kind: 'board' })).toEqual({ kind: 'room' });
    expect(parentView({ kind: 'room' })).toBeNull();
    expect(viewDepth({ kind: 'host', rackId: 'R', hostId: 'H' })).toBe(2);
  });

  it('rejects unsafe ids', () => {
    expect(parseRoomView(['rack', '..%2F..'])).toEqual({ kind: 'room' });
    expect(parseRoomView(['rack', 'R1', 'host', '<b>'])).toEqual({ kind: 'rack', rackId: 'R1' });
    expect(parseRoomView(['pocitac'])).toEqual({ kind: 'pc', app: 'plocha' });
  });
});
