const { canonicalJson, sha256 } = require('./canonical');

function bundleDigest(bundle) {
  const copy = { ...bundle };
  delete copy.bundle_digest;
  return sha256(Buffer.from(canonicalJson(copy), 'utf8'));
}
function createReviewBundle(input) {
  const required = ['task_id', 'issue_id', 'target_revision', 'base_revision', 'iteration', 'conversation', 'project', 'inputs', 'allowed_metadata_revision', 'approval_receipt', 'presentation_receipt'];
  for (const key of required) if (input[key] === undefined) throw new Error(`BUNDLE_REQUIRED: ${key}`);
  const bundle = { schema_version: '1.0.0', hash_algorithm: 'sha256', ...input, implementation_revision: input.implementation_revision ?? input.target_revision };
  bundle.bundle_digest = bundleDigest(bundle);
  return bundle;
}
function verifyBundleDigest(bundle) { return bundle?.bundle_digest === bundleDigest(bundle); }
module.exports = { createReviewBundle, bundleDigest, verifyBundleDigest };
