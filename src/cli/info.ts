export function renderHelpMarkdown(): string {
  return `# gnexus

gnexus is the repo-local CLI for structural analysis, indexing, and service lifecycle.

Use the top-level \`gnexus\` commands for everyday analysis work.
Use \`gnexus manage ...\` when you need to initialize a repo, refresh the index, check status, or recover the service.

## Everyday Commands

- \`gnexus query\`: broad discovery for files, symbols, and subsystem entrypoints
- \`gnexus query --owners\`: bias broad discovery toward likely production owners
- \`gnexus context\`: inspect one symbol in depth
- \`gnexus impact\`: estimate blast radius before changing a symbol
- \`gnexus detect-changes\`: trace the effect of local git changes
- \`gnexus cypher\`: ask an advanced read-only graph question
- \`gnexus rename\`: preview or apply a coordinated rename
- \`gnexus summary\`: get a compact structural summary
- \`gnexus summary --subsystems\`: get a subsystem-oriented architectural view
- \`gnexus summary --subsystems-detailed\`: inspect the full detailed subsystem breakdown

## Admin Commands

- \`gnexus manage init\`: create repo-local gnexus config
- \`gnexus manage index\`: build or refresh the repo-local index
- \`gnexus manage status\`: show repo, index, and service state
- \`gnexus manage start\`: start the background service
- \`gnexus manage restart\`: restart the background service after a refresh problem
- \`gnexus manage stop\`: stop the background service
- \`gnexus manage serve\`: run the service in the foreground

## Normal Workflow

\`\`\`bash
gnexus manage init
gnexus manage index
gnexus manage start
gnexus manage status

gnexus summary --subsystems
gnexus query "bridge http lifecycle status start stop studio automation" --owners
gnexus context CommandBridgeHandler --file typed/bridge/http
gnexus impact ProtocolRouter --direction upstream --max-depth 4
\`\`\`

## Recovery

- if the service is down, run \`gnexus manage start\`
- if \`gnexus manage status\` says the repo is stale, run \`gnexus manage index\`
- if the service does not pick up a fresh index, run \`gnexus manage restart\`
- if you need certainty immediately, run \`gnexus manage index\` instead of waiting for background refresh

## Command Guide

### \`query\`

Good for:
- subsystem discovery
- “where does this behavior live?”
- finding likely production owners before editing

Examples:

\`\`\`bash
gnexus query round start show logic
gnexus query bridge http lifecycle status start stop studio automation
gnexus query bridge http lifecycle status start stop studio automation --owners
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
gnexus context SpotlightRegistry
gnexus context CommandBridgeHandler --file typed/bridge/http
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
gnexus impact LightingShowService --direction upstream
gnexus impact ProtocolRouter --direction upstream --max-depth 4
gnexus impact onTransportClosed --file-path typed/plugin/runtime/runtime_manager.lua --direction upstream --max-depth 4
\`\`\`

### \`detect-changes\`

Good for:
- pre-commit review
- tracing changed symbols into affected execution flows
- checking whether a local edit touched a sensitive area

Examples:

\`\`\`bash
gnexus detect-changes
gnexus detect-changes --scope compare --base-ref main
\`\`\`

### \`cypher\`

Good for:
- advanced read-only graph questions
- custom caller or importer reports
- one-off structural exploration when higher-level commands are too opinionated

Example:

\`\`\`bash
gnexus cypher "MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: 'start'}) RETURN a.name, a.filePath LIMIT 20"
\`\`\`

### \`rename\`

Good for:
- cross-file rename preview
- safer refactors than blind search-and-replace
- checking rename confidence before editing

Examples:

\`\`\`bash
gnexus rename LightingShowService --new-name ShowLightingService
gnexus rename UIService --file-path src/server/Game/UIService.lua --new-name GameUIService --apply
\`\`\`

### \`summary\`

Good for:
- fast repo orientation
- subsystem and hotspot discovery
- first-pass refactor ranking before a deeper dive

Examples:

\`\`\`bash
gnexus summary
gnexus summary --limit 10 --no-processes
gnexus summary --subsystems --limit 8
gnexus summary --subsystems-detailed --limit 4
\`\`\`

Notes:
- \`summary --subsystems\` is the concise architectural mode
- \`summary --subsystems-detailed\` keeps the full detailed subsystem breakdown
- use it to identify likely owners and hotspots before drilling deeper with \`query\`, \`context\`, and \`impact\`

### \`impact\` output

Look for:
- \`risk_dimensions\` to separate centrality, coupling breadth, lifecycle complexity, internal concentration, and boundary ambiguity
- \`risk_split\` to distinguish high change-risk seams from local refactor pressure more explicitly
- \`shape.file\` to understand overload through line count, function count, largest members, and grounded seams
`;
}

export function renderInfoMarkdown(): string {
  return renderHelpMarkdown();
}

export async function helpCommand(): Promise<void> {
  process.stdout.write(`${renderHelpMarkdown()}\n`);
}
