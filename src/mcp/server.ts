/**
 * MCP Server
 *
 * Model Context Protocol server factory.
 * The repo-local HTTP runtime is now the primary service surface; stdio
 * remains only as an internal compatibility transport helper.
 */

import { createRequire } from 'module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CompatibleStdioServerTransport } from './compatible-stdio-transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GITNEXUS_TOOLS } from './tools.js';
import type { LocalBackend } from './local/local-backend.js';
import { getResourceDefinitions, getResourceTemplates, readResource } from './resources.js';

/**
 * Next-step hints appended to tool responses.
 *
 * Agents often stop after one tool call. These hints guide them to the
 * logical next action, creating a self-guiding workflow without hooks.
 *
 * Design: Each hint is a short, actionable instruction (not a suggestion).
 * The hint references the specific tool/resource to use next.
 */
function getNextStepHint(toolName: string, args: Record<string, any> | undefined): string {
  switch (toolName) {
    case 'summary':
      return `\n\n---\n**Next:** Use query({query: "<concept>"}) to drill into a subsystem, or context({name: "<symbol_name>"}) to inspect one central symbol.`;

    case 'query':
      return `\n\n---\n**Next:** To understand a specific symbol in depth, use context({name: "<symbol_name>"}) to see categorized refs and process participation.`;

    case 'context':
      return `\n\n---\n**Next:** If planning changes, use impact({target: "${args?.name || '<name>'}", direction: "upstream"}) to check blast radius. To see execution flows, READ gnexus://processes.`;

    case 'impact':
      return `\n\n---\n**Next:** Use plan_change({goal: "describe the intended change"}) to turn this blast radius into a bounded change contract.`;

    case 'plan_change':
      return `\n\n---\n**Next:** Use verify_change({goal: "${args?.goal || '<goal>'}"}) after editing to compare the real change set against this contract.`;

    case 'verify_change':
      return `\n\n---\n**Next:** Review missing grounded surfaces first. If contract_insufficiency is non-empty, regenerate plan_change() before widening the edit set.`;

    case 'detect_changes':
      return `\n\n---\n**Next:** Use verify_change({goal: "<goal>"}) to compare this change set against a bounded change contract.`;

    case 'rename':
      return `\n\n---\n**Next:** Run detect_changes() to verify no unexpected side effects from the rename.`;

    case 'cypher':
      return `\n\n---\n**Next:** To explore a result symbol, use context({name: "<name>"}). For schema reference, READ gnexus://schema.`;

    // Legacy tool names — still return useful hints
    case 'search':
      return `\n\n---\n**Next:** To understand a result in context, use context({name: "<symbol_name>"}).`;
    case 'explore':
      return `\n\n---\n**Next:** If planning changes, use impact({target: "<name>", direction: "upstream"}).`;
    case 'overview':
      return `\n\n---\n**Next:** To drill into an area, READ gnexus://cluster/{name}. To see execution flows, READ gnexus://processes.`;

    default:
      return '';
  }
}

/**
 * Create a configured MCP Server with all handlers registered.
 * Transport-agnostic — caller connects the desired transport.
 */
export function createMCPServer(backend: LocalBackend): Server {
  const require = createRequire(import.meta.url);
  const pkgVersion: string = require('../../package.json').version;
  const server = new Server(
    {
      name: 'gnexus',
      version: pkgVersion,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Handle list resources request
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = getResourceDefinitions();
    return {
      resources: resources.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  // Handle list resource templates request (for dynamic resources)
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const templates = getResourceTemplates();
    return {
      resourceTemplates: templates.map(t => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      const content = await readResource(uri, backend);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/yaml',
            text: content,
          },
        ],
      };
    } catch (err: any) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Error: ${err.message}`,
          },
        ],
      };
    }
  });


  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GITNEXUS_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  // Handle tool calls — append next-step hints to guide agent workflow
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await backend.callTool(name, args);
      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const hint = getNextStepHint(name, args as Record<string, any> | undefined);

      return {
        content: [
          {
            type: 'text',
            text: resultText + hint,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });
  return server;
}

/**
 * Start the MCP server on stdio transport (for CLI use).
 */
export async function startMCPServer(backend: LocalBackend): Promise<void> {
  const server = createMCPServer(backend);

  // Connect to stdio transport
  const transport = new CompatibleStdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown helper
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await backend.disconnect(); } catch {}
    try { await server.close(); } catch {}
    process.exit(0);
  };

  // Handle graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Handle stdio errors — stdin close means the parent process is gone
  process.stdin.on('end', shutdown);
  process.stdin.on('error', () => shutdown());
  process.stdout.on('error', () => shutdown());
}
