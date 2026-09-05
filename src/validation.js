import fs from 'node:fs/promises';
import path from 'node:path';
import { StateStore } from './state-store.js';
import { STAGES } from './model.js';
import { nextStage } from './workflow.js';

function matchesType(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return true;
}

function validateSchemaValue(schema, value, label, filename) {
  const errors = [];
  if (schema.type && !matchesType(value, schema.type)) errors.push({ id: 'SCHEMA_INVALID', message: `${label} must be ${schema.type} (${filename})` });
  if (schema.enum && !schema.enum.includes(value)) errors.push({ id: 'SCHEMA_INVALID', message: `${label} has an invalid value (${filename})` });
  if (schema.required && matchesType(value, 'object')) for (const key of schema.required) if (value[key] === undefined || value[key] === null) errors.push({ id: 'SCHEMA_INVALID', message: `${label}.${key} is required by ${filename}` });
  if (schema.properties && matchesType(value, 'object')) for (const [key, child] of Object.entries(schema.properties)) if (value[key] !== undefined && value[key] !== null) errors.push(...validateSchemaValue(child, value[key], `${label}.${key}`, filename));
  if (schema.items && Array.isArray(value)) value.forEach((item, index) => errors.push(...validateSchemaValue(schema.items, item, `${label}[${index}]`, filename)));
  return errors;
}

async function validateSchema(root, filename, value, label) {
  const schemaPath = path.join(root, 'schemas', filename);
  const fallbackPath = path.join(process.cwd(), 'schemas', filename);
  let raw;
  try { raw = await fs.readFile(schemaPath, 'utf8'); } catch { raw = await fs.readFile(fallbackPath, 'utf8'); }
  return validateSchemaValue(JSON.parse(raw), value, label, filename);
}

export async function validateProduct(productPath) {
  const errors = [];
  let result; let config;
  try { result = await new StateStore(productPath).read(); } catch (error) { errors.push({ id: 'STATE_INVALID', message: error.message }); }
  try { config = JSON.parse(await fs.readFile(path.join(productPath, '.ai-workflow', 'config.json'), 'utf8')); } catch (error) { errors.push({ id: 'CONFIG_INVALID', message: error.message }); }
  if (result && config) {
    const state = result.state;
    try { errors.push(...await validateSchema(productPath, 'workflow-state.schema.json', state, 'state')); errors.push(...await validateSchema(productPath, 'workflow-config.schema.json', config, 'config')); } catch (error) { errors.push({ id: 'SCHEMA_INVALID', message: error.message }); }
    const required = ['workflow_version', 'schema_version', 'adapter_version', 'project_id', 'work_id', 'stage', 'status', 'next_action', 'revision', 'updated_at', 'agent_state'];
    for (const key of required) if (state[key] === undefined || state[key] === null) errors.push({ id: 'SCHEMA_INVALID', message: `${key} is required` });
    if (!STAGES.includes(state.stage)) errors.push({ id: 'SCHEMA_INVALID', message: `unknown stage: ${state.stage}` });
    if (state.agent_state && (state.agent_state.stage !== state.stage || state.agent_state.next_action !== state.next_action)) errors.push({ id: 'TRANSITION_INVALID', message: 'agent_state disagrees with state' });
    if (state.status === 'ready' && state.next_action === 'none' && nextStage(state.stage)) errors.push({ id: 'TRANSITION_INVALID', message: 'ready state has no next action before terminal stage' });
    if (state.base_revision && state.current_revision && state.base_revision === state.current_revision && state.stage === 'production_implementation') errors.push({ id: 'GIT_REVISION_INVALID', message: 'implementation stage has no new revision' });
    for (const key of ['workflow_version', 'schema_version', 'adapter_version']) if (result.state[key] !== config[key]) errors.push({ id: 'VERSION_MISMATCH', message: `${key} differs between state and config` });
    for (const artifact of result.state.artifacts ?? []) {
      if (!artifact.path) errors.push({ id: 'ARTIFACT_METADATA_INVALID', message: 'artifact path is required' });
      else if (artifact.path.includes('..') || path.isAbsolute(artifact.path)) errors.push({ id: 'ARTIFACT_LINK_INVALID', message: `unsafe artifact path: ${artifact.path}` });
      else { try { await fs.access(path.join(productPath, artifact.path)); } catch { errors.push({ id: 'ARTIFACT_MISSING', message: artifact.path }); } }
    }
    for (const receipt of result.state.presentation_receipts ?? []) {
      try { errors.push(...await validateSchema(productPath, 'presentation-receipt.schema.json', receipt, `presentation.${receipt.presentation_id ?? 'unknown'}`)); }
      catch (error) { errors.push({ id: 'SCHEMA_INVALID', message: error.message }); }
      if (receipt.artifact_path && (path.isAbsolute(receipt.artifact_path) || receipt.artifact_path.includes('..'))) errors.push({ id: 'PRESENTATION_PATH_INVALID', message: receipt.artifact_path });
    }
    const requiresGitEvidence = ['production_pr_draft', 'production_pr_review', 'production_fix', 'production_publish_waiting_approval', 'production_published', 'production_merge_waiting_approval', 'completed'].includes(state.stage);
    const isFixture = path.resolve(productPath).includes(`${path.sep}fixtures${path.sep}`);
    if (requiresGitEvidence && !isFixture) {
      try { await fs.access(path.join(productPath, '.git')); }
      catch { errors.push({ id: 'GIT_REPOSITORY_REQUIRED', message: 'production PR evidence requires a Git repository at the product root' }); }
    }
    const lockDir = path.join(productPath, '.ai-workflow', 'locks');
    try { const locks = (await fs.readdir(lockDir)).filter((file) => file.endsWith('.lock')); if (locks.length) errors.push({ id: 'LOCK_CONFLICT', message: `active locks: ${locks.join(', ')}` }); } catch { /* setup may not have run */ }
  }
  if (result?.state) {
    const approvalsDir = path.join(productPath, '.ai-workflow', 'approvals');
    try {
      for (const file of await fs.readdir(approvalsDir)) if (file.endsWith('.json')) {
        const approval = JSON.parse(await fs.readFile(path.join(approvalsDir, file), 'utf8'));
        try { errors.push(...await validateSchema(productPath, 'approval.schema.json', approval, `approval.${file}`)); } catch (error) { errors.push({ id: 'SCHEMA_INVALID', message: error.message }); }
        if (approval.work_id && approval.work_id !== result.state.work_id) errors.push({ id: 'APPROVAL_BINDING_INVALID', message: `${file} belongs to another work` });
        if (approval.valid !== true) errors.push({ id: 'APPROVAL_INVALID', message: `${file} is not valid` });
        if (['pr_publish', 'pr_merge'].includes(approval.kind) && approval.unresolved_blocking_findings !== 0) errors.push({ id: 'EVIDENCE_INVALID', message: `${file} has unresolved blocking findings` });
        for (const key of ['target_revision', 'test_run_id', 'test_artifact', 'review_artifact', 'review_iteration']) if (result.state[key] !== undefined && approval.kind?.startsWith('pr_') && approval[key] !== result.state[key]) errors.push({ id: 'APPROVAL_BINDING_INVALID', message: `${file}.${key} is stale` });
      }
    } catch { /* approvals are optional before a human gate */ }
  }
  return { ok: errors.length === 0, state: result?.state ?? null, config: config ?? null, errors };
}

