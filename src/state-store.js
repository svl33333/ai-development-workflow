import fs from 'node:fs/promises';
import path from 'node:path';
import { initialState, validateState } from './model.js';

function stateFilename(state) {
  const safe = (value) => String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${safe(state.project_id)}-${safe(state.stage)}-${safe(state.work_id)}-state-v${state.schema_version}.md`;
}

function scalar(value) {
  const v = value.trim();
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('[') || v.startsWith('{')) { try { return JSON.parse(v); } catch { /* keep invalid YAML visible to validation */ } }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

export function parseFrontMatter(text) {
  text = text.replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) throw new Error('state must start with YAML front matter');
  const end = text.indexOf('\n---', 4);
  if (end < 0) throw new Error('YAML front matter closing marker is missing');
  const meta = {}; let section = null;
  for (const line of text.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const nested = line.match(/^  ([A-Za-z0-9_]+):\s*(.*)$/);
    if (nested && section) { meta[section] ??= {}; meta[section][nested[1]] = scalar(nested[2]); continue; }
    const item = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (item) { section = item[1]; meta[section] = item[2] ? scalar(item[2]) : (section === 'artifacts' ? [] : {}); continue; }
    const list = line.match(/^  - (.*)$/);
    if (list && section) { if (!Array.isArray(meta[section])) meta[section] = []; meta[section].push(scalar(list[1])); }
  }
  return { meta, body: text.slice(end + 4) };
}

function yamlValue(value, indent = '') {
  if (Array.isArray(value)) return `${indent}${JSON.stringify(value)}`;
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${indent}${k}: ${v && typeof v === 'object' && !Array.isArray(v) ? `\n${yamlValue(v, `${indent}  `)}` : v === null ? 'null' : Array.isArray(v) ? JSON.stringify(v) : String(v)}`).join('\n');
  return `${indent}${value === null ? 'null' : String(value)}`;
}

export function serializeState(state, body = '# AI workflow state\n') {
  const { agent_state, ...top } = state;
  return `---\n${yamlValue(top)}\nagent_state:\n${yamlValue(agent_state, '  ')}\n---\n${body.replace(/^---[\s\S]*?---\n/, '')}`;
}

export class StateStore {
  constructor(productPath, scope = {}) { this.root = path.resolve(productPath); this.dir = path.join(this.root, '.ai-workflow'); this.stateDir = path.join(this.dir, 'state'); this.activeWorkId = scope.workId ?? null; this.projectId = scope.projectId ?? null; }
  async setup(config = {}) {
    for (const dir of ['state', 'artifacts', 'reviews', 'runs', 'approvals', 'locks', 'pending']) await fs.mkdir(path.join(this.dir, dir), { recursive: true });
    const configPath = path.join(this.dir, 'config.json');
    try { await fs.access(configPath); } catch { await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n'); }
    const statePath = path.join(this.stateDir, stateFilename(initialState(config.project_id ?? path.basename(this.root))));
    try { await fs.access(statePath); } catch { await fs.writeFile(statePath, serializeState(initialState(config.project_id ?? path.basename(this.root)))); }
    return statePath;
  }
  async read({ projectId = this.projectId, workId = this.activeWorkId } = {}) {
    const files = (await fs.readdir(this.stateDir)).filter((f) => f.endsWith('.md')).sort();
    if (!files.length) throw new Error('no state file found');
    const candidates = [];
    for (const file of files) {
      const statePath = path.join(this.stateDir, file);
      try { const parsed = parseFrontMatter(await fs.readFile(statePath, 'utf8')); candidates.push({ statePath, parsed }); } catch { /* invalid candidates are reported below */ }
    }
    if (!candidates.length) throw new Error('no valid state file found');
    const scoped = candidates.filter(({ parsed }) => (!projectId || parsed.meta.project_id === projectId) && (!workId || parsed.meta.work_id === workId));
    if (!scoped.length) throw new Error(`no state found for project/work: ${projectId ?? '*'}/${workId ?? '*'}`);
    if (!workId && new Set(scoped.map(({ parsed }) => parsed.meta.work_id)).size > 1) throw new Error('state identity is ambiguous; project/work scope is required');
    scoped.sort((a, b) => (b.parsed.meta.revision ?? 0) - (a.parsed.meta.revision ?? 0));
    const { statePath, parsed } = scoped[0]; this.activeWorkId ??= parsed.meta.work_id; this.projectId ??= parsed.meta.project_id;
    const errors = validateState(parsed.meta); if (errors.length) throw new Error(`invalid state: ${errors.join('; ')}`);
    return { path: statePath, state: parsed.meta, body: parsed.body };
  }
  async update(mutator, expectedRevision = null) {
    const observed = await this.read(); const lockKey = `${observed.state.project_id}-${observed.state.work_id}`;
    return this.withLock(lockKey, async () => {
      const current = await this.read();
      if (expectedRevision !== null && current.state.revision !== expectedRevision) throw Object.assign(new Error(`state revision conflict: expected ${expectedRevision}, got ${current.state.revision}`), { code: 3 });
      const next = mutator(structuredClone(current.state));
      const errors = validateState(next); if (errors.length) throw new Error(`invalid next state: ${errors.join('; ')}`);
      next.revision += 1; next.updated_at = new Date().toISOString(); next.agent_state.updated_at = next.updated_at;
      const nextPath = path.join(this.stateDir, stateFilename(next));
      const temp = `${nextPath}.tmp-${process.pid}`; await fs.writeFile(temp, serializeState(next, current.body)); await fs.rename(temp, nextPath);
      if (current.path !== nextPath) await fs.rm(current.path, { force: true });
      this.activeWorkId = next.work_id; this.projectId = next.project_id; return next;
    });
  }
  async withLock(work, fn) {
    const lock = path.join(this.dir, 'locks', `${work}.lock`); await fs.mkdir(path.dirname(lock), { recursive: true });
    let handle;
    let acquired = false;
    try { handle = await fs.open(lock, 'wx'); acquired = true; await handle.writeFile(JSON.stringify({ owner: `${process.pid}`, work, acquired_at: new Date().toISOString() })); return await fn(); }
    catch (error) { if (error.code === 'EEXIST') throw Object.assign(new Error(`state lock exists: ${work}`), { code: 3 }); throw error; }
    finally { await handle?.close(); if (acquired) await fs.rm(lock, { force: true }); }
  }
}

