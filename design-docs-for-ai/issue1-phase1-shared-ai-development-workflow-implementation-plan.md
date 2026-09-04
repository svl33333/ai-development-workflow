# Phase 1: 共通AI開発ワークフロー実装計画

- Issue: https://github.com/svl33333/ai-development-workflow/issues/1
- Base revision: `6c42194`
- Status: plan-draft
- Scope: 個人環境のCodex + ChatGPT/C2Cによる最小縦切り
- Out of scope: 会社環境の実装、Copilotの実動オーケストレーション、外部DB、横断状況UI

## 1. 計画の結論

Phase 1は、汎用的なマルチエージェント基盤ではなく、fixtureプロジェクトで「プロトタイプ受付から本番Issue解決、PRレビュー、承認後の公開・マージ、再開」までを一巡できる最小の縦切りとして実装する。

正本は各プロダクトの `.ai-workflow/` に保存する。会話履歴や外部サービスを状態の正本にしない。Codexは調査・編集・実行・GitHub操作を担当し、ChatGPTはC2Cの読み取りだけで設計・計画・レビューを行う。人間の承認はファイルに保存し、対象のIssue、PR番号、最新コミット、テスト結果に結び付ける。

現環境で確認できたランタイムはNode.js `v24.16.0` とGitHub CLI `2.98.0`。Pythonは利用できないため、依存を最小化したNode.js CLIを採用する。仕様で合意済みの状態正本はMarkdown本文 + YAML front matterとし、Node.js内部ではJSオブジェクトに変換してJSON Schemaで検証する。設定はJSONを採用できるが、状態表現をJSONだけに置き換えない。

## 2. 実装対象ファイル

### 共通マスター

追加する論理構成は次のとおり。既存ファイルは上書きせず、READMEと既存Copilot instructionsは内容を確認して追記する。

```text
package.json
bin/ai-workflow.js
src/model.js
src/state-store.js
src/artifacts.js
src/workflow.js
src/validation.js
src/approvals.js
src/handoff.js
src/adapters/codex.js
src/adapters/chatgpt-c2c.js
src/adapters/chatgpt-project.js
src/adapters/copilot.js
skills/prototype-design/SKILL.md
skills/prototype-evaluation/SKILL.md
skills/production-planning/SKILL.md
skills/independent-plan-review/SKILL.md
skills/pr-review/SKILL.md
prompts/c2c-prototype-design.md
prompts/c2c-prototype-evaluation.md
prompts/c2c-production-planning.md
prompts/c2c-independent-plan-review.md
prompts/c2c-pr-review.md
schemas/workflow-state.schema.json
schemas/workflow-config.schema.json
schemas/artifact-metadata.schema.json
schemas/approval.schema.json
schemas/c2c-request.schema.json
schemas/c2c-response.schema.json
schemas/review.schema.json
workflow/workflow.json
templates/state.md
templates/concept-brief.md
templates/prototype-handoff.md
templates/implementation-plan.md
templates/local-pr-draft.md
templates/review-record.md
templates/final-pr-body.md
templates/project-config.json
fixtures/sample-product/...
scripts/validate-fixture.js
test/...
```

責務は以下に固定する。

- `model.js`: 状態、成果物、レビュー、承認、C2C envelopeの型・既定値。
- `state-store.js`: `.ai-workflow/state/` のMarkdown + YAML front matter状態ファイルの読書き、本文保持、アトミック置換、revision比較、ロック。
- `artifacts.js`: 命名、メタデータ、パス解決、Issue/計画/PR/レビューのリンク検証。
- `workflow.js`: 正規ステージ、合法遷移、承認ゲート、停止・再開、再試行上限。
- `validation.js`: JSON Schema相当の構造検証、成果物リンク、互換性、Git基準リビジョン検証。
- `approvals.js`: 承認者、承認種別、対象Issue/PR、最新コミット、テスト結果、期限、失効条件を保存・検証。
- `handoff.js`: `status`、`next_action`、`artifacts`、`findings`、`questions`、`stop_reason`、`handoff_summary`を含む最小受け渡し。
- `adapters/codex.js`: CodexからCLI、Git、テスト、GitHub操作を呼び出す境界。ワークフロー規則を再定義しない。
- GitHub操作は永続OAuthのGitHubコネクターを優先し、Issue／PR更新とAPI commitを再認証なしで実行する。401などの失効時だけCLI認証をフォールバックする。認証情報はプロジェクトへ保存しない。
- `adapters/chatgpt-c2c.js`: C2C依頼・回答の契約、読み取り対象、接続障害の分類。ChatGPTへの書込み権限を与えない。
- `adapters/chatgpt-project.js`: プロトタイプ用／本番用ChatGPT Projectの名称、設定、指示、会話目的を定義し、利用可能性をprobeする。自動作成できない場合は人間向けの手動設定成果物を作成し、検証済みProject以外への依頼を止める。会話履歴は状態の正本にしない。
- `adapters/copilot.js`: 共通入力・出力・機密境界・未対応状態だけを文書化する。実動処理は実装しない。
- `skills/`: Codex側で工程を開始するSkillの共通マスター。プロトタイプ設計／評価、本番計画、独立計画レビュー、PRレビューと、それぞれのC2C依頼契約をファイル単位で持つ。既存`codex-plan-review-loop`は独立計画レビューの実装基盤として再利用し、共通の状態・成果物契約に合わせる。
- `prompts/`: C2Cへ送る短い操作依頼の正本。ファイル内容や差分を貼らず、workspace、work_id、stage、参照パス、read_scope、期待するoperationだけを渡す。

### プロダクト側fixture

`fixtures/sample-product/.ai-workflow/` に、`config.json`、`state/`、`artifacts/`、`reviews/`、`runs/`、`approvals/`、`locks/`、`pending/` を配置する。認証情報は含めない。実際にIssueを解決する小さなサンプル変更とテストも置き、単なる状態遷移テストで終わらせない。

### 既存資料

- `docs/ai-development-workflow-package-spec.md` と `docs/phase1-grill-summary.md` を仕様の根拠として維持する。
- `user-prompts/issue1-implementation-plan.md` は計画作成プロンプトの記録として維持する。
- `.github/copilot-instructions.md` はPhase 1のCopilot境界を説明する範囲に留める。
- READMEに導入、CLI、fixture検証、C2Cの読み取り専用境界を追記する。

## 3. 状態・成果物・遷移

状態ファイルのYAML front matterの最小例（Markdown本文は同一ファイルに保持する）:

```yaml
---
workflow_version: 1
project_id: sample-product
work_id: issue-001
stage: production_pr_review
status: waiting_for_review
agent: codex
chatgpt_project: production
artifacts:
  - kind: issue
    path: .ai-workflow/artifacts/sample-product-production_issue_ready-issue-001-issue-v1.md
    version: 1
  - kind: implementation_plan
    path: .ai-workflow/artifacts/sample-product-production_planning-issue-001-implementation-plan-v1.md
    version: 1
base_revision: 6c42194
current_revision: def456
next_action: chatgpt_pr_review
stop_reason: null
agent_state:
  agent: codex
  stage: production_pr_review
  status: waiting_for_review
  started_at: 2026-09-04T00:00:00Z
  updated_at: 2026-09-04T00:00:00Z
  waiting_reason: chatgpt_review
  next_action: chatgpt_pr_review
  error: null
revision: 7
updated_at: 2026-09-04T00:00:00Z
---
```

状態ファイルは、例えば `.ai-workflow/state/sample-product-production_pr_review-issue-001-state-v1.md` とする。成果物はすべて次の関数で命名し、metadataを権威としつつファイル名にも全要素を含める。

```text
<project-id>-<stage>-<work-id>-<artifact-type>-v<version>.md
```

推奨ステージは `prototype_intake`、`prototype_design`、`prototype_implementation`、`prototype_evaluation`、`promotion_waiting_approval`、`production_grilling`、`production_spec_waiting_approval`、`production_issue_ready`、`production_planning`、`production_plan_review`、`production_plan_waiting_approval`、`production_implementation`、`production_pr_draft`、`production_pr_review`、`production_fix`、`production_publish_waiting_approval`、`production_published`、`production_merge_waiting_approval`、`completed`、`stopped`、`blocked` とする。短期的な待機や失敗はステージを増やさず、`status`、`next_action`、再試行回数、`stop_reason`で表現する。

プロトタイプから本番へは、`prototype-handoff.md` で設計、評価結果、利用シナリオ、成功条件、失敗条件、採用・却案例、残課題を参照リンク付きで渡す。Codexが本番grillingを実施し、`production_spec_waiting_approval`で停止する。人間が仕様確定を承認した後に、Codexが`CONTEXT.md`/ADRを確定し、本番Issueを作成する。

## 4. CLI契約

エントリポイントは `node bin/ai-workflow.js <command>` とし、最初に `setup`、`status`、`validate`、`next` を実装する。

- `setup --product <path> --config <path>`: 管理対象ディレクトリ、設定、正規の初期状態だけを冪等に作成する。fixtureのIssue・レビュー・PR成果物は作成しない。既存ファイルを上書きせず、競合はエラーとする。fixtureデータはテストヘルパーが別途生成する。
- `status --product <path> [--json]`: 現在工程、承認待ち、ブロッカー、残課題、次アクションを表示する。JSON出力は機械可読にする。
- `validate --product <path>`: 状態、成果物リンク、スキーマ、合法遷移、revision、承認対象、機密ファイル除外を検証する。失敗時は項目別エラーと終了コードを返す。
- `next --product <path> --mode auto|assist`: 現在工程から次の承認点またはブロッカーまで進める。Phase 1では実行アダプターをfixtureに限定し、承認・破壊的操作・外部公開では必ず停止する。
- `update --product <path> [--check|--apply]`: 共通マスターの候補バージョン、`workflow_version`、`schema_version`、各adapterの`adapter_version`、導入済みpackage versionと互換性を表示する。適用は人間承認必須で、流れは共通マスター→プロダクトの一方向のみとする。管理対象ファイルの手動変更や非互換は自動適用せず、`HUMAN_DECISION`/`BLOCKED`にする。

全コマンドは再実行可能にし、入力不備は終了コード2、状態競合は3、未承認ゲートは4、接続障害は5、テスト失敗は6とする。`--dry-run`を用意し、外部公開・マージは明示フラグと保存済み承認の双方を要求する。

## 5. C2Cの入力・出力契約

CodexからChatGPTへ送る依頼は、内容を貼り付けず、対象ワークスペース、作業ID、工程、参照すべき成果物パス、許可された読み取り範囲、期待する出力種別だけを含める。ChatGPTはMCPで必要ファイル、Git差分、テスト記録を読む。

```json
{
  "protocol": "c2c",
  "state": "INIT|EXECUTED|REVIEW",
  "operation": "prototype_design|prototype_evaluation|production_plan|independent_plan_review|pr_review",
  "task_id": "c2c_7b3e",
  "iteration": 0,
  "goal": "Issue #1の実装計画を作成",
  "inputs": ["work/issue-1-body.md", "docs/phase1-grill-summary.md"],
  "read_scope": ["issue", "specification", "git_status", "git_diff", "execution_output"],
  "expected": "PLAN|DONE|BLOCKED"
}
```

ChatGPTの回答は `status`、`next_action`、`artifacts`、`findings`、`questions`、`stop_reason`、`handoff_summary`を必須にし、計画ではファイル単位の提案・理由・テスト・リスクを含める。ChatGPTはファイル編集、コマンド、コミット、Issue/PR投稿、公開、マージを行わない。

接続障害は状態を保存して `blocked` にし、再接続後に `workspace_info` → 状態再読込 → workflow/artifact検証 → 期待revisionと現在Git revisionの比較 → 保留中requestのtask/iteration確認 → 同じ作業IDとiterationで再試行、の順で進める。workspaceまたはrevisionが一致しなければ再試行せず `BLOCKED` とする。過去の会話だけで現行コードを推測しない。

ChatGPT Projectはプロトタイプ用と本番用を分離する。設定値にはProject名、指示文、会話目的、許可された読み取り範囲を持たせ、C2C開始前に`chatgpt-project` adapterが対象Projectの存在と設定を確認する。Projectの自動作成・設定変更が利用できない場合は、必要な設定を記した手動設定成果物を`HUMAN_WAITING`として保存し、人間が設定完了を確認するまで依頼を送らない。想定外のProjectや目的の会話を検出した場合は誤送信防止のため`BLOCKED`とする。

## 6. 実装・レビュー・PRフロー

1. Codexがアイデアを調査し、ラフな`concept-brief`を生成する。
2. ChatGPTがprototype詳細設計・実装計画・評価基準を返し、人間が実装開始を承認する。
3. Codexがプロトタイプを実装・テストし、評価結果・失敗条件・残課題を保存する。
4. ChatGPTが差分・テスト・評価記録をMCPでレビューし、`ITERATE`、`PROMOTE_CANDIDATE`、`STOP`を返す。`ITERATE`は人間確認後にCodexが修正・再テスト・再レビューし、`STOP`は本番へ遷移させない。`PROMOTE_CANDIDATE`だけを本番移行承認へ進める。
5. 人間が本番移行を承認した後、Codexが本番grillingを実施し、`production_spec_waiting_approval`で停止する。人間が仕様確定を承認した後に、Codexが`CONTEXT.md`/ADRを確定し、本番Issueを作成する。
6. ChatGPTがIssue・仕様・現行リポジトリを読み、実装計画を作る。
7. ChatGPTの計画を別の新鮮なChatGPT会話で独立レビューする。計画作成側の結論や会話履歴をレビュー側へ渡さず、Issue、計画、仕様、現行コードだけを根拠にする。
8. 人間が計画を承認するまで実装を開始しない。
9. Codexが計画に従ってコーディング→テスト→修正を繰り返す。
10. CodexがローカルPR草案とテスト結果を保存する。
11. ChatGPTがMCPでGit差分、PR草案、Issue、計画、テスト結果をレビューする。
12. レビュー成果物の重要度は `severity: CRITICAL|IMPORTANT|SUGGESTION`、`blocks_progress`、`requires_spec_change`で機械判定する。`blocks_progress == true` AND `requires_spec_change == false` AND 承認済みIssue/計画の範囲内、の3条件をすべて満たす指摘だけをCodexが根本原因・同種箇所・テストまで自動修正し、再レビューする。外部向けのHighは`IMPORTANT`かつ`blocks_progress: true`へ明示的にマッピングする。`requires_spec_change == true`はseverityに関係なく人間判断へ停止する。その他の指摘は人間が採否を判断する。
13. Codexが最終PR本文を作成し、人間が公開前に確認する。
14. 承認後、CodexがGitHub PRを公開する。公開後の変更は最新コミットに対して再レビュー・再承認する。
15. 人間の明示承認後、CodexがPRをマージし、Issueリンク、レビュー記録、残課題、最終状態を更新する。

共通マスターの更新は、プロダクトの現在バージョンと候補版の互換性を`update --check`で確認してから、差分と適用対象を人間へ提示する。承認後だけ`update --apply`を実行し、共通マスターからプロダクトへ一方向に反映する。プロダクト側の管理対象ファイルを共通マスターへ逆同期しない。

PR本文テンプレートにはIssue URL、対応範囲、非対応範囲、確認結果、変更点概要、変更理由、主な変更内容、重点レビュー項目、既知の制約、補足情報を含める。Issue本文は転記せずリンクする。

## 7. 承認・停止・競合

承認レコードは次の値を保持する。`test_run_id`、`review_artifact`、レビューiteration、未解決blocking件数を自由記述ではなく参照として保存する。

```json
{
  "kind": "prototype_implementation|promotion|production_spec|production_plan|pr_publish|pr_merge|destructive_operation|spec_change",
  "approved_by": "human",
  "issue_url": "https://github.com/.../issues/1",
  "pr_number": null,
  "target_revision": "def456",
  "test_run_id": "run-20260904-001",
  "test_artifact": ".ai-workflow/runs/sample-product-production_implementation-issue-001-test-v1.md",
  "review_artifact": ".ai-workflow/reviews/sample-product-production_pr_review-issue-001-review-v3.md",
  "review_iteration": 3,
  "unresolved_blocking_findings": 0,
  "artifact_version": 1,
  "operation_id": null,
  "approved_at": "2026-09-04T00:00:00Z",
  "valid": true
}
```

承認対象のIssue、PR番号、最新コミット、`test_run_id`、テスト成果物、レビュー成果物、iteration、未解決blocking件数が一致しない場合は失効する。`prototype_implementation`はprototype設計artifact/version、`production_spec`はgrill・受入条件artifact/version、`destructive_operation`は具体的な`operation_id`を必須のbindingとする。新しいコミット、PR head、必須テスト、レビュー結果が発生した場合も失効する。仕様変更、機密境界違反、破壊的操作、入力不足、同一失敗の反復、最大試行回数到達、ブランチや成果物の不整合では停止する。状態更新はrevision比較とロックで直列化し、競合時は再読込して自動上書きしない。

## 8. テスト計画

- 単体: 遷移、承認失効、revision競合、ロック、成果物リンク、命名、JSON出力、エラーコード。命名関数は必須要素不足を拒否し、version増分とstage/work単位の衝突回避を確認する。
- エージェント状態: `agent_state`の必須項目（agent、stage、status、started_at、updated_at、waiting_reason、next_action、error）、トップレベル状態との一致、待機理由と次アクションの整合性、失敗・再開時の更新を確認する。
- 状態永続化: front matterのparse → validate → 本文を保持したatomic update → 再読込のround-trip。
- 契約: C2C request/responseの必須項目、未知状態、巨大入力、機密情報を要求に含めないこと。`schemas/*.json`はNode.jsの実際のJSON Schema validator（依存導入前に候補とバージョンを検証）から実行し、validatorを採用できない場合も限定的内製検証との対応をテストで明示する。スキーマを文書だけにしない。
- fixture統合: `setup → concept brief → ChatGPT prototype design → prototype design approval → implementation → test → ChatGPT evaluation → ITERATE/PROMOTE_CANDIDATE/STOP → promotion approval → production grilling → production spec approval → CONTEXT/ADR → production Issue → plan → plan review → plan approval → implementation → local PR → PR review → Critical/High fix loop → publish approval → publish → merge approval → merge → completed`。通常のテストは外部サービスを呼ばず、fake GitHub adapterで検証する。
- 障害: C2C 401/接続断、テスト失敗、同一失敗、状態競合、途中停止からの再開、再実行時の重複生成。
- 承認ゲート: prototype設計承認なしの実装、本番仕様承認なしのIssue作成、計画承認なしの実装、破壊的操作承認なしの実行、誤ったapproval kindや別work_idの承認再利用を拒否する。
- セキュリティ: `.env`、トークン、秘密鍵、会社固有ログが成果物・C2C envelope・PR本文に含まれないこと。
- 実成果物: fixtureのIssueを解決する小さな変更を実装し、テスト成功、レビュー指摘の修正、PR公開・マージまでfake adapterで確認する。
- live GitHub統合: `gh pr create` / `gh pr merge` は通常テストから分離した明示的opt-inテストとし、対象リポジトリ、認証、ブランチ、安全な後始末、ユーザー承認を要求する。認証がない場合は安全にskipまたはblockedとする。
- setup分離: 空のプロダクトに`setup`してもサンプルIssue・レビュー・PR成果物が生成されないこと、fixture builderを明示的に呼んだ場合だけfixture一式が作られることを確認する。
- Project境界: プロトタイプ／本番Projectの設定probe、手動設定成果物、未設定・誤Projectでの送信停止、設定確認後の再開を確認する。
- 共通マスター更新: `update --check`のバージョン／互換性表示、人間承認前の非適用、承認後の一方向更新、手動変更・非互換時の`HUMAN_DECISION`/`BLOCKED`を確認する。

## 9. 一次情報と検証タスク

実装時に以下の一次情報を確認し、URLと確認日を記録する。

- Node.js CLI: https://nodejs.org/api/
- GitHub CLI manual: https://cli.github.com/manual/
- GitHub Issues REST API: https://docs.github.com/en/rest/issues/issues
- GitHub Pull Requests REST API: https://docs.github.com/en/rest/pulls/pulls
- GitHub Actions workflow syntax: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
- ChatGPT connectors/MCP: https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- codex-with-chatgptの現行仕様: `C:\Projects\codex-with-chatgpt` とインストール済みSkill

未検証事項は、GitHub CLIの公開・マージ権限、ChatGPT Project自動作成の可否、C2Cの接続障害復旧、fixtureでの実測トークン量として、推測で固定しない。

## 10. 実装順序と受入条件対応

1. package/CLI骨格とfixtureを作る。
2. model、schema、state-store、artifacts、validationを作る。prototype設計・評価のoperation、成果物、判定をschema/templateへ追加する。
3. workflow、approvals、handoffを作る。`agent_state`を状態正本に含め、トップレベル状態と整合させる。レビューschemaではseverity、`blocks_progress`、`requires_spec_change`を分離し、3条件のAND判定で自動修正・継続・人間停止を決定する。
4. Codex/C2C/ChatGPT Project/Copilot境界とテンプレートを作る。Project probe、手動設定成果物、誤Project停止を含める。
5. setup/status/validate/nextを接続する。
6. `update --check/--apply`と共通マスター／プロダクト間の一方向更新、バージョン・互換性検証を接続する。
7. fixtureのプロトタイプからPR完了までの統合テストを作る。
8. C2C接続障害・停止再開・競合・レビュー修正テストを追加する。再試行前のworkspace/revision/artifact検証、変更revisionでのBLOCKED、Malformed responseの上限到達を含める。
9. README、実行例、未検証事項、受入確認記録を更新する。

受入条件との対応:

| 条件 | 確認方法 |
| --- | --- |
| 共通マスターから導入できる | fixtureへの冪等setupとファイル一覧 |
| 状態・成果物・承認が永続化される | schema検証と再起動後status |
| prototypeからproductionへ引き継げる | handoffとIssueリンク |
| プロトタイプをChatGPTと反復評価できる | design approval、差分／テスト／評価レビュー、ITERATE/PROMOTE_CANDIDATE/STOPのfixtureテスト |
| ChatGPTは計画・レビューのみ | adapter契約と権限境界テスト |
| Codexが実装・テスト・PRを担う | fixture統合テスト |
| Critical/Highの修正ループ | review fixtureと再レビュー記録 |
| 停止・再開・競合・接続障害に対応 | 障害テスト |
| 人間承認後だけ公開・マージできる | 承認レコードと失効テスト |
| 実際にIssueを解決する | fixtureの機能テストと最終状態 |
| 会社環境境界を守る | 機密除外・Copilot境界・手動フィードバック仕様 |
| 共通マスターを安全に更新できる | バージョン／互換性表示、承認付き一方向更新、非互換停止 |
| エージェントの進行状況を復元できる | `agent_state`の永続化、状態整合性、停止・再開テスト |
| Skillsとpromptsを共通マスターから導入できる | clean setup、update、ローカル変更検出、fresh session起動テスト |

## 11. 実装開始判定

この計画は、現行仕様に対して実装へ着手できる粒度の草案である。ただし、次の3点は実装前に人間が確認する。

1. Node.jsの依存をゼロまたは最小にする方針と、Markdown + YAML front matter正本／JSON内部表現の組み合わせ。
2. 通常fixtureではfake GitHub adapterを使い、live GitHub PR公開・マージはopt-inで検証する方針。
3. GitHub PR公開・マージを実際に行う権限と、C2C接続障害時の再接続手順。

この計画ファイル作成後、独立計画レビューを行い、Critical/High相当の計画欠陥を反映してから、人間の計画承認を待つ。計画承認前に実装は開始しない。

