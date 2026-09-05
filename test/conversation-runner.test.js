import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationRunner } from '../src/conversation-runner.js';
import { createFakeC2CAdapter } from '../src/adapters/chatgpt-c2c.js';
import { StateStore } from '../src/state-store.js';

test('conversation runner records a sent message and reads the completed response', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-runner-'));
  const store = new StateStore(root); await store.setup({ project_id: 'runner-test' });
  const adapter = createFakeC2CAdapter(); const runner = new ConversationRunner({ adapter, stateStore: store });
  const response = await runner.run({ taskId: 'task-1', iteration: 1, messageId: 'message-1', project: { id: 'project-1' }, message: 'plan' });
  assert.equal(response.status, 'DONE');
  assert.equal((await store.read()).state.conversation.sent_messages.length, 1);
  assert.deepEqual(adapter.calls.map((call) => call.operation), ['startConversation', 'sendMessage', 'getStatus', 'readResponse']);
});

test('conversation runner does not send the same task iteration message twice', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-runner-idempotent-'));
  const store = new StateStore(root); await store.setup({ project_id: 'runner-idempotent' });
  const adapter = createFakeC2CAdapter(); const runner = new ConversationRunner({ adapter, stateStore: store });
  const input = { taskId: 'task-1', iteration: 1, messageId: 'message-1', project: { id: 'project-1' }, message: 'plan' };
  await runner.run(input); await runner.run({ ...input, conversationId: 'conversation-1' });
  assert.equal(adapter.calls.filter((call) => call.operation === 'sendMessage').length, 1);
});

test('conversation runner never blindly retries an ambiguous message send', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-runner-ambiguous-'));
  const store = new StateStore(root); await store.setup({ project_id: 'runner-ambiguous' });
  const adapter = createFakeC2CAdapter();
  const originalSend = adapter.sendMessage;
  let attempts = 0;
  adapter.sendMessage = async (input) => { attempts += 1; await originalSend.call(adapter, input); throw new Error('connection lost after remote acceptance'); };
  const runner = new ConversationRunner({ adapter, stateStore: store });
  const response = await runner.run({ taskId: 'task-1', iteration: 1, messageId: 'message-1', project: { id: 'project-1' }, message: 'plan' });
  assert.equal(response.status, 'DONE');
  assert.equal(attempts, 1);
  assert.equal((await store.read()).state.conversation.sent_messages[0].delivery_state, 'confirmed');
});

test('conversation runner sends a prepared but unsent message after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-runner-prepared-'));
  const store = new StateStore(root); await store.setup({ project_id: 'runner-prepared' });
  await store.update((state) => ({ ...state, conversation: { ...state.conversation, sent_messages: [{ task_id: 'task-1', iteration: 1, message_id: 'message-1', conversation_id: 'conversation-1', delivery_state: 'prepared', remote_message_id: null }] } }));
  const adapter = createFakeC2CAdapter(); await adapter.startConversation({ project: { id: 'project-1' } });
  const runner = new ConversationRunner({ adapter, stateStore: store });
  await runner.run({ taskId: 'task-1', iteration: 1, messageId: 'message-1', project: { id: 'project-1' }, message: 'plan', conversationId: 'conversation-1' });
  assert.equal(adapter.calls.filter((call) => call.operation === 'sendMessage').length, 1);
});

test('conversation runner refuses a different stage/role binding on resume', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-runner-binding-'));
  const store = new StateStore(root); await store.setup({ project_id: 'binding-product' });
  await store.update((state) => ({ ...state, work_id: 'binding-work', conversation_registry: { 'binding-work:production_plan_review:plan_review': { conversation_id: 'review-conversation', workspace: 'binding-product', resumable: true } } }));
  const adapter = createFakeC2CAdapter(); const runner = new ConversationRunner({ adapter, stateStore: store });
  await assert.rejects(() => runner.run({ taskId: 'task', iteration: 1, messageId: 'message', project: { id: 'p' }, message: 'review', conversationId: 'other-conversation', workspace: 'binding-product', role: 'plan_review', stage: 'production_plan_review' }), /binding mismatch/);
  assert.equal(adapter.calls.length, 0);
});
