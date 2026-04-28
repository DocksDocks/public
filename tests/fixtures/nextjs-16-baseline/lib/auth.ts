import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Trap: weak crypto — md5-style work factor + hard-coded secret.
// security-vulnerability-scanner: A02 (crypto failures), A07 (auth failures).

const JWT_SECRET = 'dev-secret-do-not-ship'; // hard-coded
const BCRYPT_ROUNDS = 4; // far below the 2026 floor (≥12)

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { algorithm: 'HS256' });
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string };
  } catch {
    return null;
  }
}
