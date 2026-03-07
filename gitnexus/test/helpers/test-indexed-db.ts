/**
 * Test helper: Indexed KuzuDB lifecycle manager
 *
 * Creates a temporary KuzuDB with schema, handles cleanup of BOTH
 * the core adapter and MCP pool adapter module-level state under singleFork.
 *
 * Each test file gets a unique repoId to prevent MCP pool map collisions.
 * Seed data is NOT included — each test provides its own via the returned connection.
 */
import fs from 'fs/promises';
import path from 'path';
import kuzu from 'kuzu';
import { describe, beforeAll, afterAll } from 'vitest';
import { createTempDir, type TestDBHandle } from './test-db.js';
import { NODE_SCHEMA_QUERIES, REL_SCHEMA_QUERIES } from '../../src/core/kuzu/schema.js';
import { detachKuzu as detachCoreKuzu } from '../../src/core/kuzu/kuzu-adapter.js';
import { detachKuzu as detachPoolKuzu } from '../../src/mcp/core/kuzu-adapter.js';

export interface IndexedDBHandle {
  /** Path to the KuzuDB database file */
  dbPath: string;
  /** Unique repoId for MCP pool adapter — prevents cross-file collisions */
  repoId: string;
  /** Temp directory handle for filesystem cleanup */
  tmpHandle: TestDBHandle;
  /** Cleanup: closes BOTH adapters + removes temp dir */
  cleanup: () => Promise<void>;
}

let repoCounter = 0;

/**
 * Create a temporary KuzuDB with full schema (node tables + relationship tables).
 * Returns a handle with dbPath, unique repoId, and cleanup function.
 *
 * The caller is responsible for inserting seed data via direct kuzu connection
 * before using the adapters.
 *
 * @param prefix - Temp directory prefix for identification in logs
 */
export async function createTestKuzuDB(prefix: string): Promise<IndexedDBHandle> {
  const tmpHandle = await createTempDir(`${prefix}-`);
  const dbPath = path.join(tmpHandle.dbPath, 'kuzu');
  const repoId = `test-${prefix}-${Date.now()}-${repoCounter++}`;

  // Create writable DB with schema
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);

  for (const q of NODE_SCHEMA_QUERIES) {
    await conn.query(q);
  }
  for (const q of REL_SCHEMA_QUERIES) {
    await conn.query(q);
  }

  conn.close();
  db.close();

  const cleanup = async () => {
    // 1. Detach (null out) core adapter refs — do NOT call .close() which
    //    triggers C++ destructors that hang/segfault in forked workers
    try { detachCoreKuzu(); } catch { /* best-effort */ }
    // 2. Detach MCP pool adapter refs for this repoId
    try { detachPoolKuzu(); } catch { /* best-effort */ }
    // 3. Remove temp directory (best-effort — DB files may still be locked)
    try { await tmpHandle.cleanup(); } catch { /* best-effort */ }
  };

  return { dbPath, repoId, tmpHandle, cleanup };
}

/**
 * Insert seed data into a KuzuDB via direct connection.
 * Opens a writable connection, runs the provided queries, then closes.
 *
 * @param dbPath - Path to the KuzuDB database file
 * @param queries - Array of Cypher INSERT/CREATE queries
 */
export async function seedTestData(dbPath: string, queries: string[]): Promise<void> {
  const db = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(db);
  for (const q of queries) {
    await conn.query(q);
  }
  conn.close();
  db.close();
}

/** FTS index definition for withTestKuzuDB */
export interface FTSIndexDef {
  table: string;
  indexName: string;
  columns: string[];
}

/**
 * Options for withTestKuzuDB lifecycle.
 *
 * Lifecycle: createDB → seed → initKuzu → loadFTS → createIndexes
 *            → [closeCoreKuzu + poolInitKuzu] → afterSetup
 */
export interface WithTestKuzuDBOptions {
  /** Cypher CREATE queries to insert seed data (runs before core adapter opens). */
  seed?: string[];
  /** FTS indexes to create after seeding. */
  ftsIndexes?: FTSIndexDef[];
  /** Close core adapter and open pool adapter (read-only) after FTS setup. */
  poolAdapter?: boolean;
  /** Run after all lifecycle phases complete (mocks, dynamic imports, etc). */
  afterSetup?: (handle: IndexedDBHandle) => Promise<void>;
  /** Timeout for beforeAll in ms (default: 30000). */
  timeout?: number;
}

/**
 * Manages the full KuzuDB test lifecycle: DB creation, schema, seed data,
 * FTS indexes, adapter init/teardown, and temp directory cleanup.
 *
 * Each call is wrapped in its own `describe` block to isolate lifecycle
 * hooks — safe to call multiple times in the same file.
 */
export function withTestKuzuDB(
  prefix: string,
  fn: (handle: IndexedDBHandle) => void,
  options?: WithTestKuzuDBOptions,
): void {
  const ref: { handle: IndexedDBHandle | undefined } = { handle: undefined };
  const timeout = options?.timeout ?? 30000;

  const setup = async () => {
    // 1. Create DB + schema
    ref.handle = await createTestKuzuDB(prefix);
    const handle = ref.handle;

    // 2. Seed data BEFORE opening core adapter (avoids lock conflict —
    //    seedTestData opens its own writable connection then closes it)
    if (options?.seed?.length) {
      await seedTestData(handle.dbPath, options.seed);
    }

    // 3. Init core adapter (writable)
    const { 
      initKuzu, 
      loadFTSExtension, 
      createFTSIndex, 
      closeKuzu: closeCoreKuzu 
    } = await import('../../src/core/kuzu/kuzu-adapter.js');
    await initKuzu(handle.dbPath);

    // 4. Load FTS extension
    await loadFTSExtension();

    // 5. Create FTS indexes
    if (options?.ftsIndexes?.length) {
      for (const idx of options.ftsIndexes) {
        await createFTSIndex(idx.table, idx.indexName, idx.columns);
      }
    }

    // 6. Close core → open pool adapter (read-only)
    if (options?.poolAdapter) {
      await closeCoreKuzu();
      const { initKuzu: poolInitKuzu } = await import('../../src/mcp/core/kuzu-adapter.js');
      await poolInitKuzu(handle.repoId, handle.dbPath);
    }

    // 7. User's final setup (mocks, dynamic imports, etc.)
    if (options?.afterSetup) {
      await options.afterSetup(handle);
    }
  };

  const lazyHandle = new Proxy({} as IndexedDBHandle, {
    get(_target, prop) {
      if (!ref.handle) throw new Error('withTestKuzuDB: handle not initialized — beforeAll has not run yet');
      return (ref.handle as any)[prop];
    },
  });

  // Wrap in describe to scope beforeAll/afterAll — prevents lifecycle
  // collisions when multiple withTestKuzuDB calls share the same file.
  describe(`withTestKuzuDB(${prefix})`, () => {
    beforeAll(setup, timeout);
    afterAll(async () => { if (ref.handle) await ref.handle.cleanup(); });
    fn(lazyHandle);
  });
}

