# GNexus

Headless repo-local code intelligence for AI agents.

GNexus indexes one repository into a local graph, exposes that graph through a repo-local MCP-over-HTTP service, and gives agents a small CLI for query, context, impact, rename, summary, and operational lifecycle work.

## Product Shape

- one supported executable: `gnexus`
- one repo-local state boundary: `.gnexus/`
- one primary runtime: repo-local MCP over HTTP
- one primary audience: AI agents
- one primary storage engine: Kuzu

There are no legacy aliases in the supported product surface. `codenexus`, `.codenexus/`, and `gitnexus://` are retired.

## Quick Start

From this source checkout:

```bash
npm install --prefix gitnexus
npm run build --prefix gitnexus
cd gitnexus && npm link
```

Inside the repository you want to index:

```bash
gnexus manage init
gnexus manage index
gnexus manage start
gnexus help
```

That creates `.gnexus/`, builds the local graph, starts the repo-local service, and exposes the everyday analysis commands.

## Everyday Commands

```bash
gnexus query "http lifecycle router"
gnexus query "http lifecycle router" --owners
gnexus context Router --file-path src/http/router.ts
gnexus impact Router --direction upstream
gnexus detect-changes
gnexus rename Router --new-name RequestRouter
gnexus summary --subsystems
```

Admin and lifecycle commands live under `gnexus manage`:

```bash
gnexus manage init
gnexus manage index
gnexus manage status
gnexus manage serve
gnexus manage start
gnexus manage stop
gnexus manage restart
```

## MCP Resources

GNexus exposes these repo-local resources:

- `gnexus://context`
- `gnexus://clusters`
- `gnexus://processes`
- `gnexus://schema`
- `gnexus://properties`
- `gnexus://cluster/{name}`
- `gnexus://process/{name}`
- `gnexus://properties/{nodeType}`

## Repo State

All repo-local state lives under `.gnexus/`:

- `.gnexus/config.toml`
- `.gnexus/meta.json`
- `.gnexus/kuzu/`
- `.gnexus/runtime.json`
- `.gnexus/index.lock`

GNexus does not mutate files outside `.gnexus/` as part of normal runtime or indexing behavior.

## Requirements

- Node.js >= 18
- a git repository

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
