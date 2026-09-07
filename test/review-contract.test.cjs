const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createReviewBundle, bundleDigest } = require('../src/review-bundle.cjs');
const { preflight } = require('../src/review-preflight.cjs');
const { validateResponse } = require('../src/review.cjs');
const { workingTreeDigest } = require('../src/artifact-digest.cjs');

function git(root, args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim(); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec.md'), 'spec\n');
  fs.writeFileSync(path.join(root, 'src', 'code.js'), 'old\n');
  fs.writeFileSync(path.join(root, 'docs', 'review.md'), 'old\n');
  execFileSync('git', ['init', '-q', root]);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'src', 'code.js'), 'implementation\n');
  git(root, ['add', 'src/code.js']);
  git(root, ['commit', '-qm', 'implementation']);
  const implementation = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'docs', 'review.md'), 'metadata\n');
  git(root, ['add', 'docs/review.md']);
  git(root, ['commit', '-qm', 'metadata']);
  const review = git(root, ['rev-parse', 'HEAD']);
  return { root, base, implementation, review, metadata: git(root, ['rev-parse', 'HEAD']) };
}
function makeBundle(f, overrides = {}) {
  const inputPath = path.join(f.root, 'spec.md');
  const digest = workingTreeDigest(inputPath);
  const objectId = git(f.root, ['rev-parse', `${f.review}:spec.md`]);
  return createReviewBundle({
    task_id: 'task-10', issue_id: '10', base_revision: f.base, implementation_revision: f.implementation, review_revision: f.review, iteration: 1,
    allowed_metadata_commits: [f.metadata],
    path_scope: { input_paths: ['spec.md'], implementation_paths: ['src'], metadata_paths: ['docs'] },
    expected_change_scope: { implementation_paths: ['src'], metadata_paths: ['docs'] },
    work_identity: { task_id: 'task-10', issue_id: '10', project_identity: 'project-1', workspace: f.root, repository: 'repo-1', branch: 'codex/task-10', generation: 2 },
    conversation: { identity: 'conversation-1', role: 'review' }, project: { identity: 'project-1', workspace: f.root, repository: 'repo-1' },
    inputs: [{ path: 'spec.md', revision: f.review, hash_basis: digest.basis, digest: digest.value, byte_length: digest.byte_length, git_object_id: { algorithm: 'git-sha1', basis: 'git_object_id', value: objectId } }],
    approval_receipt: { digest: 'approval-1', type: 'human_approval', revision: f.implementation },
    presentation_receipt: { digest: 'artifact-1', type: 'human_presentation' },
    ...overrides
  });
}
function context(bundle, root) {
  return { workspaceRoot: root, project: bundle.project, workIdentity: bundle.work_identity, reviewTaskId: bundle.task_id, expectedInputRevision: bundle.review_revision, expectedPresentationDigest: bundle.presentation_target.artifact_digest, expectedIteration: 1, approvalDigest: bundle.approval_receipt.digest, target_revision: bundle.review_revision, review_revision: bundle.review_revision, base_revision: bundle.base_revision, currentRevision: bundle.review_revision };
}

test('preflight independently verifies implementation and allowed metadata commit scopes', () => {
  const f = fixture();
  const b = makeBundle(f);
  assert.equal(preflight(b, context(b, f.root)).ok, true);
  assert.equal(b.implementation_revision !== b.review_revision, true);
  assert.deepEqual(b.allowed_metadata_commits, [f.metadata]);
});

test('preflight accepts inputs pinned to different allowed revisions', () => {
  const f = fixture();
  const b = makeBundle(f);
  const codePath = path.join(f.root, 'src', 'code.js');
  const codeDigest = workingTreeDigest(codePath);
  b.path_scope.input_paths.push('src/code.js');
  b.inputs.push({ path: 'src/code.js', revision: f.implementation, artifact_class: 'text', hash_basis: codeDigest.basis, digest: codeDigest.value, byte_length: codeDigest.byte_length, git_object_id: { algorithm: 'git-sha1', basis: 'git_object_id', value: git(f.root, ['rev-parse', `${f.implementation}:src/code.js`]) } });
  b.bundle_digest = bundleDigest(b);
  assert.equal(preflight(b, { ...context(b, f.root), expectedInputRevisions: { 'spec.md': f.review, 'src/code.js': f.implementation } }).ok, true);
});

test('preflight rejects a stale presentation receipt artifact digest', () => {
  const f = fixture();
  const b = makeBundle(f);
  b.presentation_receipt.digest = 'stale-artifact';
  b.bundle_digest = bundleDigest(b);
  const result = preflight(b, context(b, f.root));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('PRESENTATION_RECEIPT_MISMATCH'));
  assert.ok(result.errors.includes('PRESENTATION_ARTIFACT_MISMATCH'));
});

test('preflight rejects an unapproved post-implementation code commit', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'src', 'code.js'), 'unapproved\n');
  git(f.root, ['add', 'src/code.js']);
  git(f.root, ['commit', '-qm', 'unapproved-code']);
  const b = makeBundle({ ...f, review: git(f.root, ['rev-parse', 'HEAD']) });
  const result = preflight(b, context(b, f.root));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith('UNAPPROVED_METADATA_COMMIT:')));
  assert.ok(result.errors.includes('METADATA_PATH_SCOPE_VIOLATION:src/code.js'));
});

test('preflight rejects work identity and presentation target mismatches', () => {
  const f = fixture();
  const b = makeBundle(f, { presentation_target: { revision: f.implementation, artifact_digest: 'wrong-artifact' } });
  const result = preflight(b, { ...context(b, f.root), workIdentity: { ...b.work_identity, generation: 3 }, expectedPresentationDigest: 'artifact-1' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('WORK_IDENTITY_MISMATCH:generation'));
  assert.ok(result.errors.includes('PRESENTATION_REVISION_MISMATCH'));
  assert.ok(result.errors.includes('PRESENTATION_RECEIPT_MISMATCH'));
});

test('re-review verifies prior record digest, finding identity, fix revision, and range', () => {
  const f = fixture();
  const b = makeBundle(f, { iteration: 2 });
  const previous = { review_digest: 'prior-review-digest', review_revision: f.implementation, findings: [{ finding_id: 'F-HIGH', severity: 'High', disposition: 'open' }] };
  const response = { task_id: b.task_id, iteration: 2, target_revision: b.review_revision, prior_review_digest: 'prior-review-digest', fix_revision: f.review, overall_disposition: 'APPROVE', blocks_progress: false, findings: [{ finding_id: 'F-HIGH-FIXED', prior_finding_id: 'F-HIGH', severity: 'High', evidence_path: 'docs/review.md', disposition: 'fixed', fix_range: 'docs/review.md:1-1' }] };
  const valid = validateResponse(response, b, { previousReviewRecord: previous, repositoryRoot: f.root });
  assert.equal(valid.ok, true, JSON.stringify(valid));
  const bad = validateResponse({ ...response, prior_review_digest: 'wrong', findings: [{ ...response.findings[0], prior_finding_id: 'UNKNOWN', fix_range: 'src/code.js:1-1' }] }, b, { previousReviewRecord: previous, repositoryRoot: f.root });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('PRIOR_REVIEW_DIGEST_MISMATCH'));
  assert.ok(bad.errors.includes('PRIOR_FINDING_NOT_FOUND:UNKNOWN'));
  const omitted = validateResponse({ ...response, findings: [] }, b, { previousReviewRecord: previous, repositoryRoot: f.root });
  assert.ok(omitted.errors.includes('PRIOR_BLOCKING_FINDING_OMITTED:F-HIGH'));
});

test('review schema rejects Git object IDs whose length does not match the algorithm', () => {
  const f = fixture();
  const b = makeBundle(f);
  b.inputs[0].git_object_id.value = 'a'.repeat(64);
  b.bundle_digest = bundleDigest(b);
  assert.ok(preflight(b, context(b, f.root)).errors.includes('BUNDLE_SCHEMA_INVALID'));
});
