import { getUsersUnsafe } from '../../lib/db';

// Trap: passes raw query string to a SQL-string-concat function.
// security-vulnerability-scanner should flag the chain page → getUsersUnsafe.
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const users = await getUsersUnsafe(q ?? '');

  return (
    <div>
      <h2>Search results for "{q}"</h2>
      <pre>{JSON.stringify(users, null, 2)}</pre>
    </div>
  );
}
