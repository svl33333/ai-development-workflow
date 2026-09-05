import { STAGES } from './model.js';

export const TRANSITIONS = {
  prototype_intake: 'prototype_design', prototype_design: 'prototype_implementation',
  prototype_implementation: 'prototype_evaluation', prototype_evaluation: 'promotion_waiting_approval',
  promotion_waiting_approval: 'production_grilling', production_grilling: 'production_spec_waiting_approval',
  production_spec_waiting_approval: 'production_issue_creating', production_issue_creating: 'production_issue_waiting_review',
  production_issue_waiting_review: 'production_issue_ready', production_issue_ready: 'production_planning',
  production_planning: 'production_plan_review', production_plan_review: 'production_plan_improvement',
  production_plan_improvement: 'production_plan_review',
  production_plan_waiting_approval: 'production_implementation', production_implementation: 'production_pr_draft',
  production_pr_draft: 'production_pr_review', production_pr_review: 'production_publish_waiting_approval',
  production_fix: 'production_pr_review', production_publish_waiting_approval: 'production_published',
  production_published: 'production_merge_waiting_approval', production_merge_waiting_approval: 'completed'
};

export function nextStage(stage) { if (!STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`); return TRANSITIONS[stage] ?? null; }
export function canTransition(from, to) { return TRANSITIONS[from] === to; }
