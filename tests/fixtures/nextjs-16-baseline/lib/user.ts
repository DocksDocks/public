type User = {
  id: string;
  name: string;
  email: string;
};

// Trap: fetchUser / fetchAdmin / fetchPartner — three-way duplication.
// refactor-duplication-scanner should flag as extraction candidate.
export async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`https://api.example.com/users/${id}`);
  if (!res.ok) throw new Error('Failed to load user');
  return res.json();
}

export async function fetchAdmin(id: string): Promise<User> {
  const res = await fetch(`https://api.example.com/admins/${id}`);
  if (!res.ok) throw new Error('Failed to load admin');
  return res.json();
}

export async function fetchPartner(id: string): Promise<User> {
  const res = await fetch(`https://api.example.com/partners/${id}`);
  if (!res.ok) throw new Error('Failed to load partner');
  return res.json();
}

// Trap: never imported — dead-code-scanner SAFE-tier.
export function unusedHelper() {
  return 'never called';
}
