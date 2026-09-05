# Independent plan review round 2

- 判定: `NEEDS_WORK`
- 対象計画: `design-docs-for-ai/issue1-phase1-shared-ai-development-workflow-implementation-plan.md`
- 基準リビジョン: `6c4219457d7336d14c8c9b02ecdc737a563fdc57`
- 観点: 受入条件、既存構成との整合性、テスト、移行とロールバック
- reviewer thread: `01a0626a-fd08-7680-adc0-4fde32344fc5`

## 必須対応と採否

### R1 — adopted

- 重大度: `CRITICAL`
- 対象: §4、§7、§11
- 問題: `implementation_plan` に計画レビューを混在させ、仕様の「計画→レビュー→承認→実装」を独立工程として観測できない。
- 反映方針: `plan_review` stage、計画レビュー artifact、計画承認 gate、停止理由、fixture/E2E を追加する。

### R2 — adopted

- 重大度: `CRITICAL`
- 対象: §4、§6
- 問題: snapshot だけでは後退・skip・改ざんを検証できず、`E_INVALID_TRANSITION` の根拠が不足する。
- 反映方針: append-only transition history と state hash、初期化・再開・改ざん・後退・skip の負例を追加する。

### R3 — adopted

- 重大度: `IMPORTANT`
- 対象: §4、§5、§7
- 問題: stageごとの成果物、生成者、入力・出力、既存候補選択、state mutation の原子性が定義されていない。
- 反映方針: stage artifact contract 表、fixture投入 helper、automatic/manual_assist の期待 sequence、I/O failure 規則を追加する。

### R4 — adopted

- 重大度: `IMPORTANT`
- 対象: §5、§6
- 問題: journal本文で使う `recovered` が status 列挙にない。
- 反映方針: `recovered` と recovery metadata を正式schema化し、各 status の setup 許可/拒否/再開 matrix を追加する。

### R5 — adopted

- 重大度: `IMPORTANT`
- 対象: §3、§5、§6
- 問題: Codex先行後のCopilot追加、`both`、共有manifestの所有・マージ・rollbackが未定義。
- 反映方針: immutable common set と adapter set、manifest ownership、個別追加/update/rollbackの規則とテストを追加する。

### R6 — adopted

- 重大度: `SUGGESTION`
- 対象: §6
- 問題: error code と exit code の対応および JSON diagnostic shape が固定されていない。
- 反映方針: `contracts.py` の全 error code/分類/exit status と共通 JSON 診断形式を追加する。

## 未確認事項

- 基準 tree には実装コード、テスト、CI、Issue/PRのローカル記録がないため、それらとの互換性は未評価。
- 外部 GitHub Issue #1 とリモートの現時点の内容は、このレビューでは根拠にしていない。

## 読んだ範囲

- 基準リビジョンの Git root/tree
- `README.md`
- `docs/ai-development-workflow-package-spec.md`
- `.github/copilot-instructions.md`
- `user-prompts/issue1-implementation-plan.md`
- 提供された計画本文 §1〜§13

## 追加確認（同一ラウンドの補足）

追加レビューでも `NEEDS_WORK`。R1（`plan_review` 独立化）、R2（限定 front matter grammar と state 例の不整合）、R3（`recovered` の正式化）、R4（manifest の mutable/immutable 分類）、R5（全 error code の canonical catalog）を adopted とする。R6（E2E が `pr_review`、`merge_pending`、再開、`complete` のどこまで進むか）は adopted とする。未確認事項は会社環境、UI、外部 Issue/PR のまま維持する。
