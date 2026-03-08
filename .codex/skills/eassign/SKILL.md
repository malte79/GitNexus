---
name: eassign
description: Compatibility alias for epic-assign. Assign an epic by moving it from planning/epics/backlog to planning/epics/doing, setting ownership, and setting Status: doing.
---

# eassign

Alias for `epic-assign`.
Use the same workflow and constraints.
Default owner is lane-derived: `Assigned to: Agent <n>` from `rsproxy-agent-<n>` when no owner is provided.
Always set `Status: doing` when assigning.
