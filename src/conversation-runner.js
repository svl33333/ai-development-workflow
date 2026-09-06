export class ConversationRunner {
  constructor({ adapter, stateStore, retry = {}, generation = null }) {
    this.adapter = adapter;
    this.stateStore = stateStore;
    this.maxRetries = retry.maxRetries ?? 2;
    this.baseDelayMs = retry.baseDelayMs ?? 10;
    this.generation = generation;
  }

  async run({ taskId, iteration, messageId, project, message, conversationId = null, workspace = null, role = 'unspecified', stage = 'unspecified' }) {
    const currentState = await this.stateStore.read();
    const issueKey = currentState.state.issue_identity?.node_id ?? (currentState.state.issue_identity?.repository && currentState.state.issue_identity?.number ? `${currentState.state.issue_identity.repository}#${currentState.state.issue_identity.number}` : currentState.state.work_id);
    const registryKey = `${issueKey}:${stage}:${role}`;
    const binding = currentState.state.conversation_registry?.[registryKey];
    if (binding && conversationId && binding.conversation_id !== conversationId) throw Object.assign(new Error('conversation binding mismatch; refusing to resume a different Issue/stage/role conversation'), { code: 4 });
    if (binding && binding.workspace && workspace && binding.workspace !== workspace) throw Object.assign(new Error('conversation workspace binding mismatch'), { code: 4 });
    conversationId ??= binding?.conversation_id ?? null;
    let conversation = conversationId
      ? await this.adapter.resumeConversation({ conversationId, project })
      : await this.adapter.startConversation({ project });
    const sent = currentState.state.conversation?.sent_messages ?? [];
    const existingDelivery = sent.find((item) => item.task_id === taskId && item.iteration === iteration && item.message_id === messageId);
    if (existingDelivery?.delivery_state === 'confirmed') {
      conversation = { ...conversation, conversationId: existingDelivery.conversation_id };
    } else {
      if (existingDelivery?.delivery_state === 'sending' || existingDelivery?.delivery_state === 'ambiguous') {
        const remoteStatus = await this.callWithRetry(() => this.adapter.getStatus({ conversationId: conversation.conversationId, messageId }));
        if (remoteStatus.messageAccepted) await this.recordDelivery({ taskId, iteration, messageId, conversationId: conversation.conversationId, deliveryState: 'confirmed', remoteMessageId: remoteStatus.messageId ?? messageId, project, workspace, role, stage });
        else if (remoteStatus.messageAccepted !== false) throw Object.assign(new Error('conversation message delivery is ambiguous'), { code: 4 });
      }
      const afterReconciliation = (await this.stateStore.read()).state.conversation?.sent_messages?.find((item) => item.task_id === taskId && item.iteration === iteration && item.message_id === messageId);
      if (afterReconciliation?.delivery_state !== 'confirmed') {
      await this.recordDelivery({ taskId, iteration, messageId, conversationId: conversation.conversationId, deliveryState: 'prepared', project, workspace, role, stage });
      await this.recordDelivery({ taskId, iteration, messageId, conversationId: conversation.conversationId, deliveryState: 'sending', project, workspace, role, stage });
      try {
        const sentResult = await this.adapter.sendMessage({ taskId, iteration, messageId, conversationId: conversation.conversationId, message });
        await this.recordDelivery({ taskId, iteration, messageId, conversationId: conversation.conversationId, deliveryState: 'confirmed', remoteMessageId: sentResult.messageId, project, workspace, role, stage });
      } catch (error) {
        await this.recordDelivery({ taskId, iteration, messageId, conversationId: conversation.conversationId, deliveryState: 'ambiguous', project, workspace, role, stage });
        const remoteStatus = await this.callWithRetry(() => this.adapter.getStatus({ conversationId: conversation.conversationId, messageId }));
        if (!remoteStatus.messageAccepted) throw Object.assign(new Error('conversation message delivery is ambiguous'), { code: 4, cause: error });
        await this.recordDelivery({ taskId, iteration, messageId, conversationId: conversation.conversationId, deliveryState: 'confirmed', remoteMessageId: remoteStatus.messageId ?? messageId, project, workspace, role, stage });
      }
      }
    }
    let status = await this.callWithRetry(() => this.adapter.getStatus({ conversationId: conversation.conversationId }));
    while (['reasoning', 'in_progress', 'pending'].includes(status.status)) status = await this.callWithRetry(() => this.adapter.waitForResponse({ conversationId: conversation.conversationId }));
    if (status.status !== 'completed' && status.status !== 'DONE') throw new Error(`conversation failed: ${status.status}`);
    return this.callWithRetry(() => this.adapter.readResponse({ conversationId: conversation.conversationId }));
  }

  async recordDelivery({ taskId, iteration, messageId, conversationId, deliveryState, remoteMessageId = null, project = null, workspace = null, role = 'unspecified', stage = 'unspecified' }) {
    const update = this.generation === null ? this.stateStore.update.bind(this.stateStore) : this.stateStore.fencedUpdate.bind(this.stateStore, this.generation);
    await update((state) => {
      const sentMessages = state.conversation?.sent_messages ?? [];
      const previous = sentMessages.find((entry) => entry.task_id === taskId && entry.iteration === iteration && entry.message_id === messageId);
      const entry = { task_id: taskId, iteration, message_id: messageId, conversation_id: conversationId, delivery_state: deliveryState, remote_message_id: remoteMessageId ?? previous?.remote_message_id ?? null };
      const issueKey = state.issue_identity?.node_id ?? (state.issue_identity?.repository && state.issue_identity?.number ? `${state.issue_identity.repository}#${state.issue_identity.number}` : state.work_id);
      const registryKey = `${issueKey}:${stage}:${role}`;
      return {
        ...state,
        conversation_registry: { ...(state.conversation_registry ?? {}), [registryKey]: { project_id: project?.id ?? project?.name ?? null, project_url: project?.url ?? null, conversation_id: conversationId, conversation_url: project?.conversation_url ?? null, workspace: workspace ?? state.project_id, repository: project?.repository ?? null, work_id: state.work_id, stage, role, resumable: true, updated_at: new Date().toISOString() } },
        conversation: { ...(state.conversation ?? {}), task_id: taskId, iteration, project_id: project?.id ?? project?.name ?? null, project_url: project?.url ?? null, workspace: workspace ?? state.project_id, role, stage, conversation_id: conversationId, conversation_url: project?.conversation_url ?? null, last_message_id: messageId, next_operation: deliveryState === 'confirmed' ? 'wait_for_response' : 'reconcile_delivery', failure_reason: deliveryState === 'ambiguous' ? 'message delivery outcome is unknown' : null, state: deliveryState === 'confirmed' ? 'EXECUTING' : deliveryState.toUpperCase(), sent_messages: [...sentMessages.filter((item) => item !== previous), entry] }
      };
    });
  }

  async callWithRetry(operation) {
    let attempt = 0;
    while (true) {
      try { return await operation(); }
      catch (error) { if (attempt >= this.maxRetries) throw error; await new Promise((resolve) => setTimeout(resolve, this.baseDelayMs * 2 ** attempt)); attempt += 1; }
    }
  }
}
