const TASK_ROLES = Object.freeze({
  ORCHESTRATOR: 'orchestrator',
  IMPLEMENTATION: 'implementation',
  CHATGPT_PLAN: 'chatgpt-plan',
  CHATGPT_REVIEW: 'chatgpt-review'
});

function assertImplementationTask(task) {
  if (!task || task.role !== TASK_ROLES.IMPLEMENTATION || typeof task.task_id !== 'string' || task.task_id.length === 0) {
    throw new Error('IMPLEMENTATION_TASK_REQUIRED');
  }
  if (task.parent_task_id && task.parent_task_id === task.task_id) throw new Error('TASK_PARENT_SELF_REFERENCE');
  return task;
}

function assertOrchestratorCannotMutate(task) {
  if (task?.role === TASK_ROLES.ORCHESTRATOR) throw new Error('ORCHESTRATOR_MUTATION_FORBIDDEN');
  return task;
}

module.exports = { TASK_ROLES, assertImplementationTask, assertOrchestratorCannotMutate };
