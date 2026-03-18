import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sharedSupportPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/parsing-symbol-support.ts');
const parsingProcessorPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/parsing-processor.ts');
const parseWorkerSupportPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/workers/parse-worker-support.ts');
const parseWorkerPhpSupportPath = path.resolve(import.meta.dirname, '../../src/core/ingestion/workers/parse-worker-php-support.ts');

describe('Ingestion parsing structure', () => {
  it('routes shared definition and luau symbol truth through parsing-symbol-support', () => {
    const sharedSource = fs.readFileSync(sharedSupportPath, 'utf-8');
    const parsingSource = fs.readFileSync(parsingProcessorPath, 'utf-8');
    const workerSource = fs.readFileSync(parseWorkerSupportPath, 'utf-8');

    expect(sharedSource).toContain('export const createDefinitionArtifacts =');
    expect(sharedSource).toContain('export const appendLuauModuleSymbols =');

    expect(parsingSource).toContain("from './parsing-symbol-support.js';");
    expect(workerSource).toContain("from '../parsing-symbol-support.js';");

    expect(parsingSource).not.toContain('const DEFINITION_CAPTURE_KEYS = [');
    expect(workerSource).not.toContain('const DEFINITION_CAPTURE_KEYS = [');
    expect(parsingSource).not.toContain('export const isNodeExported = (');
    expect(workerSource).not.toContain('export const isNodeExported = (');
    expect(parsingSource).not.toContain('const appendLuauContainerNode = (');
    expect(workerSource).not.toContain('const appendLuauContainerSymbols = (');
  });

  it('keeps worker parsing orchestration thin and delegates php semantics', () => {
    const workerSource = fs.readFileSync(parseWorkerSupportPath, 'utf-8');
    const phpSupportSource = fs.readFileSync(parseWorkerPhpSupportPath, 'utf-8');

    expect(workerSource.split(/\r?\n/).length).toBeLessThanOrEqual(320);
    expect(workerSource).toContain("from './parse-worker-php-support.js';");
    expect(workerSource).not.toContain('const ELOQUENT_ARRAY_PROPS =');
    expect(workerSource).not.toContain('export function extractLaravelRoutes');

    expect(phpSupportSource).toContain('export function extractLaravelRoutes');
    expect(phpSupportSource).toContain('export function extractPhpPropertyDescription');
    expect(phpSupportSource).toContain('export function extractEloquentRelationDescription');
  });
});
