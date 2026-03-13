export function renderHelpMarkdown(): string {
  return `# CodeNexus

Agents working in a repo that uses CodeNexus will use it as part of normal code analysis, planning, implementation, and refactoring work.

## Install

\`\`\`bash
cd /Users/alex/Projects/GitNexusFork-agent-1/gitnexus
npm install
npm run build
npm link
\`\`\`

This installs the \`codenexus\` command on your machine from the current local checkout.

## Command Shape

CodeNexus now separates use from administration:

\`\`\`bash
codenexus help
codenexus query <terms...>
codenexus query <terms...> --owners
codenexus context <name>
codenexus impact <target> --direction upstream
codenexus detect-changes
codenexus cypher <query...>
codenexus rename <symbol> --new-name <name>
codenexus summary
codenexus summary --subsystems
codenexus manage <subcommand>
\`\`\`

Use plane:
- \`codenexus help\`: explain the CLI surface and the direct MCP path
- \`codenexus query\`: find relevant symbols and execution flows
- \`codenexus query --owners\`: bias broad discovery toward likely production owners and entrypoint surfaces
- \`codenexus context\`: inspect one symbol in depth
- \`codenexus impact\`: estimate blast radius before changing a symbol
- \`codenexus detect-changes\`: analyze local git changes and affected flows
- \`codenexus cypher\`: ask a custom read-only graph question
- \`codenexus rename\`: preview or apply a coordinated rename
- \`codenexus summary\`: show a compact repo or subsystem summary
- \`codenexus summary --subsystems\`: show a subsystem-oriented architectural view derived from indexed graph facts, including owners, hot anchors, and hot processes

Manage plane:
- \`codenexus manage init\`: create repo-local CodeNexus config in \`.codenexus/config.toml\`
- \`codenexus manage index\`: build or refresh the on-disk index
- \`codenexus manage status\`: show repo, index, and live service state
- \`codenexus manage serve\`: start the repo-local HTTP service in the foreground
- \`codenexus manage start\`: start the repo-local HTTP service in background mode
- \`codenexus manage stop\`: stop the repo-local background service
- \`codenexus manage restart\`: restart the repo-local background service

## Service Requirement

The top-level structural commands still use the repo-local MCP HTTP service. They do not bypass it.

Normal setup from the repo you want to analyze:

\`\`\`bash
codenexus manage init
codenexus manage index
codenexus manage start
codenexus manage status
\`\`\`

If a top-level structural command says the service is unavailable, the normal remediation is:

\`\`\`bash
codenexus manage start
\`\`\`

## Freshness

- \`codenexus manage index\` is the manual refresh path
- \`codenexus manage start\` enables background auto-indexing by default on a 5 minute interval (configurable in \`.codenexus/config.toml\`)
- foreground \`codenexus manage serve\` does not run background auto-indexing
- if a CodeNexus service is already running, reindexing refreshes disk and the live service adopts the rebuilt index automatically in the normal path
- if live reload fails, use \`codenexus manage restart\` for a background service or restart foreground \`codenexus manage serve\` manually
- if you need certainty immediately, run \`codenexus manage index\` manually instead of waiting for the background interval

## Everyday CLI Use

### \`query\`

Good for:
- subsystem discovery
- “where does this behavior live?”
- finding the most relevant files before editing

CLI examples:

\`\`\`bash
codenexus query round start show logic
codenexus query bridge http lifecycle status start stop studio automation
codenexus query typed bridge http lifecycle status start stop studio automation --owners
\`\`\`

Notes:
- default \`query\` is still broad discovery
- \`query --owners\` is the owner-biased mode for “show me the main production owners of this subsystem”

### \`context\`

Good for:
- “show me callers of this symbol”
- understanding one module before changing it
- disambiguating symbols with the same name

CLI examples:

\`\`\`bash
codenexus context SpotlightRegistry
codenexus context CommandBridgeHandler --file-path typed/bridge/http
\`\`\`

Notes:
- weak Luau returned-table wrappers may show only the delegate members that are explicitly exported by the returned table
- when that happens, CodeNexus now says so directly instead of pretending the module is fully covered

### \`impact\`

Good for:
- “what breaks if I change this module?”
- fan-in and dependency-risk checks
- refactor safety checks

CLI examples:

\`\`\`bash
codenexus impact LightingShowService --direction upstream
codenexus impact ProtocolRouter --direction upstream --max-depth 4
codenexus impact onTransportClosed --file-path typed/plugin/runtime/runtime_manager.lua --direction upstream --max-depth 4
\`\`\`

Notes:
- when process or community memberships are not grounded strongly enough, \`impact\` may return \`affected_areas\` alongside partial confidence so the system effect is still visible
- this is additive guidance, not a hidden fallback blast-radius mode
- \`impact\` also returns machine-readable confidence signals so you can see whether member coverage, edge coverage, or higher-level propagation is the weak part
- signal fields include \`member_coverage\`, \`incoming_edges\`, \`outgoing_edges\`, and \`higher_level_propagation\`

### \`detect-changes\`

Good for:
- pre-commit review
- tracing changed symbols into affected execution flows
- checking whether a local edit touched a sensitive area

CLI examples:

\`\`\`bash
codenexus detect-changes
codenexus detect-changes --scope compare --base-ref main
\`\`\`

### \`cypher\`

Good for:
- subsystem dependency graph queries
- custom caller or importer reports
- one-off graph exploration

CLI examples:

\`\`\`bash
codenexus cypher "MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: 'start'}) RETURN a.name, a.filePath LIMIT 20"
\`\`\`

When Cypher fails on a near miss such as \`type(r)\` or a missing property such as \`File.lineCount\`, use the schema and property guidance from the tool output or the direct MCP resources:
- \`gitnexus://schema\`
- \`gitnexus://properties\`
- \`gitnexus://properties/File\`

### \`rename\`

Good for:
- cross-file symbol rename preview
- safer refactors than blind search-and-replace
- checking rename confidence before editing

CLI examples:

\`\`\`bash
codenexus rename LightingShowService --new-name ShowLightingService
codenexus rename UIService --file-path src/server/Game/UIService.lua --new-name GameUIService --apply
\`\`\`

### \`summary\`

Good for:
- top central symbols by subsystem
- production-versus-test concentration
- initial refactor ranking before a deeper dive

CLI examples:

\`\`\`bash
codenexus summary
codenexus summary --limit 10 --no-processes
codenexus summary --subsystems --limit 8
\`\`\`

Notes:
- \`summary --subsystems\` stays read-only and is derived from existing graph facts only
- subsystem rows include top owners, hot anchors, and hot processes so architectural hotspots are visible without hand-stitching clusters together
- if subsystem labels are weak, CodeNexus should show fewer rows rather than inventing architecture

## Using The HTTP Service

The top-level structural commands are thin wrappers over the repo-local MCP HTTP service. Direct MCP access is still the advanced path when you want to script or integrate with the tool directly.

Start the service from the repo you want to analyze:

\`\`\`bash
codenexus manage start
codenexus manage status
\`\`\`

Use \`codenexus manage status\` to confirm the configured port. By default, CodeNexus uses port \`4747\`, so the service URL is usually:

\`\`\`text
http://127.0.0.1:4747/api/mcp
\`\`\`

The health endpoint is:

\`\`\`text
http://127.0.0.1:4747/api/health
\`\`\`

Quick health check:

\`\`\`bash
curl http://127.0.0.1:4747/api/health
\`\`\`

CodeNexus speaks MCP over Streamable HTTP at \`/api/mcp\`. The simplest way to use it is with an MCP client or a small SDK script.

### Minimal Node Client

\`\`\`js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:4747/api/mcp'),
);

const client = new Client({
  name: 'local-codenexus-client',
  version: '0.1.0',
});

await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map((tool) => tool.name));

const result = await client.callTool({
  name: 'query',
  arguments: {
    query: 'lighting show service',
  },
});

console.log(JSON.stringify(result, null, 2));

await client.close();
\`\`\`

### Tool Use Cases And Example Calls

These examples use the direct MCP path. The equivalent top-level CLI commands are usually simpler for day-to-day use.

#### \`query\`

Use this to find the main symbols and execution flows related to a concept.

Good for:
- subsystem discovery
- “where does this behavior live?”
- finding the most relevant files before editing

Example queries:
- \`lighting show service\`
- \`round start show logic\`
- \`client wallet UI\`

Example call:

\`\`\`js
await client.callTool({
  name: 'query',
  arguments: {
    query: 'round start show logic',
    limit: 5,
    max_symbols: 10,
  },
});
\`\`\`

#### \`context\`

Use this to inspect one symbol in depth: callers, callees, process participation, file location, and surrounding context.

Good for:
- “show me callers of this symbol”
- understanding one module before changing it
- disambiguating symbols with the same name
- explaining why a thin returned-module wrapper only exposes a small grounded member set

Example queries:
- \`SpotlightRegistry\`
- \`LightingShowService\`
- \`RoundCoordinator\`

Example call:

\`\`\`js
await client.callTool({
  name: 'context',
  arguments: {
    name: 'SpotlightRegistry',
    include_content: false,
  },
});
\`\`\`

#### \`impact\`

Use this to estimate blast radius before changing a symbol.

Good for:
- “what breaks if I change this module?”
- fan-in and dependency-risk checks
- refactor safety checks
- seeing affected file areas even when process or community propagation is still partial

Example queries:
- upstream impact of \`LightingShowService\`
- upstream impact of \`UIService\`
- downstream dependencies of \`RoundCoordinator\`

Example call:

\`\`\`js
await client.callTool({
  name: 'impact',
  arguments: {
    target: 'LightingShowService',
    direction: 'upstream',
    maxDepth: 3,
  },
});
\`\`\`

#### \`cypher\`

Use this for custom graph questions that the higher-level tools do not answer directly.

Good for:
- subsystem dependency graph queries
- custom caller or importer reports
- one-off graph exploration

Example queries:
- modules that import across runtime boundaries
- files in a specific community
- callers of one function with a custom filter

Example call:

\`\`\`js
await client.callTool({
  name: 'cypher',
  arguments: {
    query: "MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: 'start'}) RETURN a.name, a.filePath LIMIT 20",
  },
});
\`\`\`

#### \`detect_changes\`

Use this to understand what your current git diff affects.

Good for:
- pre-commit review
- tracing changed symbols into affected execution flows
- checking whether a local edit touched a sensitive area

Example queries:
- unstaged changes
- staged changes
- compare current branch to \`main\`

Example calls:

\`\`\`js
await client.callTool({
  name: 'detect_changes',
  arguments: {
    scope: 'unstaged',
  },
});

await client.callTool({
  name: 'detect_changes',
  arguments: {
    scope: 'compare',
    base_ref: 'main',
  },
});
\`\`\`

#### \`rename\`

Use this to preview a coordinated multi-file rename driven by graph and text-search evidence.

Good for:
- cross-file symbol rename preview
- safer refactors than blind search-and-replace
- checking rename confidence before editing

Example queries:
- rename \`LightingShowService\` to \`ShowLightingService\`
- rename \`UIService\` in one file path scope

Example call:

\`\`\`js
await client.callTool({
  name: 'rename',
  arguments: {
    symbol_name: 'LightingShowService',
    new_name: 'ShowLightingService',
    dry_run: true,
  },
});
\`\`\`

### Typical Workflows

- Find the right subsystem:
  Start with \`query\`, then use \`context\` on the top symbol.
- Check change risk:
  Use \`context\` first, then \`impact\`.
- Investigate a local diff:
  Use \`detect_changes\`, then drill into high-risk symbols with \`context\`.
- Ask a custom graph question:
  Use \`cypher\` when the higher-level tools are too opinionated.

## Suggested AGENTS.md Snippet

\`\`\`md
## CodeNexus

This repo uses CodeNexus for repo-local code intelligence. Agents working here will use it during normal analysis and change work.

Common workflow:
- \`codenexus help\`
- \`codenexus manage status\`
- \`codenexus manage index\`
- \`codenexus manage start\`

Important:
- \`.codenexus/\` is repo-local state and should usually be gitignored
- \`codenexus manage index\` is the manual refresh path
- background \`codenexus manage start\` enables automatic reindex on the configured interval (5 minutes by default)
- a live service adopts rebuilt indexes automatically in the normal path
- if live reload fails, use \`codenexus manage restart\` (background) or restart foreground \`codenexus manage serve\`
- richer structural queries are available through the repo-local MCP HTTP service at \`/api/mcp\`
\`\`\`

## Where CodeNexus Helps Most

### Planning

Agents should use CodeNexus before broad grep to map subsystems, identify the right files, and understand imports, callers, and boundaries.

### Implementing

Agents should use CodeNexus to find the correct symbols and files quickly, then verify surrounding relationships before editing.

### Refactoring

Agents should use CodeNexus aggressively for refactors. It is one of the strongest fits for the tool: use it to trace cross-file dependencies, boundary crossings, module relationships, and the likely blast radius of structural changes before moving code around.

### Background Freshness

Agents using background mode should expect CodeNexus to keep the repo reasonably fresh on its configured interval. When immediate freshness matters, they will still run \`codenexus manage index\` directly instead of waiting for the next background cycle.

## Supported Scope

- Works best on supported indexed languages
- Roblox support is currently strongest for Rojo-based repos using \`default.project.json\`
- \`.codenexus/\` is the only repo-local state boundary CodeNexus owns
`;
}

export function renderInfoMarkdown(): string {
  return renderHelpMarkdown();
}

export async function helpCommand(): Promise<void> {
  process.stdout.write(`${renderHelpMarkdown()}\n`);
}
