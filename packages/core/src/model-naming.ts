import { isFdi } from './numbering.js';
import type { Fdi } from './types.js';

interface Named {
  name: string;
  parent: Named | null;
}

const AUTO_NAME = /^(mesh|node|object|primitive)[_\-.]?\d*$/i;

/**
 * Resolves the meaningful name of a loaded object: its own name, or the nearest ancestor's,
 * skipping empty and auto-generated names (`mesh_0`, `Node_12`). Optimisers such as
 * gltfpack keep names on the node and move the geometry to an unnamed child.
 */
export function resolveModelName(object: Named): string {
  let cur: Named | null = object;
  while (cur) {
    const n = cur.name?.trim() ?? '';
    if (n && !AUTO_NAME.test(n)) return n;
    cur = cur.parent;
  }
  return '';
}

/** The FDI code of a loaded object (via `resolveModelName`), or null if it is not a tooth. */
export function toothCodeOf(object: Named): Fdi | null {
  const name = resolveModelName(object);
  return isFdi(name) ? name : null;
}

/** Whether a loaded object is part of the gums by the naming convention. */
export function isGumName(name: string): boolean {
  return /gum|gingiv/i.test(name);
}
