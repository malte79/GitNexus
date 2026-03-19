/**
 * MCP Tool Definitions
 *
 * Defines the current agent-facing tool surface for one bound repo.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      default?: any;
      items?: { type: string };
      enum?: string[];
    }>;
    required: string[];
  };
}

export const GITNEXUS_TOOLS: ToolDefinition[] = [
  {
    name: 'summary',
    description: `Show a compact structural summary for the bound repo, including subsystems and central symbols.`,
    inputSchema: {
      type: 'object',
      properties: {
        showClusters: { type: 'boolean', description: 'Include subsystem or module summary (default: true)', default: true },
        showProcesses: { type: 'boolean', description: 'Include process summary (default: true)', default: true },
        showSubsystems: { type: 'boolean', description: 'Include the concise subsystem-oriented architectural summary (default: false)', default: false },
        showSubsystemDetails: { type: 'boolean', description: 'Use the detailed subsystem-oriented architectural summary (default: false)', default: false },
        limit: { type: 'number', description: 'Max clusters or processes to return (default: 20)', default: 20 },
      },
      required: [],
    },
  },
  {
    name: 'query',
    description: `Query the code knowledge graph for execution flows related to a concept.
Returns processes ranked by relevance for the bound repo.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language or keyword search query' },
        task_context: { type: 'string', description: 'What you are working on.' },
        goal: { type: 'string', description: 'What you want to find.' },
        owners: { type: 'boolean', description: 'Bias broad discovery toward likely production owners and entrypoint symbols.', default: false },
        limit: { type: 'number', description: 'Max processes to return (default: 5)', default: 5 },
        max_symbols: { type: 'number', description: 'Max symbols per process (default: 10)', default: 10 },
        include_content: { type: 'boolean', description: 'Include full symbol source code (default: false)', default: false },
      },
      required: ['query'],
    },
  },
  {
    name: 'cypher',
    description: `Execute a read-only Cypher query against the bound repo knowledge graph.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Cypher query to execute' },
      },
      required: ['query'],
    },
  },
  {
    name: 'context',
    description: `Show callers, callees, process participation, and file location for one code symbol in the bound repo.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name (for example, "validateUser")' },
        uid: { type: 'string', description: 'Direct symbol UID from prior tool results' },
        file_path: { type: 'string', description: 'File path to disambiguate common names' },
        include_content: { type: 'boolean', description: 'Include full symbol source code (default: false)', default: false },
      },
      required: [],
    },
  },
  {
    name: 'detect_changes',
    description: `Analyze uncommitted git changes and find affected execution flows in the bound repo.`,
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'What to analyze: "unstaged" (default), "staged", "all", or "compare"',
          enum: ['unstaged', 'staged', 'all', 'compare'],
          default: 'unstaged',
        },
        base_ref: { type: 'string', description: 'Branch or commit for "compare" scope (for example, "main")' },
      },
      required: [],
    },
  },
  {
    name: 'rename',
    description: `Coordinate a multi-file rename in the bound repo using graph and text-search evidence.`,
    inputSchema: {
      type: 'object',
      properties: {
        symbol_name: { type: 'string', description: 'Current symbol name to rename' },
        symbol_uid: { type: 'string', description: 'Direct symbol UID from prior tool results' },
        new_name: { type: 'string', description: 'The new name for the symbol' },
        file_path: { type: 'string', description: 'File path to disambiguate common names' },
        dry_run: { type: 'boolean', description: 'Preview edits without modifying files (default: true)', default: true },
      },
      required: ['new_name'],
    },
  },
  {
    name: 'impact',
    description: `Analyze the blast radius of changing a code symbol in the bound repo, including change-risk versus local refactor-pressure signals.`,
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Name of function, class, module, or file to analyze' },
        uid: { type: 'string', description: 'Direct symbol UID from prior results' },
        file_path: { type: 'string', description: 'File path to disambiguate common names' },
        direction: { type: 'string', description: 'upstream or downstream' },
        maxDepth: { type: 'number', description: 'Max relationship depth (default: 3)', default: 3 },
        relationTypes: { type: 'array', items: { type: 'string' }, description: 'Filter: CALLS, IMPORTS, EXTENDS, IMPLEMENTS' },
        includeTests: { type: 'boolean', description: 'Include test files (default: false)' },
        minConfidence: { type: 'number', description: 'Minimum confidence 0-1 (default: 0.7)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'plan_change',
    description: `Build a bounded-confidence change contract for a requested goal, with grounded edit surfaces, likely dependent surfaces, recommended tests, and explicit uncertainty buckets.`,
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Plain-language change goal to plan against' },
        task_context: { type: 'string', description: 'What the agent is trying to accomplish with the change' },
        max_surfaces: { type: 'number', description: 'Max required or likely edit surfaces to return (default: 6)', default: 6 },
      },
      required: ['goal'],
    },
  },
  {
    name: 'verify_change',
    description: `Verify a completed or claimed change against a bounded-confidence change contract and call out contract insufficiency separately from implementation misses.`,
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Plain-language change goal to verify against when no prior contract JSON is supplied' },
        task_context: { type: 'string', description: 'What the agent was trying to accomplish with the change' },
        contract_json: { type: 'string', description: 'Serialized change contract produced by a prior plan_change call' },
        scope: {
          type: 'string',
          description: 'What git diff state to inspect when changed_files is omitted',
          enum: ['unstaged', 'staged', 'all', 'compare'],
          default: 'unstaged',
        },
        base_ref: { type: 'string', description: 'Branch or commit for compare scope' },
        changed_files: { type: 'array', items: { type: 'string' }, description: 'Explicit changed files to verify instead of reading git diff state' },
        reported_test_targets: { type: 'array', items: { type: 'string' }, description: 'Tests or process names actually exercised during validation' },
        max_surfaces: { type: 'number', description: 'Max required or likely edit surfaces to return when regenerating a contract', default: 6 },
      },
      required: [],
    },
  },
];
