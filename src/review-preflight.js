const crypto = require('node:crypto');
const { verifyBundleDigest } = require('./review-bundle');
const path = require('node:path');
const { workingTreeDigest } = require('./artifact-digest');
const Ajv = require('ajv');
const bundleSchema = require('../schemas/review-bundle.schema.json');
const responseSchema = require('../schemas/review-response.schema.json');
function containsSecret(value) { return /(token|password|secret|api[_-]?key|authorization)/i.test(JSON.stringify(value)); }
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
  if (context.workspaceRoot) {
    for (const input of bundle.inputs || []) {
      try {
        const actual = workingTreeDigest(path.resolve(context.workspaceRoot, input.path));
        if (input.hash_basis !== actual.basis || input.digest !== actual.value || input.byte_length !== actual.byte_length) errors.push(`INPUT_DIGEST_MISMATCH:${input.path}`);
      } catch { errors.push(`INPUT_UNREADABLE:${input.path}`); }
    }
  }
  return { ok: errors.length === 0, errors, checked_at: new Date().toISOString() };
}
function operationKey(parts) { return crypto.createHash('sha256').update(parts.join('\n')).digest('hex'); }
function validateReviewResponseSchema(response) { const valid = new Ajv({ allErrors: true }).compile(responseSchema); return valid(response) ? [] : ['RESPONSE_SCHEMA_INVALID']; }
module.exports = { preflight, operationKey, validateReviewResponseSchema };
