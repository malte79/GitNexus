# Luau Core Support

## Purpose

This document defines what CodeNexus means by Luau support in Epic 07.

Epic 07 adds Luau as a real indexed language in the existing CodeNexus engine. It does not add Roblox or Rojo semantics. Luau support must be useful through the real product surface, not only through parser-level tests.

## Supported Extensions

Epic 07 treats both of these extensions as Luau source:

- `.lua`
- `.luau`

The support claim for both extensions is equal only if both paths are validated through the indexing and query workflow.

## In-Scope Constructs

Epic 07 must support these language-level construct families:

- top-level named functions
- local functions
- method-style definitions that are statically obvious
- assignment-based function definitions that are statically obvious
- type aliases
- ordinary call expressions
- basic string-based `require(...)` imports

The goal is useful graph structure, not full semantic understanding.

## Export And Public Heuristics

Epic 07 uses conservative Luau export heuristics:

- top-level named functions are treated as public
- table-member assignments and method-style definitions are treated as public
- local declarations are treated as internal
- simple returned-table module patterns may be indexed where they remain language-level

Epic 07 does not try to infer all module exports or model dynamic export behavior.

## `require(...)` Behavior

Epic 07 only handles language-level `require(...)` forms that can be interpreted without Roblox semantics.

Supported behavior:

- string-based `require(...)` capture
- filesystem-level resolution against ordinary repo files where the existing import processor can resolve it conservatively

Explicit non-goals:

- DataModel path resolution
- Rojo sourcemap resolution
- `script.Parent`
- `game:GetService(...)`
- `WaitForChild(...)`

If a `require(...)` cannot be resolved conservatively, it must remain unresolved rather than being guessed.

## Query And Graph Expectations

Luau support in Epic 07 is only complete if it is useful through the existing product:

- `codenexus index` must ingest Luau files
- Luau definitions must appear in the graph
- basic call edges must be created where statically visible
- basic import edges must be created where conservatively resolvable
- Luau symbols must be queryable through the live service

Parser-only support is not sufficient.

## Explicit Deferrals To Epic 08

Epic 07 does not include:

- Rojo project parsing
- `default.project.json`
- Roblox instance-tree semantics
- Roblox-aware `require(...)` resolution
- `game:GetService(...)`
- `script.Parent`
- `WaitForChild(...)`
- client/server/shared Roblox boundary modeling

Those are owned by Epic 08, which now implements the Rojo-first Roblox layer in [roblox-rojo-resolution.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-rojo-resolution.md).

## Reference Material

`luau-lsp` is reference material only.

It may be used to sanity-check construct coverage, fixture quality, and Luau-specific blind spots. It must not be integrated as a dependency, subprocess, or runtime component of CodeNexus.
