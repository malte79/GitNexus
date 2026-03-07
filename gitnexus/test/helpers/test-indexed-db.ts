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
import { createTempDir, type TestDBHandle } from './test-db.js';
import { NODE_SCHEMA_QUERIES, REL_SCHEMA_QUERIES } from '../../src/core/kuzu/schema.js';
import { closeKuzu as closeCoreKuzu } from '../../src/core/kuzu/kuzu-adapter.js';
import { closeKuzu as closePoolKuzu } from '../../src/mcp/core/kuzu-adapter.js';

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
    // 1. Close core adapter module-level state (db, conn, currentDbPath, ftsLoaded)
    try { await closeCoreKuzu(); } catch { /* best-effort */ }
    // 2. Close MCP pool adapter entry for this repoId
    try { await closePoolKuzu(repoId); } catch { /* best-effort */ }
    // 3. Remove temp directory
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

