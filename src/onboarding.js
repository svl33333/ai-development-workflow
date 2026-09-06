import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StateStore } from './state-store.js';
import { validateProduct } from './validation.js';
import { createProjectName } from './adapters/chatgpt-project.js';

const MANAGED_DIRECTORIES = [
  ['skills', '.agents/skills'],
  ['.agents/skills', '.agents/skills'],
  ['prompts', '.ai-workflow/managed/prompts'],
  ['templates', '.ai-workflow/managed/templates']
];

function stableIdentifier(projectId, productPath) {
  return crypto.createHash('sha256').update(`${projectId}:${path.resolve(productPath)}`).digest('hex').slice(0, 8).toUpperCase();
}

async function copyMissingTree(source, target, relative = '', report) {
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    const targetRelative = path.join(relative, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyMissingTree(sourcePath, targetPath, targetRelative, report);
      continue;
    }
    try {
      const targetStat = await fs.stat(targetPath);
      if (targetStat.isFile()) { report.conflicts.push(targetRelative); continue; }
      report.conflicts.push(targetRelative);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      report.added.push(targetRelative);
    }
  }
}

export async function onboardProduct({ productPath, masterPath = process.cwd(), projectId = null, baseName = null, start = 'both' }) {
  const productRoot = path.resolve(productPath);
  const masterRoot = path.resolve(masterPath);
  if (productRoot === masterRoot) throw new Error('the product path must be different from the workflow master path');
  const resolvedProjectId = projectId ?? path.basename(productRoot);
  const resolvedBaseName = baseName?.trim() || resolvedProjectId;
  if (!['prototype', 'production', 'both'].includes(start)) throw new Error('start must be prototype, production, or both');
  await fs.mkdir(productRoot, { recursive: true });
  const store = new StateStore(productRoot);
  await store.setup({ project_id: resolvedProjectId, workflow_version: 1, schema_version: 1, adapter_version: 1 });

  const report = { added: [], conflicts: [] };
  for (const [sourceRelative, targetRelative] of MANAGED_DIRECTORIES) {
    const source = path.join(masterRoot, sourceRelative);
    try { await fs.access(source); } catch { continue; }
    const target = path.join(productRoot, targetRelative);
    await fs.mkdir(target, { recursive: true });
    await copyMissingTree(source, target, targetRelative, report);
  }
  for (const [sourceRelative, targetRelative] of [
    ['workflow/workflow.json', '.ai-workflow/managed/workflow.json'],
    ['schemas/workflow-state.schema.json', '.ai-workflow/managed/workflow-state.schema.json'],
    ['schemas/execution-plan.schema.json', '.ai-workflow/managed/execution-plan.schema.json'],
    ['schemas/child-task-result.schema.json', '.ai-workflow/managed/child-task-result.schema.json']
  ]) {
    const source = path.join(masterRoot, sourceRelative);
    const target = path.join(productRoot, targetRelative);
    try {
      await fs.stat(target);
      report.conflicts.push(targetRelative);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      report.added.push(targetRelative);
    }
  }

  const identifier = stableIdentifier(resolvedProjectId, productRoot);
  const projectNames = {
    prototype: createProjectName(`${resolvedBaseName} Prototype`, identifier),
    production: createProjectName(`${resolvedBaseName} Production`, identifier)
  };
  const requestedProjects = start === 'both' ? ['prototype', 'production'] : [start];
  const onboarding = {
    workflow_version: 1,
    project_id: resolvedProjectId,
    product_path: productRoot,
    status: 'HUMAN_ACTION_REQUIRED',
    requested_projects: requestedProjects,
    chatgpt_projects: projectNames,
    next_action: 'Create the requested ChatGPT Project(s) with the exact generated name(s), then rerun onboarding or tell Codex they are ready.',
    managed_master: masterRoot,
    added_files: report.added,
    conflicting_files: [...new Set(report.conflicts)].sort(),
    updated_at: new Date().toISOString()
  };
  const onboardingPath = path.join(productRoot, '.ai-workflow', 'onboarding.json');
  await fs.writeFile(onboardingPath, `${JSON.stringify(onboarding, null, 2)}\n`);
  const validation = await validateProduct(productRoot);
  return { ...onboarding, onboarding_path: onboardingPath, validation };
}
