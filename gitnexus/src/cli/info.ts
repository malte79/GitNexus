export function renderInfoMarkdown(): string {
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

## Repo Lifecycle

From the repo you want to work in, use this lifecycle:

\`\`\`bash
codenexus init
codenexus index
codenexus status
codenexus serve
codenexus start
codenexus stop
codenexus restart
\`\`\`

What each command does:

- \`codenexus init\`: create repo-local CodeNexus config in \`.codenexus/config.toml\`
- \`codenexus index\`: build or refresh the on-disk index
- \`codenexus status\`: show repo, index, and live service state
- \`codenexus serve\`: start the repo-local HTTP service in the foreground
- \`codenexus start\`: start the repo-local HTTP service in background mode
- \`codenexus stop\`: stop the repo-local background service
- \`codenexus restart\`: restart the repo-local background service

## Freshness

- \`codenexus index\` is the manual refresh path
- \`codenexus start\` enables background auto-indexing by default on a 5 minute interval (configurable in \`.codenexus/config.toml\`)
- foreground \`codenexus serve\` does not run background auto-indexing
- if a CodeNexus service is already running, reindexing refreshes disk and the live service adopts the rebuilt index automatically in the normal path
- if live reload fails, use \`codenexus restart\` for a background service or restart foreground \`codenexus serve\` manually
- if you need certainty immediately, run \`codenexus index\` manually instead of waiting for the background interval

## Suggested AGENTS.md Snippet

\`\`\`md
## CodeNexus

This repo uses CodeNexus for repo-local code intelligence. Agents working here will use it during normal analysis and change work.

Common workflow:
- \`codenexus status\`
- \`codenexus index\`
- \`codenexus start\`

Important:
- \`.codenexus/\` is repo-local state and should usually be gitignored
- \`codenexus index\` is the manual refresh path
- background \`codenexus start\` enables automatic reindex on the configured interval (5 minutes by default)
- a live service adopts rebuilt indexes automatically in the normal path
- if live reload fails, use \`codenexus restart\` (background) or restart foreground \`codenexus serve\`
\`\`\`

## Where CodeNexus Helps Most

### Planning

Agents should use CodeNexus before broad grep to map subsystems, identify the right files, and understand imports, callers, and boundaries.

### Implementing

Agents should use CodeNexus to find the correct symbols and files quickly, then verify surrounding relationships before editing.

### Refactoring

Agents should use CodeNexus aggressively for refactors. It is one of the strongest fits for the tool: use it to trace cross-file dependencies, boundary crossings, module relationships, and the likely blast radius of structural changes before moving code around.

### Background Freshness

Agents using background mode should expect CodeNexus to keep the repo reasonably fresh on its configured interval. When immediate freshness matters, they will still run \`codenexus index\` directly instead of waiting for the next background cycle.

## Supported Scope

- Works best on supported indexed languages
- Roblox support is currently strongest for Rojo-based repos using \`default.project.json\`
- \`.codenexus/\` is the only repo-local state boundary CodeNexus owns
`;
}

export async function infoCommand(): Promise<void> {
  process.stdout.write(`${renderInfoMarkdown()}\n`);
}
