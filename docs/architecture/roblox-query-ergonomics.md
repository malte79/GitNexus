# Roblox Query Ergonomics

Epic 09 improves the agent-facing usefulness of the existing Luau and Rojo support without changing the underlying Roblox path-resolution scope from Epic 08.

## Purpose

CodeNexus is already correct on representative Rojo import-resolution cases. Epic 09 makes those results easier for agents to use by improving three things:

- Luau module-table symbolization
- deterministic ranking for Roblox and Luau concepts
- concise Roblox-aware query and context summaries

The goal is not fuzzy semantic retrieval. The goal is better grounded answers from the graph CodeNexus already has.

## In-Scope Module Patterns

Epic 09 recognizes these deterministic Luau module patterns as first-class symbols:

- named returned singleton tables such as `local X = {}; return X`
- table method definitions such as `function X.foo(...) end`
- table assignment methods such as `X.foo = function(...) end`
- method-style definitions such as `function X:foo(...) end`
- constructor-like modules with methods such as `X.new(...)`
- service-like named module tables such as `LightingShowService`

Lower-confidence support is allowed for statically obvious returned table literals such as:

```luau
return {
  start = function() end,
  stop = function() end,
}
```

Those lower-confidence cases must remain second-class:

- they must not outrank stronger named module-table symbols by default
- they must not replace file-level lookup

## Lookup And Ranking Rules

Epic 09 stays deterministic. Ranking may use only grounded signals such as:

- exact module symbol name
- exact file basename
- split-word service aliases such as `LightingShowService` -> `lighting show service`
- `runtimeArea`
- Rojo or DataModel path context already derived from Epic 08

Epic 09 does not introduce:

- embeddings
- fuzzy semantic inference
- new Roblox path-resolution rules

Exact file lookup must remain a strong and reliable path even after module-symbol ranking improves.

## Summary Fields

When available, Roblox-aware query and context summaries should expose concise graph-grounded facts:

- module symbol
- file path
- `runtimeArea`
- Rojo or DataModel path context
- key boundary-crossing imports

These summaries must stay grounded in indexed facts. They are not free-form “helpful” prose.

## Real Acceptance Target

Epic 09 uses [/Users/alex/Projects/roblox/dancegame-agent-3](/Users/alex/Projects/roblox/dancegame-agent-3) as the primary real-world acceptance target.

The fixed before-and-after query set is:

- `SpotlightRegistry`
- `lighting show service`
- `UI service`
- `world bootstrap`
- `client shared boundary`

## Before / After Evidence

Before Epic 09:

- `context("SpotlightRegistry")` was weak or failed because the returned module table was not surfaced strongly enough as a first-class symbol
- broad Roblox queries like `lighting show service` returned relevant files, but ranking and summaries were noisier than they needed to be
- exact file and import correctness was already strong and had to be preserved

After Epic 09:

- `SpotlightRegistry` resolves as a module symbol and remains traceable back to its containing file
- `lighting show service` surfaces `LightingShowService` and its containing file in the top results
- `UI service` surfaces both Roblox-relevant `UIService` modules with runtime-area context
- `world bootstrap` surfaces the expected bootstrap file with server/runtime-area and DataModel-path context

## Manual Verification

Real-product verification was performed against [/Users/alex/Projects/roblox/dancegame-agent-3](/Users/alex/Projects/roblox/dancegame-agent-3) through the live `codenexus` service, then checked manually against source.

Representative verified files:

- [/Users/alex/Projects/roblox/dancegame-agent-3/src/shared/Spotlight/SpotlightRegistry.lua](/Users/alex/Projects/roblox/dancegame-agent-3/src/shared/Spotlight/SpotlightRegistry.lua)
- [/Users/alex/Projects/roblox/dancegame-agent-3/src/server/Lighting/LightingShowService.lua](/Users/alex/Projects/roblox/dancegame-agent-3/src/server/Lighting/LightingShowService.lua)
- [/Users/alex/Projects/roblox/dancegame-agent-3/src/server/Game/UIService.lua](/Users/alex/Projects/roblox/dancegame-agent-3/src/server/Game/UIService.lua)
- [/Users/alex/Projects/roblox/dancegame-agent-3/src/server/WorldBootstrap.server.lua](/Users/alex/Projects/roblox/dancegame-agent-3/src/server/WorldBootstrap.server.lua)

Those checks confirmed that the new symbolization and ranking improvements reflect the actual code structure rather than inventing broader semantics than the graph can support.

## Explicit Deferrals

Epic 09 does not attempt:

- new Roblox path-resolution forms beyond Epic 08
- broad alias propagation or data-flow analysis
- embeddings or semantic retrieval
- branch-aware ranking behavior
- world projection joins

Those remain later concerns.
