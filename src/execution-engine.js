import { TaskScheduler } from './task-scheduler.js';
import { ChildTaskRunner } from './child-task-runner.js';
import { IntegrationManager } from './integration-manager.js';
import { WorktreeManager } from './worktree-manager.js';

export function createExecutionEngine({ root, childAdapter, gitAdapter, integrate, test, generation = 1 } = {}) {
  if (!root || !childAdapter || !gitAdapter) throw new Error('execution engine requires a child adapter and Git worktree adapter');
  return {
    async run(plan, { baseRevision, prompt = 'Execute the approved unit plan', approvedDigest = null } = {}) {
      const scheduler = new TaskScheduler({ generation });
      scheduler.load(plan, { approvedDigest: approvedDigest ?? plan.approval_digest });
      const runner = new ChildTaskRunner({ root, adapter: childAdapter, worktreeManager: new WorktreeManager(root, { git: gitAdapter }), generation });
      const integration = new IntegrationManager({ generation, integrate, test });
      let revision = baseRevision;
      while (scheduler.ready().length) {
        const started = scheduler.ready().map((unit) => scheduler.start(unit.unit_id));
        const results = await Promise.all(started.map((unit) => runner.run(unit, { baseRevision: revision, prompt: `${prompt}\n\nUnit: ${unit.unit_id}\n${unit.purpose}` })));
        for (const result of results) { scheduler.complete(result.unit_id, result); const integrated = await integration.integrateResult(result, { generation }); scheduler.markIntegrated(result.unit_id); revision = integrated.integrated_revision ?? revision; }
      }
      const pending = scheduler.snapshot().units.filter((unit) => !['INTEGRATED', 'SUCCEEDED'].includes(unit.status));
      if (pending.length) throw new Error(`execution plan did not converge: ${pending.map((unit) => unit.unit_id).join(', ')}`);
      return { plan_id: plan.plan_id, generation, current_revision: revision, units: scheduler.snapshot().units, final_suite: await integration.finalSuite() };
    }
  };
}
