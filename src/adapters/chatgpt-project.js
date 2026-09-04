export const PROJECTS = {
  prototype: { name: 'AI Development Workflow - Prototype', purpose: 'prototype design and evaluation' },
  production: { name: 'AI Development Workflow - Production', purpose: 'production planning and PR review' }
};

export function desiredProject(kind) { if (!PROJECTS[kind]) throw new Error(`unknown Project kind: ${kind}`); return PROJECTS[kind]; }
export function verifyProject(actual, kind) { const wanted = desiredProject(kind); return Boolean(actual?.name === wanted.name && actual?.purpose === wanted.purpose); }
export function manualSetupArtifact(kind) { const project = desiredProject(kind); return `# ChatGPT Project manual setup\n\n- name: ${project.name}\n- purpose: ${project.purpose}\n- status: HUMAN_WAITING\n`; }
