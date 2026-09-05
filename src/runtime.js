import { WorkflowOrchestrator } from './orchestrator.js';
import { createGitHubAdapter } from './adapters/github.js';
import { createIssueGateway } from './adapters/issue-gateway.js';
import { createExecutionEngine } from './execution-engine.js';

export function createProductionWorkflow({ productPath, c2c, projectResolver, credentialStore, credentialKey, repository, request, evidenceProvider, issueGateway, executionEngine, childAdapter, gitAdapter, integrate, test }) {
  const github = createGitHubAdapter({ credentialStore, credentialKey, repository, request });
  if (!issueGateway) throw new Error('production workflow requires an Issue #4 gateway');
  const engine = executionEngine ?? (childAdapter && gitAdapter ? createExecutionEngine({ root: productPath, childAdapter, gitAdapter, integrate, test }) : null);
  return new WorkflowOrchestrator(productPath, github, evidenceProvider, c2c, null, projectResolver, repository, engine, createIssueGateway(issueGateway));
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
