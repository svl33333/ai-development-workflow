const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { WorktreeManager } = require('../src/worktree-manager');
test('worktree lifecycle requires reservation and matching head', () => { const parent = process.cwd(); const m = new WorktreeManager(parent, path.join(os.tmpdir(), 'children')); const r = m.reserve('child-1', 'base', 1); assert.equal(r.lifecycle, 'reserved'); assert.throws(() => m.start('child-1', 'base'), /WORKTREE_HEAD_MISMATCH/); });
test('parent cwd sharing is rejected', () => { assert.throws(() => new WorktreeManager(process.cwd(), process.cwd()).reserve('x', 'base'), /PARENT_CWD_SHARING_FORBIDDEN/); });
