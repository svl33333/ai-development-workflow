[C2C] operation=production_plan
承認済みIssue、仕様、現行リポジトリをMCPで読み、実装可能な計画をファイル単位で返してください。ファイル編集はしないでください。
## Issue #8 structured execution contract

In addition to the human-readable implementation plan, return a machine-readable execution manifest. Each unit must include `unit_id`, `purpose`, `dependency_ids`, `change_scope`, `acceptance_criteria`, `unit_tests`, and `integration_criteria`. Include `max_parallel_codex_tasks` (default 3), a deterministic `approval_digest`, and reject cycles, unknown dependencies, duplicate IDs, and overlapping parallel scopes.
