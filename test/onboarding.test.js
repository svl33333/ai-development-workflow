import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { onboardProduct } from '../src/onboarding.js';

test('onboarding initializes an existing product and reports exact ChatGPT Project names', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-workflow-onboard-'));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"existing-product"}\n');
  const result = await onboardProduct({ productPath: root, masterPath: process.cwd(), projectId: 'existing-product', baseName: 'Existing Product' });
  assert.equal(result.status, 'HUMAN_ACTION_REQUIRED');
  assert.match(result.chatgpt_projects.prototype, /^Existing Product Prototype--[A-Z0-9]{8}$/);
  assert.match(result.chatgpt_projects.production, /^Existing Product Production--[A-Z0-9]{8}$/);
  assert.equal(result.validation.ok, true);
  assert.equal(await fs.stat(path.join(root, '.ai-workflow', 'config.json')).then(() => true), true);
  assert.equal(await fs.stat(path.join(root, '.agents', 'skills', 'workflow-onboarding', 'SKILL.md')).then(() => true), true);
  assert.equal(await fs.stat(path.join(root, '.ai-workflow', 'managed', 'execution-plan.schema.json')).then(() => true), true);
  assert.equal(await fs.stat(path.join(root, '.ai-workflow', 'managed', 'child-task-result.schema.json')).then(() => true), true);
  const second = await onboardProduct({ productPath: root, masterPath: process.cwd(), projectId: 'existing-product', baseName: 'Existing Product' });
  assert.ok(second.conflicting_files.length > 0);
  assert.equal(second.validation.ok, true);
});
