import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactFilename } from '../src/artifacts.js';
test('artifact names include all identity components', () => assert.equal(artifactFilename({ projectId: 'p', stage: 's', workId: 'w', artifactType: 'issue', version: 1 }), 'p-s-w-issue-v1.md'));
test('artifact names reject missing identity', () => assert.throws(() => artifactFilename({ projectId: 'p' }), /stage is required/));
