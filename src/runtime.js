import { WorkflowOrchestrator } from './orchestrator.js';
import { createGitHubAdapter } from './adapters/github.js';

export function createProductionWorkflow({ productPath, c2c, projectResolver, credentialStore, credentialKey, repository, request, evidenceProvider }) {
  const github = createGitHubAdapter({ credentialStore, credentialKey, repository, request });
  return new WorkflowOrchestrator(productPath, github, evidenceProvider, c2c, null, projectResolver, repository);
}
