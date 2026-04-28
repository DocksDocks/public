type Entity = 'user' | 'admin' | 'partner' | 'guest' | 'banned';

// Trap: OCP violation — switch chain that grows every time a new Entity arrives.
// refactor-solid-analyzer / react-solid skill: replace with strategy map.
export function formatLabel(kind: Entity, name: string): string {
  switch (kind) {
    case 'user':
      return `User: ${name}`;
    case 'admin':
      return `Admin (priv): ${name}`;
    case 'partner':
      return `Partner: ${name}`;
    case 'guest':
      return `Guest visitor: ${name}`;
    case 'banned':
      return `[BANNED] ${name}`;
    default:
      return name;
  }
}

// Trap: a second switch over the same enum — DRY violation, will drift.
export function formatBadgeColor(kind: Entity): string {
  switch (kind) {
    case 'user':
      return 'blue';
    case 'admin':
      return 'red';
    case 'partner':
      return 'green';
    case 'guest':
      return 'gray';
    case 'banned':
      return 'black';
    default:
      return 'gray';
  }
}
