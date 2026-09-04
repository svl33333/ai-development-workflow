export function classifyFinding(finding) {
  const severity = finding.severity ?? 'SUGGESTION';
  if (!['CRITICAL', 'IMPORTANT', 'SUGGESTION'].includes(severity)) throw new Error(`unknown severity: ${severity}`);
  const autoFix = finding.blocks_progress === true && finding.requires_spec_change === false && finding.in_scope === true;
  return { ...finding, severity, auto_fix: autoFix, action: finding.requires_spec_change ? 'HUMAN_DECISION' : autoFix ? 'AUTO_FIX_TEST_REVIEW' : 'RECORD' };
}
