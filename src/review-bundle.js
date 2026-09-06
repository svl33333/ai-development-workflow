const { canonicalJson, sha256 } = require('./canonical');

function pathsFromInputs(inputs) {
  return [...new Set((inputs || []).map((input) => input.path))].sort();
}

function normalizeInputs(inputs) {
  return (inputs || []).map((input) => ({ ...input, artifact_class: input.artifact_class ?? (input.hash_basis === 'canonical_utf8' ? 'text' : 'binary') }));
}

function createReviewBundle(input) {
  const required = ['task_id', 'issue_id', 'base_revision', 'iteration', 'conversation', 'project', 'inputs', 'approval_receipt', 'presentation_receipt'];
  for (const key of required) if (input[key] === undefined) throw new Error(`BUNDLE_REQUIRED: ${key}`);
  const reviewRevision = input.review_revision ?? input.target_revision ?? input.implementation_revision;
  const implementationRevision = input.implementation_revision ?? input.target_revision ?? reviewRevision;
  const metadataPaths = input.path_scope?.metadata_paths ?? input.path_scope?.metadata ?? [];
  const implementationPaths = input.path_scope?.implementation_paths ?? input.path_scope?.implementation ?? pathsFromInputs(input.inputs);
  const inputPaths = input.path_scope?.input_paths ?? input.path_scope?.inputs ?? pathsFromInputs(input.inputs);
  const bundle = {
    schema_version: '1.0.0',
    hash_algorithm: 'sha256',
    ...input,
    inputs: normalizeInputs(input.inputs),
    presentation_receipt: { ...input.presentation_receipt, artifact_digest: input.presentation_receipt.artifact_digest ?? input.presentation_receipt.digest },
    target_revision: input.target_revision ?? reviewRevision,
    implementation_revision: implementationRevision,
    review_revision: reviewRevision,
    allowed_metadata_commits: [...(input.allowed_metadata_commits ?? [])],
    path_scope: { input_paths: [...inputPaths], implementation_paths: [...implementationPaths], metadata_paths: [...metadataPaths] },
    expected_change_scope: input.expected_change_scope ?? { implementation_paths: [...implementationPaths], metadata_paths: [...metadataPaths] },
    work_identity: input.work_identity ?? {
      task_id: input.task_id,
      issue_id: input.issue_id,
      project_identity: input.project.identity,
      workspace: input.project.workspace,
      repository: input.project.repository,
      branch: input.branch ?? `codex/${input.task_id}`,
      generation: input.generation ?? 1
    },
    presentation_target: input.presentation_target ?? {
      revision: reviewRevision,
      artifact_digest: input.presentation_receipt.digest
    }
  };
  bundle.bundle_digest = bundleDigest(bundle);
  return bundle;
}

function bundleDigest(bundle) {
  const copy = { ...bundle };
  delete copy.bundle_digest;
  return sha256(Buffer.from(canonicalJson(copy), 'utf8'));
}

function verifyBundleDigest(bundle) {
  return bundle?.bundle_digest === bundleDigest(bundle);
}

module.exports = { createReviewBundle, bundleDigest, verifyBundleDigest };
