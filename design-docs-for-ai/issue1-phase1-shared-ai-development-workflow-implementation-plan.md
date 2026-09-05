# Issue #1 Phase 1: 共通 AI 開発ワークフローパッケージ実装計画

## 1. 結論、スコープ、調査前提

Phase 1 は、外部サーバー・専用DB・自律的な本番操作を作らず、共通マスターを Python CLI、契約、テンプレート、fixture の Git リポジトリとして実装する。各プロダクトには `setup` が `.ai-workflow/` と安全に追加可能な adapter ファイルを**一方向**に配布する。会社環境のポリシー、詳細テストログ、実行履歴、秘密を master に書き戻す経路は持たない。

最小縦切りは、Codex/Copilot 各 fixture で次を機械検証することである。

1. 空または既存ファイルを含むプロダクトへ安全に導入する。
2. プロトタイプ成果物を記録し、本番用 Issue 草案をローカル生成する。
3. production / PR / 再開に必要な状態を表し、`status` と `validate` で検証する。
4. 両 adapter が同じ状態・成果物・承認契約を読む。

Phase 1 では、実 GitHub Issue/PR 作成、マージ、prototype コードの本番昇格、`next` の自律実行、クラウド同期、企業ポリシー収集は実装しない。adapter はそれらの前で停止し、人間へ判断を求める。

2026-09-02 に remote `main` の tree（`6c4219457d7336d14c8c9b02ecdc737a563fdc57`）を REST API で確認した。現行正本は `README.md`、`.github/copilot-instructions.md`、仕様書、計画作成 prompt のみであり、実装コード・ランタイム設定はない。Issue #1 本文とコメントも確認済みで、後発コメントの「計画作成主体を Codex へ変更」が有効である。ローカル `C:\Projects\AI_Development_Workflow` には現在 Git metadata とこれらの未コミット計画関連ファイルがある。実装担当者は着手時に既存ファイルを保持対象として確認し、Issue、仕様、`git status` を再確認すること。

## 2. 技術選択と責務

### 技術選択

- コアは **Python 3.11 以上の標準ライブラリのみ**で実装する。`argparse`、`pathlib`、`json`、`hashlib`、`shutil`、`unittest` を用い、YAML は限定した front matter を自前で扱う。PyYAML、Node、パッケージレジストリ、DB は必須にしない。会社端末の Python 利用可否は preflight で確認する未解決事項である。
- 配布入力は Git 管理された**ローカル master checkout**とする。ネットワーク取得を `setup` の前提にしない。`update` も人間が先に取得した別 checkout を入力にする。
- `gh` / GitHub REST API は、人間が承認した将来の Issue 公開境界にだけ使える抽象として文書化する。Phase 1 は local Markdown 草案を作るだけで、`gh issue create` を実行しない。
- Copilot の必須経路は安定した `.github/instructions/*.instructions.md` とする。prompt files は公開プレビューなので補助機能である。Codex は `AGENTS.md` と skills を認識し得るが、既存 `AGENTS.md` は書換えない。

```text
共通 master (versioned Git: CLI / contract / templates / fixtures)
       │ setup / update: copy only; never upload
       ▼
プロダクト
  .ai-workflow/                    状態、成果物、ローカル記録
  .agents/skills/...               Codex adapter（新規だけ）
  .github/instructions/...         Copilot adapter（新規だけ）
       │ human approval only
       ▼
GitHub CLI / REST API（Phase 1 は呼び出さない）
```

| 境界 | 責務 | 禁止事項 |
| --- | --- | --- |
| 共通 master | バージョン付き契約、CLI、テンプレート、validator、公開可能 fixture。 | 会社固有情報、秘密、実行履歴、詳細ログの受信・保存。 |
| `.ai-workflow/` | project 設定、状態、成果物、残課題、会社内だけの private/execution 記録。 | master への自動 push、telemetry、feedback。 |
| Codex adapter | 最小文脈選択、成果物作成、承認停止を Codex に案内する。 | 既存 `AGENTS.md` の上書き、停止対象の実行。 |
| Copilot adapter | 同じ契約・停止を VS Code Copilot に案内する。 | `copilot-instructions.md` の上書き、preview 機能の必須化。 |

`workflow_contract_version` は `1.0` のようなメジャー契約にする。同一メジャーは後方互換の追加だけを許す。破壊的変更は次メジャー、移行器、移行前確認、人間承認を必須にする。`update --dry-run` は差分だけ、`update --apply --approve-update ID` は未編集生成物だけを更新する。状態、成果物、`private/`、`execution/` は常に update 対象外である。

## 3. 追加・変更ファイル

既存 path との衝突時は作成せず `E_TARGET_EXISTS` を返す。Phase 1 に `--force` は設けない。

| パス | 内容 |
| --- | --- |
| `pyproject.toml` | Python `>=3.11`、`src` layout、console script `ai-workflow`、外部 runtime dependency なし。 |
| `src/ai_workflow/cli.py` | `setup` / `status` / `next` / `validate` / `render-issue-draft` / `update`、JSON と人間向け出力、exit code。 |
| `src/ai_workflow/contracts.py` | version、列挙、状態遷移、禁止パス、exit code の唯一の定義。 |
| `src/ai_workflow/front_matter.py` | 任意 YAML を解釈しない限定 front matter parser/serializer。 |
| `src/ai_workflow/setup_project.py` | 衝突を全件事前検査し、template と manifest を安全に作成。 |
| `src/ai_workflow/load_workflow_state.py` | state を読み、契約 version / 必須キーを検証して返す。 |
| `src/ai_workflow/validate_workflow_state.py` | schema、artifact link、遷移、承認、機密境界、adapter manifest を検証。 |
| `src/ai_workflow/render_issue_draft.py` | prototype handoff から local-only Issue 草案を作成。 |
| `src/ai_workflow/update_distribution.py` | one-way dry-run / approval 済み apply とハッシュ衝突検査。 |
| `src/ai_workflow/advance_workflow_stage.py` | `next` の遷移判定、承認ゲート到達、手動アシスト/自動モードの停止判定。 |
| `src/ai_workflow/rollback_distribution.py` | apply 前に保存した生成ファイルだけを承認付きで復元する。state/artifact/private/execution は触らない。 |
| `src/ai_workflow/transition_history.py` | append-only 遷移履歴、state hash、後退/skip/改ざん検証。 |
| `templates/project/.ai-workflow/config.md` | product、environment、master source / version、GitHub host を保持。 |
| `templates/project/.ai-workflow/workflow-state.md` | 下記 schema の初期 state。セッション間の工程正本。 |
| `templates/project/.ai-workflow/artifacts/README.md` | artifact 命名と front matter 契約。 |
| `templates/project/.ai-workflow/handoffs/README.md` | token 予算付き handoff summary 契約。 |
| `templates/project/.ai-workflow/issue-drafts/.gitkeep` | local Issue 草案出力先。 |
| `templates/project/.ai-workflow/.gitignore` | `execution/`、`private/`、一時ファイルを exclude。state と公開可能成果物は ignore しない。 |
| `templates/adapters/codex/.agents/skills/ai-development-workflow/SKILL.md` | Codex の読む順序、停止、CLI ルール、最小コンテキスト選択。 |
| `templates/adapters/codex/.ai-workflow/adapters/codex/README.md` | skill discovery が使えない時の明示起動、既存 AGENTS.md への人手参照追加例。 |
| `templates/adapters/copilot/.github/instructions/ai-workflow.instructions.md` | `applyTo: "**"`、共通契約、承認停止。必須 adapter。 |
| `templates/adapters/copilot/.github/prompts/ai-workflow-status.prompt.md` | 任意の status 補助 prompt（preview）。 |
| `templates/adapters/copilot/.github/prompts/ai-workflow-prototype.prompt.md` | 任意の prototype / Issue 草案補助 prompt（preview）。 |
| `templates/adapters/copilot/.ai-workflow/adapters/copilot/README.md` | VS Code References に instruction が載る手動確認手順。 |
| `templates/artifacts/prototype-evaluation.md` | prototype 評価テンプレート。 |
| `templates/artifacts/production-handoff.md` | prototype → production 引継ぎテンプレート。 |
| `templates/artifacts/plan-review.md` | production の実装計画レビュー結果テンプレート。計画ID、レビュー指摘、判定、残課題を持つ。 |
| `templates/artifacts/issue-draft.md` | GitHub Issue 本文用 local テンプレート。 |
| `docs/workflow-contract-v1.md` | 人間用の契約、遷移、承認、機密、互換性。 |
| `docs/operations.md` | command 例、preflight、update、UI 確認、停止手順。 |
| `docs/primary-sources.md` | 一次情報 URL、取得日、依存する主張、再確認方法。 |
| `fixtures/codex-project/` | Codex 導入前最小 Git fixture。 |
| `fixtures/copilot-project/` | Copilot 導入前 fixture。既存 `.github/copilot-instructions.md` を含める。 |
| `fixtures/shared-artifacts/` | 有効/無効 state、prototype、handoff、draft の共通 fixture。 |
| `tests/test_setup_project.py` | setup 成功、再実行、衝突、部分変更なし。 |
| `tests/test_status_command.py` | stage/approval/blocker/課題の人間向け・JSON 出力。 |
| `tests/test_validate_workflow_state.py` | schema、遷移、link、機密境界、adapter 差。 |
| `tests/test_render_issue_draft.py` | 必須転記と未承認・機密の拒否。 |
| `tests/test_update_distribution.py` | dry-run、approval、編集済み生成物、単方向性。 |
| `tests/test_next_command.py` | `next` の各 stage、承認停止、manual/automatic mode、冪等性。 |
| `tests/test_transition_history.py` | 遷移履歴の追記、後退、skip、改ざん、再開検証。 |
| `tests/test_front_matter.py` | 限定 grammar の scalar/list/map/list-of-scalar-map 正負テスト。 |
| `tests/test_rollback_distribution.py` | backup 完全性、承認必須、編集済みファイル保護、復元後 validate。 |
| `tests/test_adapters.py` | 両 adapter の契約/停止/context-handoff parity。 |
| `tests/test_cli_end_to_end.py` | 両 fixture の setup → prototype → production → `pr_review` → `merge_pending`（人間停止）→ 再開 → `complete` → validate。実PRは作成しない。 |
| `.github/workflows/test.yml` | Python 3.11/3.12 で unit / integration / packaging を実行。実 network / GitHub を使わない。 |
| `README.md` | 実装済み操作、導入、会社制限、詳細 docs link を追記。 |
| `.github/copilot-instructions.md` | master 自身向けに contract 先読、非上書き、test 必須を追記。 |

## 4. 状態ファイルと状態遷移

`workflow-state.md` は **限定 YAML front matter + Markdown 本文**とする。許容 grammar は top-level の scalar、scalar list、scalar→scalar map、scalar→list of scalar map、および一段 map 内の scalar/list とする。`approvals` と `transition_history` は list of scalar map、`context_budget` と `master_distribution` は一段 map として明示的に許可する。二段以上の任意 map、YAML tag、anchor、任意 object は不許可である。parser/serializer はこの grammar 以外を拒否し、正負 fixture で固定する。

```md
---
workflow_contract_version: "1.0"
workflow_instance_id: "wf-20260902-8c2f"
product_name: "payments-api"
environment_kind: "company-isolated" # personal | company-isolated
current_track: "prototype" # prototype | production
current_stage: "evaluation"
execution_mode: "manual_assist" # automatic | manual_assist
approvals:
  - gate: "prototype_promotion"
    status: "pending" # not_required | pending | approved | rejected
    approved_at: ""
    approved_by: ""
    evidence_artifact_path: ""
  - gate: "prototype_code_reuse"
    status: "pending"
    approved_at: ""
    approved_by: ""
    evidence_artifact_path: ""
blockers:
  - "Confirm company master-read access."
artifact_paths:
  - "artifacts/prototype-evaluation-20260902.md"
  - "handoffs/prototype-to-production-20260902.md"
handoff_summary_path: "handoffs/prototype-to-production-20260902.md"
context_budget:
  maximum_tokens: 12000
  selected_paths:
    - "CONTEXT.md"
    - ".ai-workflow/artifacts/prototype-evaluation-20260902.md"
master_distribution:
  source_id: "local-checkout"
  release_version: "0.1.0"
  template_manifest_sha256: "<64 lower-case hex chars>"
  installed_at: "2026-09-02T10:00:00Z"
transition_history:
  - from_stage: null
    to_stage: "intake"
    transitioned_at: "2026-09-02T10:00:00Z"
    artifact_ids: []
    resulting_state_sha256: "<64 lower-case hex chars>"
    actor: "setup"
---

# Current summary

Prototype evaluation is complete. Promotion needs a human decision.

## Open questions

- Is the approved GitHub host reachable from the company network?
```

必須キーは `workflow_contract_version`、`workflow_instance_id`、`environment_kind`、`current_track`、`current_stage`、`execution_mode`、`approvals`、`artifact_paths`、`context_budget`、`master_distribution`。`company-isolated` では artifact path と handoff path は `.ai-workflow/` 内の相対 path のみ許可し、`execution/`、`private/`、絶対 path、URL は拒否する。

| track | 順序 | stage | 次へ進む条件 | 人間停止 |
| --- | ---: | --- | --- | --- |
| prototype | 1 | `intake` | 課題と利用シナリオを artifact 化 | なし |
| prototype | 2 | `lightweight_grilling` | 仮説、制約、失敗条件を記録 | なし |
| prototype | 3 | `build` | prototype artifact を作成 | なし |
| prototype | 4 | `evaluation` | 評価と handoff を作成 | なし |
| prototype | 5 | `promotion_pending` | local Issue 草案を生成 | **本番移行承認** |
| production | 1 | `requirements_grilling` | requirements artifact がある | **仕様確定承認** |
| production | 2 | `context_and_adr_update` | CONTEXT/ADR 更新、または未存在理由を記録 | なし |
| production | 3 | `implementation_plan` | 計画 artifact がある | なし |
| production | 4 | `plan_review` | 計画レビュー artifact がある | **計画承認** |
| production | 5 | `implementation` | 計画承認済み、テスト可能な変更がある | なし |
| production | 6 | `testing` | 要約済み結果と残課題を記録 | なし |
| production | 7 | `pr_review` | review 草案/結果がある | なし |
| production | 8 | `merge_pending` | 人間の判断材料がある | **マージ承認** |
| production | 9 | `knowledge_update` | ADR/残課題を更新 | なし |
| production | 10 | `complete` | validate 成功 | なし |

validator は未知 stage、後退、未承認のゲート通過を `E_INVALID_TRANSITION` にする。`promotion_pending → production/requirements_grilling` は唯一の許可された track 横断であり、`prototype_promotion` が approved の場合だけ許可する。外部で完了した段階を記録する場合も、対応 artifact と gate approval を人間が記入してから正当な stage に初期化する。CLI は承認状態を自ら変更しない。

各 gate は `gate`、`status`、`approved_at`、`approved_by`、`evidence_artifact_path` を持つ。`prototype_code_reuse` は独立した必須 gate であり、承認なしに prototype のコード path を production artifact が参照したら `E_APPROVAL_REQUIRED` とする。拒否された gate は再承認されるまで進行不可である。`automatic` は安全な次の非承認工程まで進めるだけで、承認 gate を越えない。`manual_assist` は一工程を提案し、同じ state/artifact 契約を使う。

`transition_history` は append-only とし、各イベントに `from_stage`、`to_stage`、`transitioned_at`、`artifact_ids`、`resulting_state_sha256`、`actor` を記録する。hash は front matter を canonical JSON 化し、計算対象イベントの `resulting_state_sha256` を空文字に置換して算出する（serializer はキー順、UTC、改行を固定）。初期化/遷移では値を除外した canonical input を先に作り、hashを設定してから保存し、validator は同じ手順で再計算する。初期化は `from_stage: null`、通常遷移は直前イベントの `to_stage` と現在 stage の一致を必須とする。履歴の削除・並べ替え・hash不一致・skip・後退は `E_INVALID_TRANSITION` とし、外部で完了した段階も同じイベント、artifact、承認の整合性検証を通す。自己参照、改ざん、process restart の正負テストを追加する。

gate registry は `contracts.py` と `docs/workflow-contract-v1.md` の単一契約とし、`prototype_promotion`（promotion_pending→requirements_grilling）、`requirements_finalization`（requirements_grilling→context_and_adr_update）、`plan_approval`（plan_review→implementation）、`merge_approval`（merge_pending→knowledge_update）の対象遷移、必須 evidence、rejected 時の停止を列挙する。adapter と validator はこの registry だけを参照する。

`next` の契約は次のとおりである。

| 入力 | 出力 | 停止/冪等性 |
| --- | --- | --- |
| state、artifact、`execution_mode`、任意 `--max-stages 1` | `from_stage`、`to_stage`、必要 gate、created artifact paths、stop reason、mode、state hash の JSON | pending/rejected gate、矛盾、機密違反で停止。既に gate 到達済みなら state を変えず同じ結果を返す。 |

エラーは `E_NOT_INSTALLED`、`E_STATE_SCHEMA`、`E_INVALID_TRANSITION`、`E_APPROVAL_REQUIRED`、`E_BLOCKED`、`E_SECRET_REFERENCE` とし、`next` 自身は approval や merge を実行しない。自動モードでも `promotion_pending`、仕様確定、計画承認、`merge_pending` の手前で停止する。

## 5. 成果物と prototype → Issue 草案の引継ぎ

全成果物は下記の front matter を必須とし、逐語的 AI 会話ログを保存しない。

```md
---
artifact_contract_version: "1.0"
artifact_id: "prototype-evaluation-20260902"
artifact_type: "prototype_evaluation"
created_at: "2026-09-02T10:10:00Z"
source_artifact_ids: []
classification: "internal" # public | internal | company-confidential
approval_status: "not_required"
context_summary: "Explored recoverable invoice-import validation errors."
---
```

`company-confidential` は `.ai-workflow/private/` にだけ置く。共有 handoff、Issue 草案、master update 入力、fixture から参照・複写してはならない。会社環境では `internal` も既定で非公開とし、利用者が機密確認して抽象化した `public` 相当の情報だけを外部草案に使う。

stageごとの artifact 契約は次で固定する。`intake/lightweight_grilling` は adapter が作る課題・仮説 artifact、`build` は利用者/AIが作る prototype artifact、`evaluation` は adapter が作る評価 artifact、`promotion_pending` は renderer が作る handoff/Issue draft、`requirements_grilling` は利用者が作る requirements artifact、`implementation_plan` は実装者が作る plan artifact、`plan_review` は reviewer が作る `plan-review` artifact、`implementation` は実装差分の参照、`testing` は要約結果、`pr_review` はレビュー結果、`merge_pending` は承認判断材料、`knowledge_update` は ADR/残課題更新である。各遷移は必要 artifact の存在・単一候補選択・schema検証に成功してから、temp state を atomic rename で確定する。不足は `E_ARTIFACT_MISSING`、複数候補は `E_ARTIFACT_AMBIGUOUS`、I/O failure は stateを変更せず journal/diagnostic を残す。fixture helper は指定 artifact を投入し、automatic は次の gate 前、manual_assist は一工程ごとの期待 state sequence を検証する。

`prototype-evaluation-<date>.md` の必須見出しは `Problem`、`Hypothesis`、`Prototype boundary`、`Scenarios evaluated`、`Observed outcomes`、`Accepted options`、`Rejected options and reasons`、`Reusable assets`、`Known limitations`、`Security and data classification`、`Recommendation`。詳細ログ、顧客データ、内部 URL、トークンを入れない。

`prototype-to-production-<date>.md` は source に評価 artifact ID を持ち、次を含む。

```md
## Production handoff summary

- User problem: Invoice import needs recoverable validation errors.
- Evidence: Three synthetic fixtures exercised expected retry choices.
- Recommended scope: Return typed validation failures at the import boundary.
- Explicitly excluded: Production credentials, customer records, automatic retry.

## Candidate production issue

### Proposed title
Return typed validation failures from invoice import

### Acceptance criteria
- [ ] Invalid rows produce a stable error category.
- [ ] Retry eligibility is visible to the caller.

### Decisions to re-grill
- Retry ownership and idempotency-key lifetime.

### Approval gate
Human approval is required before creating a production issue or reusing prototype code.
```

`render-issue-draft --from <handoff>` は `.ai-workflow/issue-drafts/<artifact-id>.md` を作る。必須節は `Source artifacts`、`Background`、`Problem statement`、`Proposed scope`、`Non-goals`、`Evidence`、`Acceptance criteria`、`Open questions`、`Security classification confirmation`、`Human approvals required`。classification は source graph の全 artifact の中で最も機密な値を継承し、`company-confidential` が一つでもあれば renderer は `E_CLASSIFICATION_FORBIDDEN` とする。公開可能に昇格する場合は、利用者、確認日時、確認対象 source IDs、公開先、内部情報を除いた要約であることを記す `classification_review` を必須にする。source artifact ID の存在・循環・到達可能性は validator が検査する。草案には必ず「未承認・GitHub 未送信」と明記する。production への遷移は、人間が `prototype_promotion` を `approved` とし日時を記入した後だけ許す。prototype code reuse は別の `prototype_code_reuse` 承認を要し、既定 false である。

### 配布 manifest と部分導入 journal

`.ai-workflow/distribution-manifest.json` は `manifest_version`、`master_release_version`、`contract_version`、`files`（各 `relative_path`、`sha256`、`source_template`、`mutable`）、`installed_at`、`source_id` を持つ。`files` に列挙するのは adapter と生成 template だけで、state/artifact/private/execution は含めない。`update --dry-run` の結果は `.ai-workflow/update-plans/<update-id>.json` に保存し、`update_id` は旧 manifest hash、新 master manifest hash、contract version を canonical JSON 化して SHA-256 した値とする。apply 時は入力を再計算し、ID不一致、master hash 不一致、対象ファイルの現在 hash 不一致、contract major 不一致、24時間超過を `E_UPDATE_STALE` にする。承認済み update plan は適用後に削除せず `status: applied` と適用時刻を記録する。apply の backup は `.ai-workflow/update-backups/<update-id>/manifest.json` と同ディレクトリの `files/<relative_path>` に保存する。backup manifest は `update_id`、作成時刻、各相対パス、更新前 SHA-256、更新後 SHA-256、元の存在有無を持つ。rollback は現在のファイルが更新後 hash のままのものだけを復元し、人手編集、欠落、backup 不整合は `E_UPDATE_CONFLICT` として全件事前停止する。backup と update plan は削除せず、復元済み状態を記録し、同じ承認 ID の再実行は no-op とする。

導入途中の `.ai-workflow/install-journal.json` は `journal_version`、`install_id`、`master_release_version`、`adapter`、`planned_files`（path/hash/status）、`started_at`、`completed_at`、`status`（in_progress/completed/failed/manual_recovery_required）を持つ。setup は次回起動時に `in_progress` / `failed` を検出し、同一 install 内容なら再開候補、異なる内容や未知の残存ファイルなら中止して `E_PARTIAL_INSTALL_RECOVERY` とする。自動削除・上書きはせず、人間が journal と各 file hash を確認して `manual_recovery_required` を `recovered` と記録した後、`validate` を通過させる。I/O failure、再開、衝突、中止、復旧後 validation をテストする。

`recovered` は install journal の正式な終端 status とし、`recovered_by`、`recovered_at`、`recovered_file_hashes` を必須にする。`in_progress` / `failed` は setup を再開候補または recovery-required とし、`manual_recovery_required` は人間確認なしの setup を拒否し、`recovered` は hash 一致後の validate と no-op 再実行だけを許可する。

manifest の files は `common_immutable`（共有 adapter/template、master hash と一致必須）、`adapter_immutable`（Codex/Copilot固有、対応 adapterだけが所有）、`project_mutable`（config等の利用者所有で update/rollback対象外）の三分類とする。state/artifacts/private/execution は完全除外する。初回 `codex`、初回 `copilot`、`both`、既存 adapter への追加は共有集合を一度だけ作り、manifest を安全にマージする。既存 mutable の hash 差は `E_UPDATE_CONFLICT` とし上書きせず、adapter追加・個別update・rollbackを各fixtureで検証する。

## 6. CLI 契約

全 command は `--project-root PATH`（既定 current directory）を持つ。人間向け出力は stdout、`--format json` は JSON object、診断は stderr。成功 0、入力不正 2、state/validation 3、既存ファイル衝突 4、承認不足 5、環境/外部 tool 不足 6 とする。

| command | 入力 | 成功出力 | 主なエラー | 冪等性 |
| --- | --- | --- | --- | --- |
| `setup --master-root PATH --adapter codex|copilot|both [--environment-kind ...]` | project root、存在する master、adapter、任意環境種別。 | 作成一覧、manifest hash、初期 stage、次の人手手順。 | `E_PROJECT_NOT_GIT`、`E_MASTER_INVALID`、`E_TARGET_EXISTS`、`E_ADAPTER_CONFLICT`、`E_PARTIAL_INSTALL_RECOVERY`。 | 同一 manifest/content は `already_installed` で無変更。差分/既存物があれば一切書かない。 |
| `status [--format json]` | 有効な state。 | track/stage、approvals、blocker、課題、次の安全操作、artifact。 | `E_NOT_INSTALLED`、`E_STATE_PARSE`、`E_STATE_SCHEMA`。 | read-only。 |
| `next [--mode automatic|manual_assist] [--max-stages N] [--format json]` | state、artifact、mode。 | from/to stage、gate、stop reason、created paths、state hash。 | `E_INVALID_TRANSITION`、`E_APPROVAL_REQUIRED`、`E_BLOCKED`、`E_SECRET_REFERENCE`。 | gate 到達済みなら無変更で同じ結果。承認・merge・破壊操作はしない。 |
| `validate [--strict] [--format json]` | state、artifact、adapter manifest、任意 host 設定。 | error/warning、検査数、contract/master version、`valid`。 | `E_INVALID_TRANSITION`、`E_ARTIFACT_MISSING`、`E_ARTIFACT_SCHEMA`、`E_SECRET_REFERENCE`、`E_COMPATIBILITY`。 | read-only。`--strict` は warning を失敗にするだけ。 |
| `render-issue-draft --from PATH` | 公開可能かつ完全な handoff、未存在出力。 | 草案 path、source IDs、`publication_status: local_draft_only`。 | `E_CLASSIFICATION_FORBIDDEN`、`E_HANDOFF_INCOMPLETE`、`E_TARGET_EXISTS`。 | 同じ出力は無変更、異なる出力は上書きせず衝突。 |
| `update --master-root PATH --dry-run` | 導入 manifest と新 master。 | add/change 候補、互換性、編集検出、update ID、保存した preview plan。 | `E_UPDATE_CONFLICT`、`E_MAJOR_MIGRATION_REQUIRED`、`E_PLAN_WRITE_FAILED`。 | project files は不変。preview plan の同一内容再保存は no-op。plan 保存失敗時も project files は不変。 |
| `update --master-root PATH --apply --approve-update ID` | dry-run と一致する ID。 | 更新生成物、backup path、再検証結果。 | `E_APPROVAL_REQUIRED`、`E_UPDATE_STALE`、`E_UPDATE_CONFLICT`。 | 同じ release は無変更。state/artifact/private/execution は常に対象外。 |
| `rollback --update-id ID --approve-rollback ID` | `applied` update plan と未編集 backup。 | 復元一覧、復元後 manifest、validate 結果。 | `E_APPROVAL_REQUIRED`、`E_UPDATE_NOT_APPLIED`、`E_UPDATE_CONFLICT`。 | 既に復元済みなら無変更。同一 backup を二重適用しない。 |

`setup` は temp directory に全 template を描画し、全 target の存在・hash・書込可否を確認してから新規ファイルを作る。途中 I/O 失敗なら `install-journal.json` に完了分だけ記録し、自動削除せず修復手順を表示する。これにより既存ファイルを無断で置換しない。

## 7. adapter、fixture、テスト

両 adapter は最初に `workflow-state.md`、`config.md`、指定 handoff、必要最小のプロダクト文脈（`CONTEXT.md`、ADR、対象 Issue）だけを読む。`context_budget.maximum_tokens` 内の path を選び、工程終了時には 300 token 以下の handoff summary を artifact に残す。長いログ、会話全履歴、会社内テスト出力を context に含めない。

停止時は state に理由を残し、`approve requirements`、`approve prototype promotion`、`approve prototype code reuse`、`approve plan`、`approve merge`、`resolve policy conflict`、`confirm security classification` のいずれかを利用者に求める。adapter は approval 値を自ら書かない。

| 差異 | Codex | Copilot |
| --- | --- | --- |
| 配置 | `.agents/skills/ai-development-workflow/SKILL.md` と `.ai-workflow/adapters/codex/` | `.github/instructions/ai-workflow.instructions.md` と任意 `.github/prompts/` |
| 起動 | skill が発見できない環境では README の明示 prompt。利用可否を fixture 外で断定しない。 | VS Code Chat の References に instruction が出ることを人が確認。 |
| 既存設定 | AGENTS.md を既存時に編集せず、人間承認の参照追加例だけ示す。 | 既存 `copilot-instructions.md` を変更しない。 |
| 共通性 | CLI、state、artifact、approval、context/handoff は完全に Copilot と同一。 | 同左。 |

fixture はともに `README.md`、`CONTEXT.md`、最小 Python sample、テスト内で初期化する Git repository を含む。Copilot fixture は既存 `.github/copilot-instructions.md` も持ち、setup の前後で content hash が変わらないことを確認する。共通 artifact fixture は次を含む。

- 有効な prototype evaluation / production handoff / local Issue draft。
- `pending`、`approved`、`rejected` promotion と全 production stage、`merge_pending`。
- 壊れた front matter、存在しない artifact、`private/` 参照、秘密らしい `ghp_` / `AKIA` pattern、編集済み template、`execution/` を含む update 負例。
- source artifact の欠落、循環、機密分類の継承、利用者/日時/source IDs がない公開昇格の負例。
- `next` の automatic/manual_assist、各 gate 前停止、track 横断、I/O failure 後の journal recovery、update apply/rollback の負例。

| レイヤー | 検証内容 |
| --- | --- |
| unit | parser、遷移、path classification、hash、Issue renderer。例: `test_validate_rejects_company_private_artifact_referenced_by_public_handoff`。 |
| integration | temp fixture で setup、再実行、artifact 配置、status JSON、next、validate、別 process による state 再読込、update dry-run/apply/rollback。 |
| contract/parity | 両 adapter が同じ contract version、state path、approval 語、機密禁止リストを持つことを構造検査。 |
| manual UI | Codex skill の discovery、VS Code Copilot References の instruction 表示を release ごとに人が確認。会社端末のみの確認は CI 成功条件に混ぜない。 |
| CI | `python -m unittest discover -s tests -v`、`python -m compileall src`、packaging check、template/link check。network、認証、実 Issue 作成はしない。 |

## 8. 品質と実装規約

- `code-naming` を適用する。I/O 名は `load_workflow_state`、`render_issue_draft`、`apply_distribution_update` のように操作を表す。新規 `get_*`、`check_*`、`*Manager`、曖昧な `data`/`result` を避ける。真偽値は `is_*` / `has_*` / `can_*` とする。
- `code-comments` を適用する。コードは How、テスト名は What、commit/PR は Why、コメントは Why not のみを書く。非上書きの理由など、読んだだけでは分からない安全分岐には Issue #1 / 仕様への短い参照コメントを置く。変更履歴、コードの言換え、コメントアウトコードは置かない。
- commit 表題例は `Add versioned workflow state contract`。本文/PR は「会社環境への非流出と再開可能性のため」という Why、Issue #1、互換性、テスト、未実施の会社環境検証を記す。
- `validate` は秘密値本文を出力しない。path と規則名のみを示す。
- Markdown 例、adapter 指示、CLI JSON をテスト入力にして文書と実装の乖離を検出する。

## 9. 一次情報と会社環境の preflight

実装直前に URL、取得日、依存する主張を `docs/primary-sources.md` に記録して再確認する。

| 対象 | 一次情報 | 利用 / 確認 |
| --- | --- | --- |
| Issue CLI | [GitHub Docs: Creating an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue) | `gh issue create --title --body` は将来の承認後境界だけ。実行前に人が `gh auth status --hostname <host>`。 |
| REST Issues | [GitHub Docs: REST API endpoints for issues](https://docs.github.com/en/rest/issues) | GitHub.com / Enterprise host と API version を明示。Phase 1 は call しない。 |
| Copilot support | [GitHub Docs: Support for custom instructions](https://docs.github.com/en/copilot/reference/custom-instructions-support) | VS Code の repository/path/agent instruction 対応の根拠。 |
| Copilot instructions | [GitHub Docs: Adding repository instructions in VS Code](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide?tool=vscode) | `.instructions.md`、`.prompt.md`、References 手動確認の根拠。prompt は preview。 |
| Codex | [OpenAI Docs: Codex CLI](https://learn.chatgpt.com/ja-JP/docs/codex/cli) | `/init` と AGENTS.md、skills、permissions、resume の確認根拠。 |
| Python | [Python 3.11 documentation](https://docs.python.org/3.11/) | 標準ライブラリのみを core にする根拠。 |

会社環境 preflight は、認証/接続設定を変えず、`python --version`、`git --version`、`gh --version`、`gh auth status --hostname <company-host>` の成否（token 非表示）、master checkout 読取可否、VS Code/Copilot extension version、References 表示可否を `.ai-workflow/private/company-preflight-<date>.md` に保存する。自動送信しない。

会社から master を読めない場合は、人手による一方向配布を行う。個人環境で承認済み release の hash/署名一覧を作り、承認済み媒体または社内 Git mirror で read-only copy を渡す。会社側は `setup --master-root <approved-local-copy>` を実行し、`source_id: "company-approved-copy"` と hash を記録する。copy / hash 照合 / セキュリティ承認のいずれかが欠ければ `E_MASTER_UNAVAILABLE` で停止し、推測や手作業で contract を再作成しない。会社側 feedback は、利用者が機密確認して抽象化したものを手入力するまで master に反映しない。

## 10. 実施順序

1. clone 後に Issue、コメント、仕様、既存ファイルを再読し、作業 tree を確認する。
2. `pyproject.toml`、contract、front matter、state transition、`next` の mode/gate 判定と unit test を先に追加する。
3. setup を全衝突事前検査・manifest・再実行 test とともに実装する。既存 AGENTS / Copilot instructions を fixture で守る。
4. status / validate と、全 stage、approval、secret 境界、不正遷移の負例を実装する。
5. prototype evaluation、handoff、local Issue renderer を実装し、未承認なら production / publication を失敗させる。
6. Codex/Copilot template、parity test、各 UI の手動確認手順を追加する。会社 UI で未確認なら未解決タスクとして記録する。
7. scoped update と one-way / dry-run / approval / user-edit 保護 test を追加する。
8. CI、README、operations、primary source list を完成し、strict validate と両 fixture E2E を実行する。
9. 人間が仕様、実装計画、PR、会社導入・本番移行を承認するまで、Issue 作成、merge、破壊操作を実行しない。

## 11. 受け入れ条件対応表

| 要件 | 実装対象 | 検証 |
| --- | --- | --- |
| 共通成果物形式と状態 | `contracts.py`、templates、§4/§5 | schema unit test、strict validate。 |
| setup/status/validate | `cli.py` と command modules | unit、JSON contract、fixture integration。 |
| next と mode | `advance_workflow_stage.py`、state `execution_mode` | automatic/manual_assist、各 gate 前停止、許可された track 横断、冪等性。 |
| 計画レビュー独立工程 | `plan_review`、`plan-review.md`、transition history | implementation_plan→plan_review→implementation、計画承認 gate、未レビュー停止、再開。 |
| prototype → Issue 草案 | renderer と handoff templates | 必須節転記、機密拒否、local-only test。 |
| Codex adapter | Codex template、parity test | fixture install、停止条件検査、手動 discovery。 |
| Copilot adapter | instruction / optional prompts | 既存 file 保存、構造 test、References 手動確認。 |
| 双方 fixture | `fixtures/*`、E2E | setup→prototype→production→`pr_review`→`merge_pending`→再開→`complete`→validate。実PRは作成しない。 |
| 導入/更新/検証/遷移 test | `tests/test_*` | CI と local unittest。 |
| error contract | `contracts.py`、CLI diagnostics | 全 `E_*` code、category、exit code、JSON shape の一致。 |
| flow 分離・プロダクト内完結 | state transition / local paths | track 混在、外部 URL / upload 不許可 test。 |
| 承認必須 | approval state、adapter、update | promotion/plan/merge/update の承認不足 test。 |
| 機密・単方向 | gitignore、validator、update | private/execution 拒否、master write API 不存在、編集保護。 |
| 移行・ロールバック | manifest/update-plan、backup、rollback module | stale ID、編集衝突、承認不足、復元後 validate、同一 rollback 冪等性。 |
| token と再開 | context_budget、handoff、status | 300 token summary、selected path、fresh process reload。 |

## 12. 3 回の自己レビュー

### Review 1: 必須成果物と遷移

Issue の Phase 1 項目を §11 に全件対応付け、仕様の prototype / production 全工程を §4 に含めた。改善として、local-only Issue 草案、prototype code reuse の別承認、session restart E2E を明文化した。

### Review 2: 権限、機密、更新

会社ログ、実行履歴、ポリシーが master に戻らないか、setup/update が既存ファイルを守るか、GitHub API を呼ばないかを確認した。改善として、company-isolated path 制限、秘密を表示しない診断、master 到達不能時の hash 照合済み手渡し配布と停止条件を加えた。

### Review 3: adapter 差、テスト、token

Copilot prompt files が preview、Codex skill discovery が実環境依存である点を必須機構から分離した。改善として、両 adapter parity test、Codex/Copilot UI 手動確認、300 token handoff、context selected path、CI の network 非依存を追加した。

### Independent review round 1: 採否と反映

判定は `NEEDS_WORK`。R1（`next` と mode の欠落）、R2（track 横断と複数 approval の矛盾）、R3（update plan の実体不足）、R4（install journal の復旧契約不足）、R5（現行ローカル構成の記述誤り）、R6（classification confirmation と artifact graph の不足）はすべて採用し、本計画の §3〜§7、§11 に反映した。R7（同一 Issue 草案は無変更、異なる内容は衝突）も採用し、CLI 表に同一内容の no-op と異なる内容の `E_TARGET_EXISTS` を明記した。Issue/仕様本文全体、Codex discovery、Copilot References、会社環境の可否は、独立レビューの未確認事項として維持する。

### Independent review round 2: 採否と反映

判定は `NEEDS_WORK`。R1（`plan_review` 独立工程）、R2（transition history）、R3（stage別 artifact contract と atomic state mutation）、R4（`recovered` journal）、R5（manifest ownership と mutable/immutable 分類）、R6（error catalog と JSON diagnostics）はすべて採用し、§3〜§7、§11 に反映した。詳細は `work/plan-reviews/issue1-phase1/round-2-review.md` に記録する。会社環境、UI、外部 Issue/PR の未確認事項は維持する。

### Independent review round 3: BLOCKED

新規 reviewer を起動し callback 返却経路を指定したが、`clientThreadId=client-new-thread:3c7cf00c-4cb0-45b0-ae77-32c749b0256e` から通常の thread ID・完了状態・結果を確認できなかった。round 3 は `work/plan-reviews/issue1-phase1/round-3-review.md` に `BLOCKED` として記録し、計画を承認扱いにしない。

## 13. 未解決事項と開始可否

未解決事項は、会社環境から master checkout / GitHub host を読めるか、`gh` 認証と Enterprise API 差、Python 3.11+、VS Code Copilot の instruction/prompt/custom agent 有効性、会社内詳細結果をどこまで安全に抽象化できるかである。これらは仕様上も未検証であり、§9 の実環境 preflight として残す。推測で有効化しない。

**共通 master の Phase 1 実装は開始可能**である。core は Python 標準ライブラリ、local master、local artifact だけで完結し、会社依存事項を preflight / 手動 UI 検証に隔離しているためである。ただし会社への配布、GitHub Issue 公開、本番移行、merge は、preflight と人間の明示承認がそろうまで開始してはならない。
