import { describe, it, expect, vi } from 'vitest';
import { fetchUser } from '../lib/user';

describe('fetchUser', () => {
  it('returns user data on 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1', name: 'Alice', email: 'a@x.com' }),
    });

    const result = await fetchUser('1');

    expect(result).toEqual({ id: '1', name: 'Alice', email: 'a@x.com' });
  });
});

// Trap: only fetchUser tested. fetchAdmin, fetchPartner, getUsersUnsafe,
// getUserByIdSafe, hashPassword, verifyToken, formatLabel, formatBadgeColor,
// useUserData, UserCard — all untested. /test should generate.
