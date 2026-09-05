export const PROJECTS = {
  prototype: { name: 'AI Development Workflow - Prototype', purpose: 'prototype design and evaluation' },
  production: { name: 'AI Development Workflow - Production', purpose: 'production planning and PR review' }
};

export function desiredProject(kind) { if (!PROJECTS[kind]) throw new Error(`unknown Project kind: ${kind}`); return PROJECTS[kind]; }

export function createProjectName(baseName, identifier) {
  if (!/^[A-Za-z0-9]{8}$/.test(identifier)) throw new Error('Project identifier must be 8 alphanumeric characters');
  if (!baseName?.trim()) throw new Error('Project base name is required');
  return `${baseName.trim()}--${identifier}`;
}

export async function resolveProject({ baseName, identifier, listProjects, projectUrl = null }) {
  const expectedName = createProjectName(baseName, identifier);
  try {
    const projects = await listProjects();
    const matches = projects.filter((project) => project.name === expectedName).sort((left, right) => String(right.last_used_at ?? '').localeCompare(String(left.last_used_at ?? '')));
    if (!matches.length) return { status: 'not_found', expected_name: expectedName, candidates: [] };
    if (matches.length > 1) return { status: 'ambiguous', expected_name: expectedName, candidates: matches };
    return { status: 'resolved', expected_name: expectedName, project: matches[0] };
  } catch {
    if (!projectUrl) return { status: 'url_required', expected_name: expectedName, reason: 'project listing is unavailable' };
    return { status: 'url_fallback', expected_name: expectedName, project_url: projectUrl };
  }
}

export async function resolveConfiguredProject({ baseName, identifier, listProjects, projectUrl, workspace, repository }) {
  const resolved = await resolveProject({ baseName, identifier, listProjects, projectUrl });
  if (resolved.status !== 'resolved') return resolved;
  return verifyProjectBinding(resolved.project, { workspace, repository }) ? resolved : { status: 'binding_mismatch', expected_name: resolved.expected_name, project: resolved.project };
}

export function verifyProjectBinding(project, { workspace, repository }) { return Boolean(project && project.workspace === workspace && project.repository === repository); }
export function verifyProject(actual, kind) { const wanted = desiredProject(kind); return Boolean(actual?.name === wanted.name && actual?.purpose === wanted.purpose); }
export function manualSetupArtifact(kind) { const project = desiredProject(kind); return `# ChatGPT Project manual setup\n\n- name: ${project.name}\n- purpose: ${project.purpose}\n- status: HUMAN_WAITING\n`; }
