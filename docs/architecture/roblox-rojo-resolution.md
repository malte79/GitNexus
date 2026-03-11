# Roblox Rojo Resolution

Epic 08 adds Roblox-aware static resolution for Rojo-based projects on top of Luau support.

## Scope

CodeNexus supports Roblox project resolution only for repos that define a [`default.project.json`](https://rojo.space/docs/v7/project-format/).

Supported in this phase:

- deterministic filesystem-to-DataModel mapping from `default.project.json`
- static rooted path forms in Luau:
  - `game:GetService("...")`
  - `script.Parent`
  - chained `:WaitForChild("...")`
- shallow local aliases of those rooted paths
- Roblox-aware `require(...)` resolution when the target can be derived statically
- client/shared/server runtime-area tagging from the Rojo mapping

Explicitly deferred:

- non-Rojo Roblox repos
- project files other than `default.project.json`
- Studio inspection
- world projection
- dynamic DataModel mutation
- broad alias propagation or data-flow analysis
- `FindFirstChild`, computed names, and other dynamic lookup forms

## Source Of Truth

Rojo project behavior is grounded in the official documentation:

- [Rojo Project Format](https://rojo.space/docs/v7/project-format/)
- [Rojo Sync Details](https://rojo.space/docs/v7/sync-details/)

Rojo sourcemap output may be used as a comparison oracle in tests or manual validation, but it is not a runtime dependency.

The [`luau-lsp`](https://github.com/JohnnyMorganz/luau-lsp) project is reference-only and is not integrated into CodeNexus.

## Project Mapping Model

CodeNexus parses `default.project.json` and derives one or more deterministic mounts:

- source path in the repo
- corresponding DataModel segments
- runtime area:
  - `shared`
  - `client`
  - `server`
  - `other`

Luau source files are mapped to Roblox instance paths with these rules:

- `.lua` and `.luau` are both supported
- `.client.lua` and `.server.lua` keep the instance name without the `.client` / `.server` suffix
- `init.lua` and `init.luau` map to the containing folder path
- one source file may map to more than one DataModel target if Rojo mounts overlap

## Supported Static Path Forms

CodeNexus resolves Roblox-aware `require(...)` targets for these forms:

- `require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Log"))`
- `require(script.Parent:WaitForChild("UI"):WaitForChild("UIService"))`
- `local sharedRoot = game:GetService("ReplicatedStorage"):WaitForChild("Shared")`
  followed by:
  `require(sharedRoot:WaitForChild("Log"))`

Shallow aliasing is syntax-local only:

- top-level local assignment aliases are supported
- aliases are only resolved when they point directly to a supported rooted path form
- CodeNexus does not perform broad data-flow or interprocedural alias reasoning in this phase

## Conservative Failure Posture

If a path cannot be resolved statically from:

- the Rojo mapping, and
- the supported local syntax forms

then CodeNexus leaves it unresolved.

It does not guess.

Examples that remain unresolved in this phase:

- computed service names
- computed `WaitForChild(...)` names
- `FindFirstChild(...)`
- aliases built through control flow or mutation
- Studio-only or runtime-created hierarchy

## Query Usefulness

Epic 08 should materially improve agent answers on Rojo repos compared with plain Luau support by exposing:

- correct import edges for Roblox-rooted `require(...)`
- client/shared/server runtime-area context
- Rojo-aware module relationships that do not align with plain filesystem-only resolution

Epic 09 builds on that correctness layer by improving module-table symbolization, deterministic ranking, and concise Roblox-aware summaries. Those ergonomics changes are documented in [roblox-query-ergonomics.md](/Users/alex/Projects/GitNexusFork-agent-1/docs/architecture/roblox-query-ergonomics.md).
