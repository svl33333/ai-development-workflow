import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function safeRelative(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('artifact path must be relative to the product root');
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..') throw new Error('artifact path is outside the product root');
  return { absolute, relative: relative.replaceAll('\\', '/') };
}

export async function createPresentationReceipt(root, artifact, { present, canonicalRevision = null, method = 'codex_file_view' } = {}) {
  if (typeof present !== 'function') throw new Error('a presentation adapter is required');
  const target = safeRelative(root, artifact.path);
  const content = await fs.readFile(target.absolute);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  const result = await present({ path: target.absolute, relativePath: target.relative, kind: artifact.kind });
  if (!result || result.success !== true) throw new Error('artifact presentation did not succeed');
  return Object.freeze({
    presentation_id: crypto.randomUUID(), artifact_path: target.relative, artifact_kind: artifact.kind ?? 'unknown',
    canonical_revision: canonicalRevision ?? artifact.version ?? digest, digest, presented_at: new Date().toISOString(),
    presentation_method: method, presenter_result: result.reference ?? result.message ?? 'success'
  });
}

export async function verifyPresentationReceipt(root, receipt, { artifactPath = receipt?.artifact_path, canonicalRevision = null } = {}) {
  if (!receipt?.presentation_id || !receipt.digest) return { ok: false, reason: 'presentation receipt is incomplete' };
  try {
    const target = safeRelative(root, artifactPath);
    const digest = crypto.createHash('sha256').update(await fs.readFile(target.absolute)).digest('hex');
    return { ok: digest === receipt.digest && (canonicalRevision === null || receipt.canonical_revision === canonicalRevision), digest };
  } catch (error) { return { ok: false, reason: error.message }; }
}
