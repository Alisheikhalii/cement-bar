import { describe, expect, it } from 'vitest';
import { isPrivateIp } from './private-ip';

describe('isPrivateIp', () => {
  it('accepts loopback and private ranges', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', 'fd00::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it('rejects public addresses and garbage', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:db8::1', 'not-an-ip', undefined]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});
