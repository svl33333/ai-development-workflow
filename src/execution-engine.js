import { TaskScheduler } from './task-scheduler.js';
import { ChildTaskRunner } from './child-task-runner.js';
import { IntegrationManager } from './integration-manager.js';
import { WorktreeManager } from './worktree-manager.js';

export function createExecutionEngine({ root, childAdapter, gitAdapter, integrate, test, generation = 1 } = {}) {
  if (!root || !childAdapter || !gitAdapter) throw new Error('execution engine requires a child adapter and Git worktree adapter');
  return {
    async run(plan, { baseRevision, prompt = 'Execute the approved unit plan', approvedDigest = null, activeGeneration = generation, assertActiveGeneration = null } = {}) {
      const scheduler = new TaskScheduler({ generation: activeGeneration });
      if (!approvedDigest) throw new Error('approved execution-plan digest is required');
      scheduler.load(plan, { approvedDigest });
      const runner = new ChildTaskRunner({ root, adapter: childAdapter, worktreeManager: new WorktreeManager(root, { git: gitAdapter }), generation: activeGeneration });
      const integration = new IntegrationManager({ generation: activeGeneration, integrate, test });
      let revision = baseRevision;
      while (scheduler.ready().length) {
        await assertActiveGeneration?.();
        const started = scheduler.ready().map((unit) => scheduler.start(unit.unit_id));
        const results = await Promise.all(started.map(async (unit) => { try { return await runner.run(unit, { baseRevision: revision, prompt: `${prompt}\n\nUnit: ${unit.unit_id}\n${unit.purpose}` }); } catch (error) { return { unit_id: unit.unit_id, generation: activeGeneration, status: 'FAILED', error: error.message }; } }));
        for (const result of results) { await assertActiveGeneration?.(); scheduler.complete(result.unit_id, result, activeGeneration); if (result.status !== 'SUCCEEDED') { if (!scheduler.retry(result.unit_id, activeGeneration) && !scheduler.spawnSuccessor(result.unit_id, activeGeneration)) scheduler.failDependents(result.unit_id, activeGeneration); continue; } const integrated = await integration.integrateResult(result, { generation: activeGeneration }); scheduler.markIntegrated(result.unit_id, activeGeneration); revision = integrated.integrated_revision ?? revision; }
      }
      const pending = scheduler.snapshot().units.filter((unit) => !['INTEGRATED', 'SUCCEEDED'].includes(unit.status) && !(unit.status === 'BLOCKED' && unit.successor_spawned));
      if (pending.length) throw new Error(`execution plan did not converge: ${pending.map((unit) => unit.unit_id).join(', ')}`);
      return { plan_id: plan.plan_id, generation: activeGeneration, current_revision: revision, units: scheduler.snapshot().units, final_suite: await integration.finalSuite() };
    }
  };
}
