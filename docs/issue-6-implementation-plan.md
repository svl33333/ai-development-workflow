# Issue #6 実装計画

対象: C2C再接続性とレビュー成果物提示の改善

## 目的

導入先ワークスペースの実体を基準に、Codex再起動後も既存のC2C接続、ChatGPT Project、Issue・工程・役割別の会話を安全に再利用する。同時に、人間レビューまたは承認を依頼する前に対象成果物を閲覧可能にし、提示後の変更を検出して再提示・再承認を要求する。

## 実装順序

1. 正式仕様を追加し、導入済み・C2C接続確認済み・Project照合済み・会話再開可能を独立した状態として定義する。
2. 状態モデルとマイグレーションを拡張する。導入先のworkspace、repository、branch、Project、connection bindingを保存し、導入元のmaster pathを接続identityに使用しない。
3. C2C接続の再診断・再認証を実装する。同一workspaceでは既存接続の修復を優先し、別接続・別Projectを自動作成または推測しない。失敗時は期待値、実値、必要操作を保存してBLOCKED/HUMAN_WAITINGにする。
4. Project resolverを追加する。固有ID、workspace、repositoryを全一致で検証し、一覧取得不能時のURL fallbackにも同じ検証を適用する。
5. Issue/work・stage・role単位のconversation registryを導入する。同一Issue・同一工程・同一役割だけをresumeし、別Issue・別工程・別役割の会話を暗黙再利用しない。planningとplan_reviewの分離、および3ラウンドレビュー契約を維持する。
6. ConversationRunnerとOrchestratorの復旧経路を一本化する。resume前にworkspace、repository、Project、work、stage、role、conversationを照合し、resume不能時に新規会話へ自動fallbackしない。送信結果不明時のreconciliationと二重送信防止を維持する。
7. ユーザー向け成果物提示記録を追加する。path、kind、version、hash/commit、提示時刻、提示方法、approval状態を保存し、product root外のpathや読取不能な成果物を拒否する。
8. 仕様確認、Issue確認、実装計画承認、PR公開承認、マージ承認の前に必ず成果物を提示する。提示できない場合は依頼を出さず停止する。提示後にhash/versionが変わった場合は提示と承認をstaleにする。ChatGPT内部レビューだけはユーザー向け提示を要求しない。
9. status/nextおよび承認待ち結果に、閲覧対象の絶対パス、種別、版、hash、概要、提示状態を含める。ただし長大な本文をチャットへ展開しない。
10. fixture、単体、統合、実環境E2Eを追加・更新する。

## 主な対象

- `src/onboarding.js`
- `src/model.js`
- `src/state-store.js`
- `src/adapters/chatgpt-project.js`
- `src/conversation-runner.js`
- `src/orchestrator.js`
- `src/artifacts.js`
- `src/approvals.js`
- `src/cli.js`
- `test/onboarding.test.js`
- `test/project-and-credential.test.js`
- `test/conversation-runner.test.js`
- `test/state-store.test.js`
- `test/orchestrator.test.js`

## 受入条件

- `npm test`、`npm run validate:fixture`、`git diff --check` が成功する。
- 再起動後も既存workspace connection、Project、同一Issue・工程・役割の会話を再利用でき、新しい接続を増やさない。
- 導入元や別productのworkspace、repository、branchを導入先へ持ち込まない。
- Project不一致、会話不一致、resume不能時に自動fallbackせず、安全に停止する。
- task、Issue、stage、iteration、message単位の再送で二重送信しない。
- 人間レビュー・承認前に対象成果物が実在し、閲覧可能な絶対パスとhash/versionが提示される。
- 提示後の成果物変更で旧提示・旧承認が無効になる。
- 成果物提示不能時はレビュー・承認依頼へ進まない。
- 既存のplanning/plan_review会話分離、計画レビュー3ラウンド、送信結果不明時のreconciliationを維持する。
- 実環境E2Eで onboarding、Project/C2C binding、Codex restart、接続再利用、会話resume、成果物提示、変更後の再提示を確認する。

## リスクと停止条件

接続先・Project・repository・branchのいずれかを検証できない場合、または提示対象を閲覧可能にできない場合は、実装や承認依頼を進めずBLOCKED/HUMAN_WAITINGとして必要な人間操作を提示する。

## ROUND 2 追加設計

### Identityと状態遷移

- C2C connection、Project、repository-scoped Issue、conversationを別identityとして扱う。
- connectionの安定identityはworkspaceとcanonical repositoryで構成し、branchは実行時Git context/evidenceとして分離する。branch変更だけでは接続を新規作成しない。
- Issue作成前は`provisional_work_id`を使い、Issue作成成功時に`repository_identity + issue_number`（または同等のimmutable Issue ID）へ明示的に移行する。artifact、conversation、review、presentation、approvalのbindingを移行し、移行途中の混在は拒否する。
- Issue作成後はrepository-scoped Issue identityだけを正本とし、旧provisional identityによるresumeやapprovalを拒否する。
- 状態遷移に`production_issue_creating`と`production_issue_waiting_review`を追加する。Issue本文のpresentation receiptとIssue確認approvalなしに`production_planning`へ進めない。

### State/schema/migration

- `src/validation.js`、`schemas/workflow-state.schema.json`、`schemas/approval.schema.json`、必要なら`schemas/presentation-receipt.schema.json`を実装対象に含める。
- state schema versionを上げ、legacyからのmigrationをdeterministic、idempotent、fail-closedにする。
- serialize → read → migrate → serialize → readのround-tripと、二重migration、半migration状態の拒否をテストする。
- `workflow/managed`およびfixtureへ配布するschemaとversionを同期する。

### Project/conversation復旧

- Projectの通常解決はunique identifier、workspace、repositoryの全一致とする。URL fallbackはURL文字列を信頼せず、Project metadataを取得して同じ検証を通す。metadataを取得できない場合はresolvedにしない。
- conversation registryをrepository-scoped Issue identity、stage、roleの正本とする。既存`review_context`はreview round等のメタデータとregistry参照だけを保持し、registryとの不一致はvalidation errorにする。
- resume前にconnection、Project、repository-scoped Issue、stage、role、conversationを照合する。別Issue・別工程・別role、resume不能、重複接続候補では自動fallbackや無断置換をしない。
- idempotency identityはtask、canonical Issue、stage、iteration、messageとし、ambiguous deliveryのreconciliationを維持する。

### Artifact presentationとapproval

- `src/artifact-presenter.js`を新設し、artifact解決、product root内path検証、digest計算、実際の表示/open adapter呼び出し、成功確認、immutable receipt生成を分離する。`fs.access()`だけではpresentation成功とみなさない。
- receiptには`presentation_id`、Issue identity、kind、path、canonical revision、digest、presented_at、presentation method、adapter result/referenceを含める。表示成功なしにreceiptを発行しない。
- canonical revisionはkindごとに固定する。ローカル文書はcontent SHA-256、Git snapshotはcommit SHA、remote PRはPR番号とhead SHAを使う。
- 人間approvalにはpresentation_id、digest、canonical revision、Issue identityを必須bindingとする。approval作成時とゲート通過直前にreceiptと現在artifactを再検証し、不一致ならstaleとして拒否する。
- 対象は正式仕様、Issue本文、実装計画、local PR draft、PR review evidence、merge対象PR/head SHAとする。ChatGPT内部reviewのみはユーザー向けpresentationを要求しない。
- `status`/`next`はabsolute path、kind、revision、digest、presentation result、review pointsを返し、提示失敗時はapproval instructionsを出さない。

### 負系テストとE2E

- Issue確認approvalなしのplanning遷移、provisional identity混在、schema migration破損、URL metadata取得不能、review_context不一致を拒否する。
- wrong workspace/repository/Project/Issue/stage/role、missing/non-resumable conversation、connection repair failure、duplicate connection候補で新規接続・Project・会話を無断生成しない。
- presentation adapter失敗、digest変更、approval作成後変更、gate直前変更、canonical revision mismatch、別Issue receiptの流用を拒否する。
- 実環境E2Eでは正常系に加え、上記の誤復旧・提示失敗・stale approval経路を確認し、すべてfail-closedとなる証跡を保存する。

### 追加対象ファイル

- `src/workflow.js`
- `src/validation.js`
- `src/artifact-presenter.js`
- `schemas/workflow-state.schema.json`
- `schemas/approval.schema.json`
- `schemas/presentation-receipt.schema.json`
- `workflow/managed`のschema配布関連
- `test/workflow.test.js`
- `test/artifact-presenter.test.js`
- state、onboarding、Project、conversation、orchestrator、CLIの関連テスト
