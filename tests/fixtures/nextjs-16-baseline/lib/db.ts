// Synthetic DB layer — DO NOT USE. Two functions: one safe, one deliberately
// vulnerable to SQL injection so security-vulnerability-scanner has a target.

type DbRow = Record<string, unknown>;

declare const db: {
  query: (sql: string) => Promise<DbRow[]>;
  prepared: (sql: string, params: unknown[]) => Promise<DbRow[]>;
};

// Trap: SQL injection via string concat. OWASP A03.
// security-vulnerability-scanner must flag this with file:line.
export async function getUsersUnsafe(q: string): Promise<DbRow[]> {
  const sql = `SELECT id, name, email FROM users WHERE name LIKE '%${q}%'`;
  return db.query(sql);
}

// Foil: parameterized version — should NOT be flagged.
export async function getUserByIdSafe(id: string): Promise<DbRow | null> {
  const rows = await db.prepared('SELECT id, name, email FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}
