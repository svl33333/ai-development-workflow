import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPresentationReceipt, verifyPresentationReceipt } from '../src/artifact-presenter.js';

test('presentation receipt requires a successful presentation adapter and detects changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-present-'));
  await fs.mkdir(path.join(root, 'docs')); await fs.writeFile(path.join(root, 'docs', 'issue.md'), 'issue v1\n');
  const receipt = await createPresentationReceipt(root, { path: 'docs/issue.md', kind: 'issue' }, { present: async ({ relativePath }) => ({ success: true, reference: relativePath }), canonicalRevision: 'issue-1' });
  assert.equal(receipt.canonical_revision, 'issue-1');
  assert.equal((await verifyPresentationReceipt(root, receipt)).ok, true);
  await fs.writeFile(path.join(root, 'docs', 'issue.md'), 'issue v2\n');
  assert.equal((await verifyPresentationReceipt(root, receipt)).ok, false);
  await assert.rejects(() => createPresentationReceipt(root, { path: 'docs/issue.md', kind: 'issue' }, { present: async () => ({ success: false }) }), /did not succeed/);
});

test('presentation receipt rejects paths outside the product root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-present-safe-'));
  await assert.rejects(() => createPresentationReceipt(root, { path: '../outside.md', kind: 'issue' }, { present: async () => ({ success: true }) }), /outside/);
});
