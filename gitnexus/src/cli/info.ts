export function renderHelpMarkdown(): string {
  return `# CodeNexus

CodeNexus is the repo-local CLI for structural analysis, indexing, and service lifecycle.

Use the top-level \`codenexus\` commands for everyday analysis work.
Use \`codenexus manage ...\` when you need to initialize a repo, refresh the index, check status, or recover the service.

## Everyday Commands

- \`codenexus query\`: broad discovery for files, symbols, and subsystem entrypoints
- \`codenexus query --owners\`: bias broad discovery toward likely production owners
- \`codenexus context\`: inspect one symbol in depth
- \`codenexus impact\`: estimate blast radius before changing a symbol
- \`codenexus detect-changes\`: trace the effect of local git changes
- \`codenexus cypher\`: ask an advanced read-only graph question
- \`codenexus rename\`: preview or apply a coordinated rename
- \`codenexus summary\`: get a compact structural summary
- \`codenexus summary --subsystems\`: get a subsystem-oriented architectural view

## Admin Commands

- \`codenexus manage init\`: create repo-local CodeNexus config
- \`codenexus manage index\`: build or refresh the repo-local index
- \`codenexus manage status\`: show repo, index, and service state
- \`codenexus manage start\`: start the background service
- \`codenexus manage restart\`: restart the background service after a refresh problem
- \`codenexus manage stop\`: stop the background service
- \`codenexus manage serve\`: run the service in the foreground

## Normal Workflow

\`\`\`bash
codenexus manage init
codenexus manage index
codenexus manage start
codenexus manage status

codenexus summary --subsystems
codenexus query "bridge http lifecycle status start stop studio automation" --owners
codenexus context CommandBridgeHandler --file typed/bridge/http
codenexus impact ProtocolRouter --direction upstream --max-depth 4
\`\`\`

## Recovery

- if the service is down, run \`codenexus manage start\`
- if \`codenexus manage status\` says the repo is stale, run \`codenexus manage index\`
- if the service does not pick up a fresh index, run \`codenexus manage restart\`
- if you need certainty immediately, run \`codenexus manage index\` instead of waiting for background refresh

## Command Guide

### \`query\`

Good for:
- subsystem discovery
- “where does this behavior live?”
- finding likely production owners before editing

Examples:

\`\`\`bash
codenexus query round start show logic
codenexus query bridge http lifecycle status start stop studio automation
codenexus query bridge http lifecycle status start stop studio automation --owners
\`\`\`

Notes:
- default \`query\` is broad discovery
- \`query --owners\` is the owner-biased mode for “show me the main owners of this subsystem”

### \`context\`

Good for:
- “show me callers of this symbol”
- understanding one module before changing it
- disambiguating symbols with the same name

Examples:

\`\`\`bash
codenexus context SpotlightRegistry
codenexus context CommandBridgeHandler --file typed/bridge/http
\`\`\`

Notes:
- \`context\` accepts both \`--file-path\` and the shorthand \`--file\`

### \`impact\`

Good for:
- “what breaks if I change this module?”
- dependency-risk checks
- refactor safety checks

Examples:

\`\`\`bash
codenexus impact LightingShowService --direction upstream
codenexus impact ProtocolRouter --direction upstream --max-depth 4
codenexus impact onTransportClosed --file-path typed/plugin/runtime/runtime_manager.lua --direction upstream --max-depth 4
\`\`\`

### \`detect-changes\`

Good for:
- pre-commit review
- tracing changed symbols into affected execution flows
- checking whether a local edit touched a sensitive area

Examples:

\`\`\`bash
codenexus detect-changes
codenexus detect-changes --scope compare --base-ref main
\`\`\`

### \`cypher\`

Good for:
- advanced read-only graph questions
- custom caller or importer reports
- one-off structural exploration when higher-level commands are too opinionated

Example:

\`\`\`bash
codenexus cypher "MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: 'start'}) RETURN a.name, a.filePath LIMIT 20"
\`\`\`

### \`rename\`

Good for:
- cross-file rename preview
- safer refactors than blind search-and-replace
- checking rename confidence before editing

Examples:

\`\`\`bash
codenexus rename LightingShowService --new-name ShowLightingService
codenexus rename UIService --file-path src/server/Game/UIService.lua --new-name GameUIService --apply
\`\`\`

### \`summary\`

Good for:
- fast repo orientation
- subsystem and hotspot discovery
- first-pass refactor ranking before a deeper dive

Examples:

\`\`\`bash
codenexus summary
codenexus summary --limit 10 --no-processes
codenexus summary --subsystems --limit 8
\`\`\`

Notes:
- \`summary --subsystems\` stays read-only
- use it to identify likely owners and hotspots before drilling deeper with \`query\`, \`context\`, and \`impact\`
`;
}

export function renderInfoMarkdown(): string {
  return renderHelpMarkdown();
}

export async function helpCommand(): Promise<void> {
  process.stdout.write(`${renderHelpMarkdown()}\n`);
}
