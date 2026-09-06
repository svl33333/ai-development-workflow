const fs = require('node:fs');
const path = require('node:path');
const { sha256, canonicalJson } = require('./canonical');

function normalizeRelativePath(filePath) { return filePath.split(path.sep).join('/').replace(/^\.\//, ''); }

function workingTreeDigest(filePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`SYMLINK_UNSUPPORTED: ${filePath}`);
  if (!stat.isFile()) throw new Error(`NOT_REGULAR_FILE: ${filePath}`);
  const bytes = fs.readFileSync(filePath);
  return { algorithm: 'sha256', basis: 'working_tree_bytes', value: sha256(bytes), byte_length: bytes.length };
}

function canonicalUtf8Digest(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n*$/, '\n');
  const bytes = Buffer.from(normalized, 'utf8');
  return { algorithm: 'sha256', basis: 'canonical_utf8', value: sha256(bytes), byte_length: bytes.length };
}

function digestRecords(records) {
  const normalized = records.map((r) => ({ path: normalizeRelativePath(r.path), artifact_kind: r.artifact_kind, revision: r.revision ?? null, hash_basis: r.hash_basis, digest: r.digest, byte_length: r.byte_length }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en', { sensitivity: 'variant' }));
  return { records: normalized, digest: sha256(Buffer.from(canonicalJson(normalized), 'utf8')) };
}

module.exports = { normalizeRelativePath, workingTreeDigest, canonicalUtf8Digest, digestRecords };
