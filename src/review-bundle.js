const crypto = require('node:crypto');
const { canonicalJson, sha256 } = require('./canonical');

function bundleDigest(bundle) { return sha256(Buffer.from(canonicalJson(bundle), 'utf8')); }
function createReviewBundle(input) {
  const required = ['task_id', 'target_revision', 'iteration', 'conversation', 'inputs', 'allowed_metadata_revision'];
  for (const key of required) if (input[key] === undefined) throw new Error(`BUNDLE_REQUIRED: ${key}`);
  const bundle = { schema_version: '1.0.0', hash_algorithm: 'sha256', ...input };
  bundle.bundle_digest = bundleDigest(bundle);
  return bundle;
}
function verifyBundleDigest(bundle) { const copy = { ...bundle }; delete copy.bundle_digest; return bundle.bundle_digest === bundleDigest(copy); }
module.exports = { createReviewBundle, bundleDigest, verifyBundleDigest };
