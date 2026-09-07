const test = require('node:test');
const assert = require('node:assert/strict');
const { GithubAdapter } = require('../src/adapters/github.cjs');
const { ChatGPTC2CAdapter } = require('../src/adapters/chatgpt-c2c.cjs');
test('github auth failure is classified', async () => { const a = new GithubAdapter(); await assert.rejects(() => a.mutate('createIssue', {}), /AUTH_REQUIRED/); });
test('C2C disconnect is classified', async () => { const a = new ChatGPTC2CAdapter(); await assert.rejects(() => a.send({}), /CONNECTION_REQUIRED/); });
