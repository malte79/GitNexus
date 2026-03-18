import { describe, expect, it } from 'vitest';
import corpus from '../fixtures/dancegame-trust-corpus.json' with { type: 'json' };

describe('dancegame trust corpus fixture', () => {
  it('locks the external repo path and canonical baseline commands', () => {
    expect(corpus.repoPath).toBe('/Users/alex/Projects/roblox/dancegame-agent-2');
    expect(corpus.baselineCommands).toEqual(expect.arrayContaining([
      'git rev-parse HEAD',
      'gnexus manage status',
      "gnexus summary --subsystems | wc -l",
      "gnexus query \"client ui shell\" --owners | sed -n '1,80p'",
      "gnexus impact ManifestCompiler --direction upstream | sed -n '1,20p'",
    ]));
  });

  it('locks the operator install workflow used for final measurement', () => {
    expect(corpus.installWorkflow).toEqual([
      'npm run build',
      'npm link',
      'which gnexus',
      'gnexus --version',
    ]);
  });

  it('covers every named trust-benchmark category and overload symbol', () => {
    expect(corpus.benchmarkAsserts).toEqual(expect.arrayContaining([
      'freshness_consistency',
      'concise_subsystem_summary',
      'grounded_subsystem_labels',
      'client_ui_owner_ranking',
      'differentiated_risk_dimensions',
      'overload_shape_visibility',
    ]));
    expect(corpus.overloadSymbols).toEqual(expect.arrayContaining([
      'LaserService',
      'ManifestCompiler',
      'ShowOrchestrator',
      'MinigameCoordinator',
      'SweepController',
    ]));
  });
});
