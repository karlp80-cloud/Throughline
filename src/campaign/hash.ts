/**
 * Stable hash for canonical-form JSON. Used to detect when a
 * loaded manifest no longer matches a saved progress's source.
 *
 * Not cryptographic — we're catching accidental drift, not
 * adversarial tampering. FNV-1a 32-bit is plenty.
 */

export function canonicalStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(v as object).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalStringify((v as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

/** FNV-1a 32-bit hash, base-16 string. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h = h * 16777619, mod 2^32
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function manifestHash(manifest: unknown): string {
  return fnv1a(canonicalStringify(manifest));
}
