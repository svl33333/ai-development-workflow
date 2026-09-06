const crypto = require('node:crypto');
const { verifyBundleDigest } = require('./review-bundle');
function containsSecret(value) { return /(token|password|secret|api[_-]?key|authorization)/i.test(JSON.stringify(value)); }
function preflight(bundle, context = {}) {
  const errors = [];
  if (!verifyBundleDigest(bundle)) errors.push('BUNDLE_DIGEST_MISMATCH');
  if (context.target_revision && context.target_revision !== bundle.target_revision) errors.push('TARGET_REVISION_MISMATCH');
  if (!bundle.inputs?.length) errors.push('INPUTS_REQUIRED');
  if (new Set(bundle.inputs.map((i) => i.path)).size !== bundle.inputs.length) errors.push('DUPLICATE_INPUT_PATH');
  if (containsSecret(bundle)) errors.push('SECRET_DETECTED');
  if (context.usedIterations?.includes(bundle.iteration)) errors.push('ITERATION_DUPLICATE');
  if (context.approvalDigest && context.approvalDigest !== bundle.allowed_metadata_revision) errors.push('APPROVAL_RECEIPT_MISMATCH');
  return { ok: errors.length === 0, errors, checked_at: new Date().toISOString() };
}
function operationKey(parts) { return crypto.createHash('sha256').update(parts.join('\n')).digest('hex'); }
module.exports = { preflight, operationKey };
