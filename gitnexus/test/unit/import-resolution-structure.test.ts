import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const seamPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/import-resolution-support.ts');
const contextSupportPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/import-resolution-context-support.ts');
const configSupportPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/import-language-config-support.ts');
const pathSupportPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/import-path-resolution-support.ts');

describe('Import resolution structure', () => {
  it('keeps the public seam thin and delegated', () => {
    const seamSource = fs.readFileSync(seamPath, 'utf-8');

    expect(seamSource.split(/\r?\n/).length).toBeLessThanOrEqual(40);
    expect(seamSource).toContain("from './import-resolution-context-support.js';");
    expect(seamSource).toContain("from './import-language-config-support.js';");
    expect(seamSource).toContain("from './import-path-resolution-support.js';");
    expect(seamSource).not.toContain('async function loadTsconfigPaths');
    expect(seamSource).not.toContain('function suffixResolve');
    expect(seamSource).not.toContain('function resolveRustImport');
  });

  it('keeps config loading and path matching in separate owners', () => {
    const configSource = fs.readFileSync(configSupportPath, 'utf-8');
    const pathSource = fs.readFileSync(pathSupportPath, 'utf-8');
    const contextSource = fs.readFileSync(contextSupportPath, 'utf-8');

    expect(configSource).toContain('export const loadImportLanguageConfigs = async');
    expect(configSource).toContain('export const applyRojoRuntimeAreas =');
    expect(configSource).not.toContain('export const resolveImportPath =');

    expect(pathSource).toContain('export const resolveImportPath =');
    expect(pathSource).toContain('export const resolvePhpImport =');
    expect(pathSource).not.toContain('loadImportLanguageConfigs');

    expect(contextSource).toContain('export const createImportResolutionContext =');
    expect(contextSource).toContain('export const cacheResolvedImport =');
  });
});
