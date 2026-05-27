/**
 * StorageBackend abstraction.
 *
 * Phase 7 ships `LocalStorageBackend`. Tauri's file-backed variant
 * lands later. Tests use `MemoryStorageBackend`.
 */

export interface StorageBackend {
  read(key: string): string | null;
  write(key: string, value: string): void;
  delete(key: string): void;
  /** Return all keys starting with `prefix`. Sorted, deterministic. */
  keys(prefix: string): string[];
}

export class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, string>();
  read(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.store.set(key, value);
  }
  delete(key: string): void {
    this.store.delete(key);
  }
  keys(prefix: string): string[] {
    return Array.from(this.store.keys())
      .filter((k) => k.startsWith(prefix))
      .sort();
  }
}

export class LocalStorageBackend implements StorageBackend {
  read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded / private mode: silently drop the write.
      // Phase 7 is best-effort; data loss surfaces as "save vanished".
    }
  }
  delete(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  keys(prefix: string): string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) out.push(k);
      }
    } catch {
      // ignore
    }
    return out.sort();
  }
}
