import { fetchUser, fetchAdmin } from '../lib/user';
import { UserCard } from '../components/UserCard';

export default async function Page() {
  const user = await fetchUser('1');
  const admin = await fetchAdmin('1');

  // Trap: deliberate unused locals (dead-code-scanner SAFE-tier)
  const unusedA = 42;
  const unusedB = 'never read';

  return (
    <main>
      <h1>Hello, {user.name}</h1>
      <UserCard user={user} mode="full" />
      <UserCard user={admin} mode="compact" />
    </main>
  );
}
