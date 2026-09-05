import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectName, resolveProject, verifyProjectBinding } from '../src/adapters/chatgpt-project.js';
import { createCredentialStore, createMemoryCredentialVault } from '../src/adapters/credential-store.js';
import { createGitHubAdapter } from '../src/adapters/github.js';
import { createProductionWorkflow } from '../src/runtime.js';
import { createFakeC2CAdapter } from '../src/adapters/chatgpt-c2c.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Project resolver only accepts an exact generated name and asks for human choice when ambiguous', async () => {
  assert.equal(createProjectName('Production', 'A1B2C3D4'), 'Production--A1B2C3D4');
  const ambiguous = await resolveProject({ baseName: 'Production', identifier: 'A1B2C3D4', listProjects: async () => [{ name: 'Production--A1B2C3D4', last_used_at: '2026-01-01' }, { name: 'Production--A1B2C3D4', last_used_at: '2026-02-01' }] });
  assert.equal(ambiguous.status, 'ambiguous');
  const fallback = await resolveProject({ baseName: 'Production', identifier: 'A1B2C3D4', listProjects: async () => { throw new Error('listing unavailable'); }, projectUrl: 'https://chatgpt.com/project/example' });
  assert.equal(fallback.status, 'url_fallback');
  assert.equal(verifyProjectBinding({ workspace: 'workspace-a', repository: 'owner/repo' }, { workspace: 'workspace-a', repository: 'owner/repo' }), true);
});

test('GitHub adapter loads a repository-scoped credential without persisting its secret and retries one authentication failure', async () => {
  const store = createCredentialStore(createMemoryCredentialVault());
  await store.registerCredential({ key: 'repo-token', secret: 'not-persisted-token', metadata: { repository: 'owner/repo', expires_at: '2030-01-01T00:00:00.000Z', permissions: ['pull_requests:write'] } });
  let attempts = 0;
  const adapter = createGitHubAdapter({ credentialStore: store, credentialKey: 'repo-token', repository: 'owner/repo', request: async ({ token }) => { attempts += 1; assert.equal(token, 'not-persisted-token'); return attempts === 1 ? { status: 401 } : { status: 201, number: 1 }; } });
  assert.equal((await adapter.createPullRequest({ head: 'feature' })).status, 201);
  assert.equal(attempts, 2);
});

test('production composition prevents a GitHub mutation when the repository credential is expired', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-runtime-'));
  const store = createCredentialStore(createMemoryCredentialVault());
  await store.registerCredential({ key: 'expired', secret: 'secret', metadata: { repository: 'owner/repo', expires_at: '2000-01-01T00:00:00.000Z', permissions: ['pull_requests:write'] } });
  const resolver = async (kind, state) => ({ status: 'resolved', project: { name: `${kind}-project`, purpose: `${kind} planning and review`, workspace: state.project_id, repository: 'fixture/repository' } });
  const flow = createProductionWorkflow({ productPath: root, c2c: createFakeC2CAdapter(), projectResolver: resolver, credentialStore: store, credentialKey: 'expired', repository: 'owner/repo', request: async () => ({ status: 201 }), evidenceProvider: async () => ({ pr_number: 1, target_revision: 'head', test_run_id: 'run', test_artifact: 'test.md', review_artifact: 'review.md', review_iteration: 1, unresolved_blocking_findings: 0 }) });
  await flow.store.setup({ project_id: 'runtime-project' }); await flow.store.update((state) => ({ ...state, work_id: 'runtime-work' }));
  await flow.approve('pr_publish', { pr_number: 1, target_revision: 'head', test_run_id: 'run', test_artifact: 'test.md', review_artifact: 'review.md', review_iteration: 1, unresolved_blocking_findings: 0 });
  await assert.rejects(() => flow.publish(), /credential is expired/);
});
