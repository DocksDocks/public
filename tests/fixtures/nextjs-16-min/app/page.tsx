import { fetchUser } from '../lib/user';

export default async function Page() {
  const user = await fetchUser();

  // Trap: deliberate unused local — refactor-dead-code-scanner should flag as SAFE-tier
  const unused = 42;

  return (
    <main>
      <h1>Hello, {user.name}</h1>
      <p>Email: {user.email}</p>
    </main>
  );
}
