import path from 'node:path';

export function artifactFilename({ projectId, stage, workId, artifactType, version }) {
  for (const [key, value] of Object.entries({ projectId, stage, workId, artifactType, version })) if (value === undefined || value === null || value === '') throw new Error(`${key} is required`);
  return `${projectId}-${stage}-${workId}-${artifactType}-v${version}.md`;
}

export function artifactPath(root, metadata) { return path.join(root, '.ai-workflow', 'artifacts', artifactFilename(metadata)); }

export async function writeArtifact(root, metadata, body) {
  const target = artifactPath(root, metadata); await (await import('node:fs/promises')).mkdir(path.dirname(target), { recursive: true });
  await (await import('node:fs/promises')).writeFile(target, body.endsWith('\n') ? body : `${body}\n`); return path.relative(root, target).replaceAll('\\', '/');
}
