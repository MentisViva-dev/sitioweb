/**
 * Tests críticos — validators y crypto.
 *
 * Correr con: npm test
 */

import { describe, it, expect } from 'vitest';
import { validateEmail, validateRUT, validatePhoneCL, validatePassword } from '../src/lib/validators';
import { hmacSha256, verifyHmacSha256, hashPassword, verifyPassword, constantTimeEqual } from '../src/lib/crypto';
import { calculateCutoffDate, isInLockedWindow } from '../src/lib/dates';

describe('validators', () => {
  it('validates email', () => {
    expect(validateEmail('valid@example.com').ok).toBe(true);
    expect(validateEmail('NO_AT.com').ok).toBe(false);
    expect(validateEmail('a@b.c').ok).toBe(false); // TLD < 2
    expect(validateEmail('with\r\ninjection@evil.com').ok).toBe(false);
  });

  it('validates Chilean RUT with checksum', () => {
    expect(validateRUT('11.111.111-1').ok).toBe(true);
    expect(validateRUT('11111111-1').ok).toBe(true);
    expect(validateRUT('11.111.111-2').ok).toBe(false); // wrong DV
    expect(validateRUT('123-K').ok).toBe(false); // too short
  });

  it('validates Chilean phone', () => {
    expect(validatePhoneCL('+56912345678').ok).toBe(true);
    expect(validatePhoneCL('912345678').ok).toBe(true);
    expect(validatePhoneCL('+5491134567890').ok).toBe(false); // Argentina
  });

  it('rejects weak passwords', () => {
    expect(validatePassword('123').ok).toBe(false);
    expect(validatePassword('password1234').ok).toBe(false); // común
    expect(validatePassword('correct horse battery staple x').ok).toBe(true);
  });
});

describe('crypto', () => {
  it('HMAC sign and verify', async () => {
    const sig = await hmacSha256('secret', 'message');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyHmacSha256('secret', 'message', sig)).toBe(true);
    expect(await verifyHmacSha256('wrong', 'message', sig)).toBe(false);
  });

  it('hashPassword and verify', async () => {
    // verifyPassword enforces a minimum of 50000 iterations (security floor),
    // so the test must use at least that. Workers cap PBKDF2 at 100000.
    const hash = await hashPassword('myPassword12345', 50000);
    expect(hash.startsWith('pbkdf2$sha256$')).toBe(true);
    expect(await verifyPassword('myPassword12345', hash)).toBe(true);
    expect(await verifyPassword('wrongPassword', hash)).toBe(false);
  });

  it('constantTimeEqual', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('dates', () => {
  it('calculateCutoffDate respects business days', () => {
    // Diciembre 2026: 25 es viernes; 10 días hábiles antes = jueves 11.
    const cutoff = calculateCutoffDate(2026, 12);
    expect(cutoff.getUTCDate()).toBeGreaterThan(0);
    expect(cutoff.getUTCDate()).toBeLessThan(25);
  });

  it('isInLockedWindow returns true between cutoff and 25', () => {
    // Por construcción, día 20 de un mes con cutoff antes está locked.
    const day20 = new Date(Date.UTC(2026, 5, 20)); // 20 junio 2026
    expect(isInLockedWindow(day20)).toBe(true);
  });
});
