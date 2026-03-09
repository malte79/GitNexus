# CodeNexus Docs

This directory is the canonical home for durable CodeNexus documentation.

It does not attempt to document the inherited GitNexus system wholesale. It documents the CodeNexus contracts, workflow rules, and product behavior that we own.

## Information Architecture

Stable documentation categories:

- `docs/architecture/`
  - product shape
  - runtime contracts
  - filesystem/state ownership
  - reduction inventories for deliberate repo simplification
- `docs/cli/`
  - command behavior and usage contracts
- `docs/decisions/`
  - short ADR-style decisions when a choice needs durable explanation
- `docs/features/`
  - feature-specific docs for implemented CodeNexus systems

The tree should stay minimal. Do not create placeholder directories or speculative docs for future systems.

## Governed Surfaces

The governed documentation surface set is defined in [docs/governed-paths.toml](/Users/alex/Projects/GitNexusFork-agent-1/docs/governed-paths.toml).

In v1, the governed set includes:

- the `docs/` markdown tree
- `planning/master-intent.md`
- `planning/epics-todo.md`
- `planning/epics/**/*.md`

Other repo markdown is out of scope by default.

Some non-governed markdown files still act as contract-bearing surfaces. In particular, `AGENTS.md` and the required repo workflow skills for review, validation, prep, and merge are tracked in the manifest as surfaces that require durable `docs/` updates when they change.

## Planning Handoff

Planning docs are governed because they lock active direction and execution.

When a planning contract becomes stable product behavior, the durable documentation must live under `docs/`, not remain only in `planning/`.

When a governed contract surface changes, the required documentation update must include a durable `docs/` change. Planning updates can accompany that change, but they do not satisfy the durable-doc requirement by themselves.

Planning docs may reference durable docs, but they should not become the long-term home for product contracts once implementation lands.
