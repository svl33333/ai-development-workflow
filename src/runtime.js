import { WorkflowOrchestrator } from './orchestrator.js';
import { createGitHubAdapter } from './adapters/github.js';
import { createIssueGateway } from './adapters/issue-gateway.js';
import { createExecutionEngine } from './execution-engine.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function createProductionWorkflow({ productPath, c2c, projectResolver, credentialStore, credentialKey, repository, request, evidenceProvider, issueGateway, executionEngine, childAdapter, gitAdapter, integrate, test }) {
  const github = createGitHubAdapter({ credentialStore, credentialKey, repository, request });
  if (!issueGateway) throw new Error('production workflow requires an Issue #4 gateway');
  const engine = executionEngine ?? (childAdapter && gitAdapter && typeof integrate === 'function' && typeof test === 'function' ? createExecutionEngine({ root: productPath, childAdapter, gitAdapter, integrate, test }) : null);
  return new WorkflowOrchestrator(productPath, github, evidenceProvider, c2c, null, projectResolver, repository, engine, createIssueGateway(issueGateway));
}

export async function createCliWorkflow({ productPath, dependencies = null }) {
  if (path.resolve(productPath).includes(`${path.sep}fixtures${path.sep}`)) return new WorkflowOrchestrator(productPath);
  let resolved = dependencies;
  if (!resolved) {
    const modulePath = path.join(productPath, '.ai-workflow', 'runtime.mjs');
    try {
      const runtime = await import(pathToFileURL(modulePath).href);
      resolved = typeof runtime.default === 'function' ? await runtime.default({ productPath }) : runtime.dependencies;
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  if (!resolved || typeof resolved !== 'object') throw Object.assign(new Error('live CLI requires .ai-workflow/runtime.mjs or injected production workflow dependencies'), { code: 4 });
  return createProductionWorkflow({ productPath, ...resolved });
}

export function createCodexAdapter({ exec = async () => ({ exitCode: 0, output: '' }) } = {}) {
  return {
    async run(input) {
      const capabilities = input?.capabilities;
      if (!capabilities?.cwd || capabilities.can_publish || capabilities.can_merge || capabilities.can_modify_parent_state) throw new Error('child capabilities are not restricted');
      if (!Array.isArray(capabilities.writable_paths) || !Array.isArray(capabilities.allowed_git_commands) || capabilities.allowed_git_commands.some((command) => ['push', 'reset', 'clean', 'merge'].includes(command)) || Object.keys(capabilities.env ?? {}).some((key) => /token|secret|password|key/i.test(key))) throw new Error('child execution boundary is not restricted');
      const result = await exec(input);
      return { status: result.exitCode === 0 ? 'SUCCEEDED' : 'FAILED', commit: result.commit ?? null, tests: result.tests ?? { exit_code: result.exitCode }, local_review: result.local_review, artifact_digest: result.artifact_digest ?? '', changed_paths: result.changed_paths };
    },
    canWrite: true, canPublish: false, canMerge: false, canModifyParentState: false
  };
}
