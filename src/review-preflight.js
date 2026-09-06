const crypto = require('node:crypto');
const { verifyBundleDigest } = require('./review-bundle');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { workingTreeDigest, canonicalUtf8Digest } = require('./artifact-digest');
const Ajv = require('ajv');
const bundleSchema = require('../schemas/review-bundle.schema.json');
const responseSchema = require('../schemas/review-response.schema.json');
function containsSecret(value) { return /(token|password|secret|api[_-]?key|authorization)/i.test(JSON.stringify(value)); }
function digestAtRevision(repositoryRoot, revision, relativePath) {
  const objectId = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', `${revision}:${relativePath}`], { encoding: 'utf8' }).trim();
  return { objectId };
}
function repositoryObjectAlgorithm(repositoryRoot) { const format = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', '--show-object-format'], { encoding: 'utf8' }).trim(); return format === 'sha256' ? 'git-sha256' : 'git-sha1'; }
function preflight(bundle, context = {}) {
  const errors = [];
  const validate = new Ajv({ allErrors: true }).compile(bundleSchema);
  if (!validate(bundle)) errors.push('BUNDLE_SCHEMA_INVALID');
  if (!verifyBundleDigest(bundle)) errors.push('BUNDLE_DIGEST_MISMATCH');
  if (context.target_revision && context.target_revision !== bundle.target_revision) errors.push('TARGET_REVISION_MISMATCH');
  if (context.base_revision && context.base_revision !== bundle.base_revision) errors.push('BASE_REVISION_MISMATCH');
  if (bundle.implementation_revision !== bundle.target_revision) errors.push('IMPLEMENTATION_REVISION_MISMATCH');
  if (!bundle.inputs?.length) errors.push('INPUTS_REQUIRED');
  if (new Set(bundle.inputs.map((i) => i.path)).size !== bundle.inputs.length) errors.push('DUPLICATE_INPUT_PATH');
  if (containsSecret(bundle)) errors.push('SECRET_DETECTED');
  if (context.usedIterations?.includes(bundle.iteration)) errors.push('ITERATION_DUPLICATE');
  if (context.approvalDigest && context.approvalDigest !== bundle.approval_receipt.digest) errors.push('APPROVAL_RECEIPT_MISMATCH');
  if (bundle.approval_receipt?.revision !== bundle.target_revision) errors.push('APPROVAL_REVISION_MISMATCH');
  if (bundle.allowed_metadata_revision !== bundle.approval_receipt?.digest) errors.push('METADATA_APPROVAL_MISMATCH');
  if (context.reviewTaskId && context.reviewTaskId !== bundle.task_id) errors.push('TASK_BINDING_MISMATCH');
  const requiredContext = ['workspaceRoot', 'project', 'reviewTaskId', 'expectedInputRevision', 'expectedPresentationDigest', 'expectedIteration', 'approvalDigest', 'target_revision', 'base_revision'];
  for (const key of requiredContext) if (context[key] === undefined || context[key] === null) errors.push(`REVIEW_CONTEXT_REQUIRED:${key}`);
  if (context.workspaceRoot && context.project && context.reviewTaskId && context.expectedInputRevision && context.expectedPresentationDigest && context.expectedIteration !== undefined && context.approvalDigest && context.target_revision && context.base_revision) {
    for (const input of bundle.inputs || []) {
      try {
        const absolutePath = path.resolve(context.workspaceRoot, input.path);
        if (absolutePath !== context.workspaceRoot && !absolutePath.startsWith(`${path.resolve(context.workspaceRoot)}${path.sep}`)) throw new Error('PATH_ESCAPE');
        const actual = input.hash_basis === 'canonical_utf8' ? canonicalUtf8Digest(fs.readFileSync(absolutePath, 'utf8')) : workingTreeDigest(absolutePath);
        const revisionObject = digestAtRevision(context.workspaceRoot, input.revision, input.path);
        if (input.hash_basis !== actual.basis || input.digest !== actual.value || input.byte_length !== actual.byte_length) errors.push(`INPUT_DIGEST_MISMATCH:${input.path}`);
        if (input.git_object_id.value !== revisionObject.objectId) errors.push(`INPUT_OBJECT_ID_MISMATCH:${input.path}`);
        if (input.git_object_id.algorithm !== repositoryObjectAlgorithm(context.workspaceRoot)) errors.push(`INPUT_OBJECT_ALGORITHM_MISMATCH:${input.path}`);
      } catch { errors.push(`INPUT_UNREADABLE:${input.path}`); }
  }
  }
  if (context.project) for (const key of ['identity', 'workspace', 'repository']) if (context.project[key] !== bundle.project?.[key]) errors.push(`PROJECT_BINDING_MISMATCH:${key}`);
  if (context.expectedInputRevision) for (const input of bundle.inputs || []) if (input.revision !== context.expectedInputRevision) errors.push(`INPUT_REVISION_MISMATCH:${input.path}`);
  if (context.expectedPresentationDigest && bundle.presentation_receipt?.digest !== context.expectedPresentationDigest) errors.push('PRESENTATION_RECEIPT_MISMATCH');
  if (context.expectedIteration !== undefined && bundle.iteration !== context.expectedIteration) errors.push('ITERATION_MISMATCH');
  return { ok: errors.length === 0, errors, checked_at: new Date().toISOString() };
}
function operationKey(parts) { return crypto.createHash('sha256').update(parts.join('\n')).digest('hex'); }
function validateReviewResponseSchema(response) { const valid = new Ajv({ allErrors: true }).compile(responseSchema); return valid(response) ? [] : ['RESPONSE_SCHEMA_INVALID']; }
module.exports = { preflight, operationKey, validateReviewResponseSchema };
