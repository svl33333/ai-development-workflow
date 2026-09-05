import fs from 'node:fs/promises';
import path from 'node:path';
import { StateStore } from './state-store.js';
import { validateProduct } from './validation.js';
import { nextStage } from './workflow.js';
import { WorkflowOrchestrator } from './orchestrator.js';

function option(args, name, fallback = undefined) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
function product(args) { const p = option(args, '--product'); if (!p) { const e = new Error('--product is required'); e.code = 2; throw e; } return path.resolve(p); }
async function masterManifest(root) { const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); const workflow = JSON.parse(await fs.readFile(path.join(root, 'workflow', 'workflow.json'), 'utf8')); return { workflow_version: workflow.version, schema_version: 1, adapter_version: 1, package_version: pkg.version }; }

export async function run(args) {
  const command = args[0];
  if (!command || ['setup', 'status', 'validate', 'next', 'update'].includes(command) === false) throw Object.assign(new Error('command must be setup, status, validate, next, or update'), { code: 2 });
  const root = product(args); const store = new StateStore(root);
  if (command === 'setup') { await store.setup({ project_id: option(args, '--project-id', path.basename(root)), workflow_version: 1, schema_version: 1, adapter_version: 1 }); console.log(`setup complete: ${root}`); return 0; }
  if (command === 'status') { const r = await store.read(); console.log(args.includes('--json') ? JSON.stringify(r.state, null, 2) : `${r.state.stage} / ${r.state.status}\nnext: ${r.state.next_action}`); return 0; }
  if (command === 'validate') { const r = await validateProduct(root); console.log(JSON.stringify({ ok: r.ok, stage: r.state?.stage ?? null, errors: r.errors }, null, 2)); return r.ok ? 0 : 1; }
  if (command === 'update') {
    const mode = args.includes('--apply') ? 'apply' : 'check';
    if (mode === 'apply' && !option(args, '--approval-id')) throw Object.assign(new Error('update --apply requires --approval-id (human approval)'), { code: 4 });
    const current = JSON.parse(await fs.readFile(path.join(root, '.ai-workflow', 'config.json'), 'utf8')); const candidate = await masterManifest(process.cwd());
    const compatible = candidate.schema_version === current.schema_version && candidate.adapter_version >= current.adapter_version;
    const changed = ['workflow_version', 'schema_version', 'adapter_version', 'package_version'].some((key) => current[key] !== candidate[key]);
    if (mode === 'check') { console.log(JSON.stringify({ mode, current, candidate, compatible, changed, requires_human_approval: changed, direction: 'common-master-to-product' }, null, 2)); return compatible ? 0 : 1; }
    const approvalId = option(args, '--approval-id'); if (!/^[A-Za-z0-9._-]+$/.test(approvalId)) throw Object.assign(new Error('invalid approval id'), { code: 4 });
    const approval = JSON.parse(await fs.readFile(path.join(root, '.ai-workflow', 'approvals', `${approvalId}.json`), 'utf8'));
    const managedPath = path.join(root, '.ai-workflow', 'managed', 'workflow.json');
    try { const managed = await fs.readFile(managedPath, 'utf8'); const expectedDigest = approval.managed_workflow_digest; if (!expectedDigest) throw Object.assign(new Error('update approval lacks managed workflow digest'), { code: 4 }); if (expectedDigest !== (await import('node:crypto')).createHash('sha256').update(managed).digest('hex')) throw Object.assign(new Error('managed workflow was modified locally'), { code: 4 }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (approval.kind !== 'update' || approval.valid !== true || approval.project_id !== current.project_id || approval.candidate_version !== candidate.package_version || !compatible) throw Object.assign(new Error('update approval is missing, stale, or incompatible'), { code: 4 });
    await fs.writeFile(path.join(root, '.ai-workflow', 'config.json'), JSON.stringify(candidate, null, 2) + '\n');
    await fs.mkdir(path.join(root, '.ai-workflow', 'managed'), { recursive: true }); await fs.copyFile(path.join(process.cwd(), 'workflow', 'workflow.json'), managedPath);
    console.log(JSON.stringify({ mode, current, candidate, compatible, changed, applied: true, direction: 'common-master-to-product' }, null, 2)); return 0;
  }
  const r = await store.read();
  if (command === 'next') { const validation = await validateProduct(root); if (!validation.ok) { console.log(JSON.stringify({ ok: false, errors: validation.errors }, null, 2)); return 1; } const result = await new WorkflowOrchestrator(root).next(); console.log(JSON.stringify({ ok: true, ...result }, null, 2)); return 0; }
  console.log(JSON.stringify({ stage: r.state.stage, next_action: r.state.next_action, blocked: r.state.status === 'blocked' }, null, 2)); return 0;
}
