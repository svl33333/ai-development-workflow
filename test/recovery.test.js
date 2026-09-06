const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../src/state-store');
const { operationKey } = require('../src/review-preflight');
test('reservation is atomic and reusable', () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-')); const store = new StateStore(root); const key = operationKey(['github_issue', 'repo', '1', 'task', '1', 'rev']); const record = { operation_key: key, status: 'reserved' }; assert.equal(store.reserve(key, record).acquired, true); assert.equal(store.reserve(key, record).acquired, false); });
