import { describe, expect, it } from 'vitest';
import { decodeFrame } from '../src/websocket/manager.js';

function buildFrame(opcode: number, fin: boolean, payload: Buffer, masked = true): Buffer {
  const finBit = fin ? 0x80 : 0x00;
  const first = finBit | (opcode & 0x0f);
  const length = payload.length;
  const headerParts: number[] = [first];
  if (length < 126) {
    headerParts.push((masked ? 0x80 : 0) | length);
  } else if (length <= 0xffff) {
    headerParts.push((masked ? 0x80 : 0) | 126, (length >> 8) & 0xff, length & 0xff);
  } else {
    throw new Error('test helper does not need 64-bit lengths');
  }
  const header = Buffer.from(headerParts);
  if (!masked) return Buffer.concat([header, payload]);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked_payload = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) masked_payload[i] = payload[i]! ^ mask[i % 4]!;
  return Buffer.concat([header, mask, masked_payload]);
}

describe('decodeFrame', () => {
  it('returns null when fewer than 2 bytes are buffered', () => {
    expect(decodeFrame(Buffer.alloc(0))).toBeNull();
    expect(decodeFrame(Buffer.from([0x81]))).toBeNull();
  });

  it('returns null when payload bytes are still in flight', () => {
    const frame = buildFrame(0x1, true, Buffer.from('hello world'));
    // Cut off in the middle of the masked payload.
    const partial = frame.subarray(0, frame.length - 3);
    expect(decodeFrame(partial)).toBeNull();
  });

  it('returns null when 16-bit length header is incomplete', () => {
    const frame = buildFrame(0x1, true, Buffer.alloc(200, 0x61));
    // Header is 4 bytes (first + len-marker + 2-byte length); cut after first 3 bytes.
    expect(decodeFrame(frame.subarray(0, 3))).toBeNull();
    // Cut after length but before mask key.
    expect(decodeFrame(frame.subarray(0, 5))).toBeNull();
  });

  it('decodes a complete masked text frame', () => {
    const payload = Buffer.from('{"type":"authenticate"}', 'utf8');
    const frame = buildFrame(0x1, true, payload);
    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.fin).toBe(true);
    expect(decoded!.opcode).toBe(0x1);
    expect(decoded!.data.toString('utf8')).toBe(payload.toString('utf8'));
    expect(decoded!.consumed).toBe(frame.length);
  });

  it('reports consumed bytes so callers can keep trailing data buffered', () => {
    const a = buildFrame(0x1, true, Buffer.from('first'));
    const b = buildFrame(0x1, true, Buffer.from('second'));
    const combined = Buffer.concat([a, b]);

    const firstDecoded = decodeFrame(combined);
    expect(firstDecoded).not.toBeNull();
    expect(firstDecoded!.data.toString('utf8')).toBe('first');
    expect(firstDecoded!.consumed).toBe(a.length);

    const secondDecoded = decodeFrame(combined.subarray(firstDecoded!.consumed));
    expect(secondDecoded).not.toBeNull();
    expect(secondDecoded!.data.toString('utf8')).toBe('second');
  });

  it('exposes the FIN bit so continuation frames can be reassembled', () => {
    const fragment = buildFrame(0x1, false, Buffer.from('hel'));
    const continuation = buildFrame(0x0, true, Buffer.from('lo'));

    const first = decodeFrame(fragment)!;
    const second = decodeFrame(continuation)!;

    expect(first.fin).toBe(false);
    expect(first.opcode).toBe(0x1);
    expect(first.data.toString('utf8')).toBe('hel');

    expect(second.fin).toBe(true);
    expect(second.opcode).toBe(0x0);
    expect(second.data.toString('utf8')).toBe('lo');
  });

  it('decodes 16-bit extended length frames', () => {
    const payload = Buffer.alloc(300, 0x41);
    const frame = buildFrame(0x1, true, payload);
    const decoded = decodeFrame(frame)!;
    expect(decoded.data.length).toBe(300);
    expect(decoded.data.every((byte) => byte === 0x41)).toBe(true);
    expect(decoded.consumed).toBe(frame.length);
  });
});
