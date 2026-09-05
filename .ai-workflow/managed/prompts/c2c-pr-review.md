[C2C] operation=pr_review
ローカルPR草案、差分、テスト結果、Issue、実装計画をMCPで読み、指摘ごとにseverity、blocks_progress、requires_spec_changeを返してください。
## Integration review contract

Review only the final integrated revision against the approved Issue, plan, manifest, test evidence, and PR artifact. Critical/High findings become fix units; after each fix, reintegrate, rerun affected and final tests, regenerate the PR artifact, invalidate stale approval/presentation receipts, and review again.
