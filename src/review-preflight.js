const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { verifyBundleDigest } = require('./review-bundle');
const { workingTreeDigest, canonicalUtf8Digest, normalizeRelativePath } = require('./artifact-digest');
const Ajv = require('ajv');
const bundleSchema = require('../schemas/review-bundle.schema.json');
const responseSchema = require('../schemas/review-response.schema.json');

const bundleValidator = new Ajv({ allErrors: true }).compile(bundleSchema);
const responseValidator = new Ajv({ allErrors: true }).compile(responseSchema);

function containsSecret(value) {
  return /(token|password|secret|api[_-]?key|authorization)/i.test(JSON.stringify(value));
}

function git(repositoryRoot, args) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8' }).trim();
}

function repositoryObjectAlgorithm(repositoryRoot) {
  return git(repositoryRoot, ['rev-parse', '--show-object-format']) === 'sha256' ? 'git-sha256' : 'git-sha1';
}

function resolveRevision(repositoryRoot, revision) {
  return git(repositoryRoot, ['rev-parse', `${revision}^{commit}`]);
}

function changedPaths(repositoryRoot, range) {
  const output = git(repositoryRoot, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', range]);
  return output ? output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean) : [];
}

function commitPaths(repositoryRoot, revision) {
  const output = git(repositoryRoot, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', revision]);
  return output ? output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean) : [];
}

function commitsBetween(repositoryRoot, from, to) {
  const output = git(repositoryRoot, ['rev-list', '--reverse', `${from}..${to}`]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function isWithinScope(filePath, scope) {
  const normalized = normalizeRelativePath(filePath);
  return scope.some((allowed) => {
    const prefix = normalizeRelativePath(allowed).replace(/\/$/, '');
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function digestAtRevision(repositoryRoot, revision, relativePath) {
  return { objectId: git(repositoryRoot, ['rev-parse', `${revision}:${normalizeRelativePath(relativePath)}`]) };
}

function compareWorkIdentity(bundle, context, errors) {
  const expected = context.workIdentity ?? {
    task_id: context.reviewTaskId,
    issue_id: bundle.issue_id,
    project_identity: context.project?.identity,
    workspace: context.workspaceRoot,
    repository: context.project?.repository
  };
  const actual = bundle.work_identity;
  for (const key of ['task_id', 'issue_id', 'project_identity', 'workspace', 'repository']) {
    if (expected?.[key] !== undefined && expected[key] !== actual?.[key]) errors.push(`WORK_IDENTITY_MISMATCH:${key}`);
  }
  if (expected?.branch !== undefined && expected.branch !== actual?.branch) errors.push('WORK_IDENTITY_MISMATCH:branch');
  if (expected?.generation !== undefined && expected.generation !== actual?.generation) errors.push('WORK_IDENTITY_MISMATCH:generation');
}

function verifyRevisionContract(bundle, context, errors) {
  const root = context.workspaceRoot;
  const expectedReviewRevision = context.review_revision ?? context.reviewRevision ?? context.target_revision;
  if (expectedReviewRevision && expectedReviewRevision !== bundle.review_revision) errors.push('REVIEW_REVISION_MISMATCH');
  if (context.base_revision && context.base_revision !== bundle.base_revision) errors.push('BASE_REVISION_MISMATCH');
  if (bundle.target_revision !== bundle.review_revision) errors.push('TARGET_REVIEW_REVISION_MISMATCH');
  if (bundle.approval_receipt?.revision !== bundle.base_revision && bundle.approval_receipt?.revision !== bundle.implementation_revision) errors.push('APPROVAL_REVISION_MISMATCH');
  if (!root) return;
  try {
    const base = resolveRevision(root, bundle.base_revision);
    const implementation = resolveRevision(root, bundle.implementation_revision);
    const review = resolveRevision(root, bundle.review_revision);
    if (context.currentRevision && resolveRevision(root, context.currentRevision) !== review) errors.push('CURRENT_REVIEW_HEAD_MISMATCH');
    if (context.currentReviewRevision && resolveRevision(root, context.currentReviewRevision) !== review) errors.push('CURRENT_REVIEW_HEAD_MISMATCH');
    if (bundle.presentation_target.revision !== bundle.review_revision) errors.push('PRESENTATION_REVISION_MISMATCH');
    const implementationPaths = changedPaths(root, `${base}..${implementation}`);
    const allowedImplementation = bundle.expected_change_scope.implementation_paths;
    const implementationScope = bundle.path_scope.implementation_paths;
    for (const changed of implementationPaths) {
      if (!isWithinScope(changed, implementationScope)) errors.push(`IMPLEMENTATION_PATH_SCOPE_VIOLATION:${changed}`);
      if (!isWithinScope(changed, allowedImplementation)) errors.push(`EXPECTED_CHANGE_SCOPE_VIOLATION:${changed}`);
    }
    const metadataCommits = commitsBetween(root, implementation, review);
    const allowedCommits = new Set(bundle.allowed_metadata_commits);
    for (const commit of metadataCommits) {
      if (!allowedCommits.has(commit)) errors.push(`UNAPPROVED_METADATA_COMMIT:${commit}`);
      for (const changed of commitPaths(root, commit)) if (!isWithinScope(changed, bundle.path_scope.metadata_paths) || !isWithinScope(changed, bundle.expected_change_scope.metadata_paths)) errors.push(`METADATA_PATH_SCOPE_VIOLATION:${changed}`);
    }
  } catch {
    errors.push('REVISION_CONTRACT_UNVERIFIABLE');
  }
}

function verifyInputs(bundle, context, errors) {
  if (!context.workspaceRoot) return;
  const objectAlgorithm = repositoryObjectAlgorithm(context.workspaceRoot);
  for (const input of bundle.inputs || []) {
    try {
      const normalizedPath = normalizeRelativePath(input.path);
      const expectedRevision = context.expectedInputRevisions?.[normalizedPath] ?? context.expectedInputRevision;
      if (expectedRevision && input.revision !== expectedRevision) errors.push(`INPUT_REVISION_MISMATCH:${normalizedPath}`);
      if (input.artifact_class === 'binary' && input.hash_basis === 'canonical_utf8') errors.push(`INPUT_CLASS_BASIS_MISMATCH:${normalizedPath}`);
      const allowedRevisions = new Set([bundle.base_revision, bundle.implementation_revision, bundle.review_revision, ...bundle.allowed_metadata_commits]);
      const resolvedInputRevision = resolveRevision(context.workspaceRoot, input.revision);
      if (![...allowedRevisions].some((revision) => { try { return resolveRevision(context.workspaceRoot, revision) === resolvedInputRevision; } catch { return false; } })) errors.push(`INPUT_REVISION_UNBOUND:${normalizedPath}`);
      const workspaceRoot = path.resolve(context.workspaceRoot);
      const absolutePath = path.resolve(workspaceRoot, normalizedPath);
      if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error('PATH_ESCAPE');
      if (!isWithinScope(normalizedPath, bundle.path_scope.input_paths)) throw new Error('INPUT_PATH_SCOPE');
      const actual = input.hash_basis === 'canonical_utf8' ? canonicalUtf8Digest(fs.readFileSync(absolutePath, 'utf8')) : workingTreeDigest(absolutePath);
      const revisionObject = digestAtRevision(context.workspaceRoot, input.revision, normalizedPath);
      if (input.hash_basis !== actual.basis || input.digest !== actual.value || input.byte_length !== actual.byte_length) errors.push(`INPUT_DIGEST_MISMATCH:${normalizedPath}`);
      if (input.git_object_id.value !== revisionObject.objectId) errors.push(`INPUT_OBJECT_ID_MISMATCH:${normalizedPath}`);
      if (input.git_object_id.algorithm !== objectAlgorithm) errors.push(`INPUT_OBJECT_ALGORITHM_MISMATCH:${normalizedPath}`);
    } catch {
      errors.push(`INPUT_UNREADABLE:${input.path}`);
    }
  }
}

function preflight(bundle, context = {}) {
  const errors = [];
  if (!bundleValidator(bundle)) errors.push('BUNDLE_SCHEMA_INVALID');
  if (!verifyBundleDigest(bundle)) errors.push('BUNDLE_DIGEST_MISMATCH');
  if (containsSecret(bundle)) errors.push('SECRET_DETECTED');
  if (!bundle?.inputs?.length) errors.push('INPUTS_REQUIRED');
  if (new Set((bundle?.inputs || []).map((input) => input.path)).size !== (bundle?.inputs || []).length) errors.push('DUPLICATE_INPUT_PATH');
  if (context.usedIterations?.includes(bundle.iteration)) errors.push('ITERATION_DUPLICATE');
  if (context.expectedIteration !== undefined && context.expectedIteration !== bundle.iteration) errors.push('ITERATION_MISMATCH');
  if (context.approvalDigest && context.approvalDigest !== bundle.approval_receipt?.digest) errors.push('APPROVAL_RECEIPT_MISMATCH');
  const presentationTarget = context.presentationTarget ?? context.presentation_target;
  if (context.expectedPresentationDigest && context.expectedPresentationDigest !== bundle.presentation_target?.artifact_digest) errors.push('PRESENTATION_RECEIPT_MISMATCH');
  if (context.expectedPresentationDigest && context.expectedPresentationDigest !== bundle.presentation_receipt?.digest) errors.push('PRESENTATION_RECEIPT_MISMATCH');
  if (presentationTarget && (presentationTarget.revision !== bundle.presentation_target?.revision || presentationTarget.artifact_digest !== bundle.presentation_target?.artifact_digest)) errors.push('PRESENTATION_TARGET_MISMATCH');
  if (bundle.presentation_receipt?.digest !== bundle.presentation_target?.artifact_digest) errors.push('PRESENTATION_ARTIFACT_MISMATCH');
  if (bundle.allowed_metadata_revision && bundle.allowed_metadata_revision !== bundle.approval_receipt?.digest) errors.push('METADATA_APPROVAL_MISMATCH');
  const requiredContext = ['workspaceRoot', 'project', 'reviewTaskId', 'expectedInputRevision', 'expectedIteration', 'approvalDigest', 'target_revision', 'base_revision'];
  for (const key of requiredContext) if (context[key] === undefined || context[key] === null) errors.push(`REVIEW_CONTEXT_REQUIRED:${key}`);
  if (!context.expectedPresentationDigest && !presentationTarget) errors.push('REVIEW_CONTEXT_REQUIRED:presentationTarget');
  if (context.project) for (const key of ['identity', 'workspace', 'repository']) if (context.project[key] !== bundle.project?.[key]) errors.push(`PROJECT_BINDING_MISMATCH:${key}`);
  if (context.reviewTaskId && context.reviewTaskId !== bundle.task_id) errors.push('TASK_BINDING_MISMATCH');
  if (context.expectedInputRevision) for (const input of bundle.inputs || []) if (input.revision !== context.expectedInputRevision && !context.expectedInputRevisions) errors.push(`INPUT_REVISION_MISMATCH:${input.path}`);
  compareWorkIdentity(bundle, context, errors);
  verifyRevisionContract(bundle, context, errors);
  verifyInputs(bundle, context, errors);
  return { ok: errors.length === 0, errors: [...new Set(errors)], checked_at: new Date().toISOString() };
}

function operationKey(parts) {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

function validateReviewResponseSchema(response) {
  return responseValidator(response) ? [] : ['RESPONSE_SCHEMA_INVALID'];
}

module.exports = { preflight, operationKey, validateReviewResponseSchema, changedPaths, commitPaths, commitsBetween, resolveRevision };
