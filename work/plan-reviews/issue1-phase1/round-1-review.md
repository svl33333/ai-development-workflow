# Independent plan review round 1
- 判定: `NEEDS_WORK`
- 対象計画: `design-docs-for-ai/issue1-phase1-shared-ai-development-workflow-implementation-plan.md`
- 基準リビジョン: `6c4219457d7336d14c8c9b02ecdc737a563fdc57`
- 観点: 受入条件、既存構成との整合性、テスト、移行とロールバック

## 必須対応と採否

### R1 — adopted

- 重大度: `CRITICAL`
- 対象: §3、§6、§10、§11
- 根拠: 仕様書の操作一覧・初期版完了条件に `next` と自動/手動アシストモードがあるが、計画初版では責務・CLI・テストが不足。
- 理由: 受入条件の setup→prototype→production→PR→validate→restart を機械的に実行できる契約が必要。
- 反映: `advance_workflow_stage.py`、`next` の入出力・エラー・冪等性、mode/gate テスト、実施順序・受入対応表を追加。

### R2 — adopted

- 重大度: `CRITICAL`
- 対象: §4
- 根拠: prototype→production を定義しながら track 横断を一律拒否し、単一 approval では複数ゲートを表現できない。
- 理由: prototype promotion、code reuse、requirements、plan、merge の承認を機械検証可能に分離する必要がある。
- 反映: 許可された `promotion_pending→production/requirements_grilling`、`approvals` 配列、`prototype_promotion` / `prototype_code_reuse` gate、停止条件を追加。

### R3 — adopted

- 重大度: `IMPORTANT`
- 対象: §3、§6
- 根拠: installed manifest、dry-run 結果、apply 時の再検証契約が不足。
- 理由: 別プロセス・別時刻の update 対象を同一性検証できないと安全な更新にならない。
- 反映: `distribution-manifest.json`、`update-plans/<update-id>.json`、canonical JSON + SHA-256 の ID、stale 条件、apply/rollback テストを追加。

### R4 — adopted

- 重大度: `IMPORTANT`
- 対象: §3、§6、§7
- 根拠: 部分導入時の journal、復旧コマンド、再開/中止条件、テストが不足。
- 理由: I/O failure 後の自動上書き・削除を防ぎ、実装者依存の復旧を避ける必要がある。
- 反映: `install-journal.json` の schema、再開候補・中止・manual recovery、I/O failure と復旧後 validate のテストを追加。

### R5 — adopted

- 重大度: `IMPORTANT`
- 対象: §1
- 根拠: 基準リビジョンには README、Copilot instructions、仕様書、prompt、Git remote が存在する。
- 理由: 「空で Git ではない」という前提は、既存ファイル保護と変更範囲を誤らせる。
- 反映: 基準 tree とローカルの uncommitted 計画関連ファイルを区別し、着手時に保持対象・status を再確認する記述へ訂正。

### R6 — adopted

- 重大度: `IMPORTANT`
- 対象: §5、§6、§11
- 根拠: Issue 草案の Security classification confirmation と artifact source graph の検査契約が不足。
- 理由: 間接参照による company-confidential 情報の公開流出を pattern 検査だけでは防げない。
- 反映: 最機密分類の継承、`classification_review` 必須フィールド、source graph の欠落/循環/到達性、renderer 拒否条件と負例を追加。

### R7 — adopted

- 重大度: `SUGGESTION`
- 対象: §6
- 根拠: 同一出力の再実行と異なる内容の衝突の関係が初版では曖昧。
- 理由: 実装者が no-op と衝突を同じ扱いにしないため。
- 反映: 同一内容は no-op、異なる内容は `E_TARGET_EXISTS` と CLI 契約に明記。

## 未確認事項・人間の判断

- 基準リビジョンには Issue 本文・コメントが存在しないため、Issue #1 の全条件と後発コメントは未検証。
- Codex skill discovery と VS Code Copilot References は手動確認が必要。
- 会社環境の Python、GitHub host、認証、ポリシー境界は preflight で確認する。

## 読んだ範囲

- 基準リビジョンの Git tree、remote、status
- `README.md`
- `docs/ai-development-workflow-package-spec.md`
- `.github/copilot-instructions.md`
- `user-prompts/issue1-implementation-plan.md`
- 対象計画ファイル全文
