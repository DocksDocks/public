'use client';

import { useEffect, useState } from 'react';

// Trap: hand-written useEffect for client-side data fetching.
// react-effect-policy anti-pattern #6: replace with React.use() or Server Component.
export function useUserData(id: string) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/users?id=${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { data, loading };
}
