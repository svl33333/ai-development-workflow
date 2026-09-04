# Phase 1 test run

- test_run_id: phase1-local-002
- execution_record: `work/runs/phase1-test-execution.json`
- executed_at: 2026-09-04T23:17:05.9718419+09:00
- base_revision: `6c4219457d7336d14c8c9b02ecdc737a563fdc57` (working tree changes included)
- command: `npm test`
- result: 22 passed, 0 failed
- command: `npm run validate:fixture`
- result: passed
- command: `git diff --check`
- result: passed
- external writes: none
- PR review fixes: approval enforcement, optimistic revision check, lock metadata, artifact-array round-trip, canonical state naming, runtime schema validation, fail-closed Project verification, approval-gate resume dispatch, publish/merge dispatch, stale approval and lock-collision tests
- PR review status: C2C iteration 15 requested a current execution record; re-review pending
