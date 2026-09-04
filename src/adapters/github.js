export function createFakeGitHubAdapter() {
  const calls = [];
  return { synthetic: true, calls, async createPullRequest(input) { calls.push({ operation: 'createPullRequest', input }); return { number: 1, head: input.head }; }, async mergePullRequest(input) { calls.push({ operation: 'mergePullRequest', input }); return { merged: true }; } };
}
