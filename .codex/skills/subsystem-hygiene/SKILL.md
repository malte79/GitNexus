---
name: subsystem-hygiene
description: Define or harden the ownership skeleton for a new subsystem or major product surface before broad implementation begins.
---

# subsystem-hygiene

Use this when the user is introducing a new subsystem, a major new product surface, or a large split from an existing center of gravity and wants to avoid baking new debt in from day one.

This skill is for ownership-shape design and hardening first.
It is not a substitute for `$plan`, `$implement`, or `$codereview`.

## Hard Rules

- Do not approve a new subsystem shape without one thin public seam.
- Do not approve a new subsystem shape without focused internal owners by concern family.
- Do not approve a new subsystem shape without explicit state and lifecycle ownership.
- Do not approve a new subsystem shape without docs lockstep.
- Do not approve a new subsystem shape without at least one structural guard that would fail on regression.
- Do not normalize dual production paths, broad coordinators, or "we will clean it up later" routing sinks.
- If the proposed subsystem cannot be explained cleanly in a one-owner-per-concern map, stop and narrow it before implementation.

## Required Pre-Read

- `AGENTS.md`
- `planning/master-intent.md`
- current branch/worktree state:
  - `git rev-parse --abbrev-ref HEAD`
  - `git status --short`
- the likely owning code surfaces
- the companion docs/tests/config/schema surfaces that would move with the subsystem

When product code is in scope:
- `codenexus manage status`
- `codenexus summary --subsystems`
- `codenexus query "<subsystem concept>" --owners`
- `codenexus context <primary-symbol>` when a likely anchor exists

## Required Output

Produce:

1. `Target Subsystem`
2. `Thin Public Seam`
3. `Focused Internal Owners`
4. `State And Lifecycle Owner`
5. `Concern Boundaries`
6. `Structural Guard`
7. `Docs Lockstep`
8. `Validation Hooks`
9. `Rejection Conditions`

## Output Rules

- `Thin Public Seam`: name the single entry surface callers should touch.
- `Focused Internal Owners`: map each concern family to one owner file/module/class.
- `State And Lifecycle Owner`: name where mutable state, caches, or runtime lifecycle live and how they reset.
- `Concern Boundaries`: state what each owner may not absorb.
- `Structural Guard`: name at least one reviewable or mechanical guard such as a focused test, ownership assertion, docs contract, or ranking/shape check.
- `Docs Lockstep`: name the durable `docs/` surface that must move with the subsystem.
- `Validation Hooks`: name the minimum checks needed before the subsystem is allowed to expand.
- `Rejection Conditions`: say what structural smells would make the proposed shape unacceptable before coding starts.

## Quality Bar

- Favor fewer owners with crisp boundaries over many tiny helpers with unclear authority.
- Prefer deleting or narrowing an over-broad subsystem idea instead of accommodating it with extra layers.
- The result must make later `$plan`, `$implement`, and `$codereview` stricter and easier, not more ceremonial.
