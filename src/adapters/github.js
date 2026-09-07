export function createFakeGitHubAdapter() {
  const calls = [];
  return { synthetic: true, calls, async createIssue(input) { calls.push({ operation: 'createIssue', input }); return { number: 1, node_id: 'fixture-issue-1', url: 'https://example.invalid/issues/1' }; }, async createPullRequest(input) { calls.push({ operation: 'createPullRequest', input }); return { number: 1, head: input.head }; }, async mergePullRequest(input) { calls.push({ operation: 'mergePullRequest', input }); return { merged: true }; } };
}

export function createGitHubAdapter({ credentialStore, credentialKey, repository, request }) {
  if (!credentialStore || !credentialKey || !repository || !request) throw new Error('GitHub adapter dependencies are required');
  async function authenticateAndRun(operation) {
    const credential = await credentialStore.loadCredential(credentialKey);
    const permission = operation.type === 'createIssue' ? 'issues:write' : 'pull_requests:write';
    if (credential.metadata.repository !== repository || Date.parse(credential.metadata.expires_at) <= Date.now() || !credential.metadata.permissions.includes(permission)) throw new Error('credential is expired, out of scope, or lacks permission');
    for (let attempt = 0; attempt < 2; attempt += 1) { const response = await request({ operation, token: credential.secret }); if (response.status !== 401 || attempt === 1) return response; }
  }
  return { async createIssue(input) { return authenticateAndRun({ type: 'createIssue', input }); }, async createPullRequest(input) { return authenticateAndRun({ type: 'createPullRequest', input }); }, async mergePullRequest(input) { return authenticateAndRun({ type: 'mergePullRequest', input }); } };
}
