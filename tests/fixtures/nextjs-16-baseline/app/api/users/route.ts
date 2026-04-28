import { NextResponse } from 'next/server';
import { getUsersUnsafe, getUserByIdSafe } from '../../../lib/db';

// Trap: API route handler with two paths — one safe, one SQLi-prone.
// security-vulnerability-scanner should flag the GET handler's q-passthrough.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const id = url.searchParams.get('id');

  if (id) {
    const user = await getUserByIdSafe(id);
    return NextResponse.json(user);
  }

  if (q) {
    const users = await getUsersUnsafe(q);
    return NextResponse.json(users);
  }

  return NextResponse.json({ error: 'missing q or id' }, { status: 400 });
}
