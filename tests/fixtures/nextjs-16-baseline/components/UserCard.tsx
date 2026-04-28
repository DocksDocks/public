'use client';

import { useEffect, useState } from 'react';
import { formatLabel, formatBadgeColor } from '../lib/formatter';

type User = { id: string; name: string; email: string };

// Trap: god component (SRP violation, ~120 LOC, 4 distinct responsibilities)
//   1. Fetch user details (Effect-data-fetching anti-pattern)
//   2. Manage local edit form state
//   3. Format and render two view modes (full / compact)
//   4. Handle delete confirmation modal
// refactor-solid-analyzer: SRP violation — needs Extract Hook + Split Module.
// react-effect-policy: useEffect data-fetching is anti-pattern #6.
export function UserCard({ user, mode }: { user: User; mode: 'full' | 'compact' }) {
  const [details, setDetails] = useState<User | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(user.name);
  const [draftEmail, setDraftEmail] = useState(user.email);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anti-pattern: data fetching in effect
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users?id=${user.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // Anti-pattern: derived state stored in useState instead of computed during render
  const [label, setLabel] = useState(formatLabel('user', user.name));
  useEffect(() => {
    setLabel(formatLabel('user', user.name));
  }, [user.name]);

  function handleSaveEdit() {
    fetch(`/api/users?id=${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: draftName, email: draftEmail }),
    });
    setEditing(false);
  }

  function handleDelete() {
    fetch(`/api/users?id=${user.id}`, { method: 'DELETE' });
    setConfirmingDelete(false);
  }

  if (mode === 'compact') {
    return (
      <div data-color={formatBadgeColor('user')}>
        <span>{label}</span>
      </div>
    );
  }

  return (
    <article>
      <header>
        <h3 style={{ color: formatBadgeColor('user') }}>{label}</h3>
        <button onClick={() => setEditing((e) => !e)}>{editing ? 'Cancel' : 'Edit'}</button>
        <button onClick={() => setConfirmingDelete(true)}>Delete</button>
      </header>
      {error && <p>Error: {error}</p>}
      {details && <p>Email: {details.email}</p>}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveEdit();
          }}
        >
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
          <input value={draftEmail} onChange={(e) => setDraftEmail(e.target.value)} />
          <button type="submit">Save</button>
        </form>
      )}
      {confirmingDelete && (
        <div role="dialog">
          <p>Delete {user.name}?</p>
          <button onClick={handleDelete}>Confirm</button>
          <button onClick={() => setConfirmingDelete(false)}>Cancel</button>
        </div>
      )}
    </article>
  );
}
