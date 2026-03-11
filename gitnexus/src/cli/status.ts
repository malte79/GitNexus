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
  if (state.liveHealth) {
    console.log(`Service: running (pid ${state.liveHealth.pid} on port ${state.liveHealth.port})`);
    console.log(`Service mode: ${state.liveHealth.mode}`);
    if (state.liveHealth.loaded_index.indexed_head) {
      console.log(`Loaded service commit: ${state.liveHealth.loaded_index.indexed_head.slice(0, 7)}`);
    }
    if (state.liveHealth.reload_error) {
      console.log(`Reload error: ${state.liveHealth.reload_error}`);
    }
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
  if (state.baseState === 'indexed_stale') {
    console.log('Refresh action: run `codenexus index` to refresh the on-disk index.');
  }
  if (state.baseState === 'serving_stale') {
    if (state.liveHealth?.reload_error) {
      if (state.liveHealth.mode === 'background') {
        console.log('Reload action: run `codenexus restart` to recover from the last live-reload failure.');
      } else {
        console.log('Reload action: stop and rerun `codenexus serve` to recover from the last live-reload failure.');
      }
    } else if (state.detailFlags.includes('service_restart_required')) {
      console.log('Reload action: the live service is still adopting the refreshed on-disk index. Check `codenexus status` again shortly.');
    } else {
      console.log('Refresh action: run `codenexus index` to refresh the on-disk index. The live service will adopt the refreshed index automatically.');
    }
  }
  if (state.detailFlags.includes('runtime_metadata_stale') && state.liveHealth) {
    console.log('Runtime metadata: stale; live service health overrode advisory runtime.json.');
  }
};
