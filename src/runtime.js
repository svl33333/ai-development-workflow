import { WorkflowOrchestrator } from './orchestrator.js';
import { createGitHubAdapter } from './adapters/github.js';

export function createProductionWorkflow({ productPath, c2c, projectResolver, credentialStore, credentialKey, repository, request, evidenceProvider }) {
  const github = createGitHubAdapter({ credentialStore, credentialKey, repository, request });
  return new WorkflowOrchestrator(productPath, github, evidenceProvider, c2c, null, projectResolver, repository);
}

export function createCodexAdapter({ exec = async () => ({ exitCode: 0, output: '' }) } = {}) {
  return {
    async run(input) {
      const capabilities = input?.capabilities;
      if (!capabilities?.cwd || capabilities.can_publish || capabilities.can_merge || capabilities.can_modify_parent_state) throw new Error('child capabilities are not restricted');
      const result = await exec(input);
      return { status: result.exitCode === 0 ? 'SUCCEEDED' : 'FAILED', commit: result.commit ?? null, tests: result.tests ?? { exit_code: result.exitCode }, local_review: result.local_review, artifact_digest: result.artifact_digest ?? '' };
    },
    canWrite: true, canPublish: false, canMerge: false, canModifyParentState: false
  };
}
