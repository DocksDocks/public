type User = {
  name: string;
  email: string;
};

// Trap: fetchUser and fetchAdmin are structurally identical except URL + label.
// refactor-duplication-scanner should flag as extraction candidate for fetchEndpoint().
export async function fetchUser(): Promise<User> {
  const res = await fetch('https://api.example.com/user');
  if (!res.ok) throw new Error('Failed to load user');
  return res.json();
}

export async function fetchAdmin(): Promise<User> {
  const res = await fetch('https://api.example.com/admin');
  if (!res.ok) throw new Error('Failed to load admin');
  return res.json();
}

// Trap: never-imported export — refactor-dead-code-scanner should flag as SAFE-tier
export function unusedExport() {
  return 'never called';
}
