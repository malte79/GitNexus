import { runRepoToolCommand } from './mcp-command-client.js';

export async function planChangeCommand(
  terms: string[] | undefined,
  options: {
    taskContext?: string;
    maxSurfaces?: number;
  },
): Promise<void> {
  const goal = terms?.join(' ').trim();
  if (!goal) {
    console.error('Change goal is required. Usage: `gnexus plan-change <goal...>`.');
    process.exitCode = 1;
    return;
  }

  await runRepoToolCommand('plan_change', {
    goal,
    ...(options.taskContext ? { task_context: options.taskContext } : {}),
    ...(Number.isInteger(options.maxSurfaces) ? { max_surfaces: options.maxSurfaces } : {}),
  });
}
