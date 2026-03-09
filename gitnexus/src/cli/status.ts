/**
 * Status Command
 * 
 * Shows the indexing status of the current repository.
 */

import { getRepoState } from '../storage/repo-manager.js';
import { isGitRepo } from '../storage/git.js';

export const statusCommand = async () => {
  const cwd = process.cwd();
  
  if (!isGitRepo(cwd)) {
    console.log('Not a git repository.');
    process.exitCode = 1;
    return;
  }

  const state = await getRepoState(cwd);
  if (!state) {
    console.log('Not a git repository.');
    process.exitCode = 1;
    return;
  }

  console.log(`Repository: ${state.repoRoot}`);
  console.log(`State: ${state.baseState}`);
  if (state.config) {
    console.log(`Configured port: ${state.config.port}`);
  }
  if (state.meta) {
    console.log(`Indexed: ${new Date(state.meta.indexed_at).toLocaleString()}`);
    if (state.meta.indexed_head) {
      console.log(`Indexed commit: ${state.meta.indexed_head.slice(0, 7)}`);
    }
  }
  if (state.currentHead) {
    console.log(`Current commit: ${state.currentHead.slice(0, 7)}`);
  }
  if (state.detailFlags.length > 0) {
    console.log(`Flags: ${state.detailFlags.join(', ')}`);
  }
  if (state.configError) {
    console.log(`Config error: ${state.configError}`);
  }
};
