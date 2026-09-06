const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { workingTreeDigest, canonicalUtf8Digest, digestRecords } = require('../src/artifact-digest');
test('working tree bytes distinguish CRLF and LF', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-')); const a = path.join(dir, 'a'); const b = path.join(dir, 'b'); fs.writeFileSync(a, 'x\n'); fs.writeFileSync(b, 'x\r\n'); assert.notEqual(workingTreeDigest(a).value, workingTreeDigest(b).value); assert.equal(canonicalUtf8Digest('x\n').value, canonicalUtf8Digest('x\r\n').value); });
test('digest records have deterministic path order', () => { const out = digestRecords([{ path: 'z', artifact_kind: 'text', hash_basis: 'working_tree_bytes', digest: 'b', byte_length: 1 }, { path: 'a', artifact_kind: 'text', hash_basis: 'working_tree_bytes', digest: 'a', byte_length: 1 }]); assert.deepEqual(out.records.map((x) => x.path), ['a', 'z']); });
test('symlinks are rejected', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-link-')); const target = path.join(dir, 'target'); const link = path.join(dir, 'link'); fs.writeFileSync(target, 'x'); try { fs.symlinkSync(target, link); assert.throws(() => workingTreeDigest(link), /SYMLINK_UNSUPPORTED/); } catch (e) { if (e.code !== 'EPERM') throw e; } });
