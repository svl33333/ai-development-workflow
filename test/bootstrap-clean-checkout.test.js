const test = require('node:test');
const assert = require('node:assert/strict');
test('bootstrap runtime meets Issue #10 minimums', () => { assert.ok(Number(process.versions.node.split('.')[0]) >= 24); });
