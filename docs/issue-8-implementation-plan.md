# Issue #8 実装計画

対象: プロジェクト・オーケストレーターと並行Codex実行タスクの導入

## 前提

- Workspace: `AI Development Workflow`
- Branch: `codex/onboard-existing-project`
- HEAD: `410037f`
- 作業ツリーは dirty。既存の `docs/issue2-chatgpt-conversation-adapter.md` の変更、`work/e2e-github-master/`、`work/e2e-github-product/`、Issue #8 草案は実装へ混入させない。
- Issue #8 のremote本文は現在のconnectorから再取得できないため、承認済み仕様と `docs/issue-orchestrator-child-tasks-and-parallel-execution-draft.md` を入力とする。remote Issue identityを推測して生成・変更しない。

## 実装方針

### 第2ラウンドレビューを受けた追加補正

- Python/Nodeの入口は相互再帰させない。専用の内部bridge protocol（JSON request/response、固定exit code、protocol version、idempotency key）で接続し、Project/Workspace/C2C/GitHub preflightはPython onboarding、child lifecycleはNode、Issue #4のprepare/approve/publish/retryはPython gateway、状態書込みは各責務のgateway経由に固定する。runtime不在・部分失敗・再実行をbridge E2Eで検証する。
- prototypeもprototype manifestからschedulerへ入り、childの実装・テスト・Codexローカルレビュー・評価成果物を経て親が統合し、unit/統合評価を実施する。評価結果をpromotion判断へbindingし、失敗unitのfix/retryと最終統合評価を含む。
- `accept revised scope` は承認済み仕様内のexecution manifest補正に限定する。`scope_change` / `constraint_change` はIssue #4 change-controlへ委譲し、再Grilling・仕様/Issue/plan version更新・旧成果物の無効化・再承認を完了するまでchildを再開しない。
- generationはfencing tokenとして扱う。successor activationはactive generationのCAS、旧世代は`SUPERSEDED`、親state mutation/child start/cancel/integration/result ingestionは直前にactive generationを再検証し、旧世代の副作用を拒否する。
- child完了にはCodexローカルレビューのreviewer/run、対象revision、findings、blocking count、dispositionを必須化し、テスト成功かつlocal review合格のみintegration eligibleとする。
- migrationの`canMigrate(state)`を決定的predicateとして定義する。active child、STARTING/RUNNING/INTEGRATING、未完了review、pending approval/decision、曖昧なC2C delivery、未解決migration/change-controlをblockerとし、全blockerなしのpositive caseだけをsafe stopとする。
- scope overrunではdigestだけでなく、変更パス、reviewable diff/hunkまたは差分参照、宣言scope、検出内容、理由をreview artifactとして提示し、presentation id/revision/digestをdecisionへbindingする。

### 第3ラウンドレビューを受けた追加補正

- Python managed installationで配布される実体を正本とする。`.ai-workflow/managed/execution-plan.schema.json`、`.ai-workflow/managed/child-task-result.schema.json`、`.ai-workflow/managed/templates/project-config.json`をmanaged manifestへ登録し、master側schema/templateからの同期検証を行う。source→destination mappingを採用する場合は`src/ai_workflow/git_source.py`と対応テストも変更範囲に含める。fresh GitHub-source installationで新schema/configを使ってmanifest検証できることを受入条件にする。
- prototype designの最終reviewed成果物とmanifestは、productionと同じArtifactPresenter経由でpresentation receiptを作り、`presentation_id`、digest、canonical revision、work identity、approved manifest digestへbindingする。提示成功前はapproval actionを出さず、prototype execution開始直前に再検証する。
- `prompts/c2c-production-planning.md`、`prompts/c2c-prototype-design.md`、independent review/refinement prompt、対応Skillsと`.ai-workflow/managed/prompts/...` / managed Skills copyを変更範囲に含める。prototype固有manifest項目、DAG、3-round review、review disposition、production planのstructured manifestを各prompt契約に明記する。
- 最終検証マトリクスに、superseded generationのstate/child start/cancel/integration/result拒否、prototype child実装→local review→evaluation→integration→promotion gate、missing/stale/blocking local review拒否、`canMigrate`各blockerと唯一のpositive safe-stopを名前付きテストとして追加する。

### 0. 第1ラウンドレビューを受けた計画補正

第1ラウンドの独立レビューで、Critical 1件、High 5件、Medium 3件が検出された。実装開始前に以下を計画へ追加し、各項目を仕様・テスト・受入条件へ反映する。

- Issue #4 の `.codex/workflow-state.json` と Issue guard/state machineをIssue作成・更新の唯一の公開境界として再利用する。Node側から未承認のGitHub writeを直接呼ばない。親stateとの責務分担、digest/hash、stale、重複、remote変更、部分失敗の再試行を正式仕様化する。
- Python `ai-workflow` を採用運用経路として扱い、成功した導入後に同じidempotent lifecycle-startを呼ぶ。Node経路との二重起動を禁止し、再実行・失敗時の起動数をテストする。
- child実行前に、worktree/cwd、書込みパス、認証情報・環境、Git操作、GitHub publish/merge、親stateへのアクセスを能力として制限する。事後diff検証は防御の追加層とする。
- prototype manifestは `hypothesis`、`success_criteria`、`failure_criteria`、`evaluation_method` を必須化する。production manifestとの共通項目とstage固有項目をschemaで表す。
- 最終統合後のPRレビューを `PR draft → ChatGPT review → blocking findingのfix unit → 親統合 → 影響テスト/全体テスト → PR再生成 → 再レビュー` として明示する。HEAD変更時は古いレビュー、提示済み成果物、公開承認を無効化する。
- `HUMAN_WAITING` からの再開を、判断対象・unit/run・generation・base revision・diff/result digest・blocker identityに結び付くdurable decision recordとして定義する。仕様競合、範囲超過、分類不能failure、migration判断を対象にする。
- child起動と統合に `STARTING` / `RUNNING` / `INTEGRATING` 等の遷移状態、operation identity、再調整手順を設け、外部操作とstate更新の間でクラッシュしても重複起動・二重統合しない。
- ChatGPTのmodel policyは役割ごとにversioned `required_model` または `required_model_class` を保持し、最高性能の選択可能な推論モデルを既定とする。UIで実際に選択されたmodelをユーザー確認し、代替時は承認記録を残す。
- status/presentationにはunitごとのresult artifact、テスト証跡、worktree/commit、revision/digestを安全な相対パスで含める。

### 1. 正式仕様・状態モデル

追加:

- `docs/issue-8-formal-spec.md`
- `schemas/execution-plan.schema.json`
- `schemas/child-task-result.schema.json`

変更:

- `docs/ai-development-workflow-package-spec.md`
- `src/model.js`
- `src/state-store.js`
- `src/validation.js`
- `schemas/workflow-state.schema.json`
- `schemas/workflow-config.schema.json`

外側のworkflow stageと内側のwork-unit execution stateを分離する。親オーケストレーターは実行計画・child・統合の正本とし、Issueの公開可能性と承認状態は既存Issue #4の `.codex/workflow-state.json` とguardを唯一の正本とする。両者をdigest・generation・decision identityで結び、片方だけが進んだ状態はfail-closedにする。状態には次を持たせる。

- orchestratorのlogical id、generation、状態、後継リンク、開始・復旧時刻
- 承認済みexecution manifest digest、統合branch/base、work-unit DAG
- work unitのid、目的、依存、変更範囲、受入条件、単体テスト、統合条件
- child runのrun id、attempt、successor、worktree、branch、固定base、状態、commit、テスト、成果物、blocker
- integration順、統合commit、各段階テスト、最終テスト、ChatGPT model確認

childは親stateを直接変更せず、run単位の結果成果物をatomic writeする。親だけが検証して取り込む。migrationは決定的・冪等・fail-closedとし、安全な停止点で人間承認付きで行う。

### 2. onboarding後のorchestrator lifecycle

変更: `src/onboarding.js`, `src/cli.js`, `src/ai_workflow/onboarding.py`, `src/ai_workflow/cli.py`

追加: `src/orchestrator-lifecycle.js`

Project、Workspace、C2C、GitHub認証、managed installation、state validationがすべて成功した後、Python/Nodeいずれの入口からも共通のidempotent lifecycle-startを呼び、project専用orchestratorを一意に開始または再利用する。二重起動を禁止し、容量不足・継続不能時はgenerationを上げてstate、未完了unit、会話bindingを後継へhandoffする。stale timeoutだけで旧instanceを奪わない。

### 3. ChatGPT工程とレビュー契約

変更: `src/conversation-runner.js`, `src/orchestrator.js`, `src/model.js`, `src/workflow.js`, `workflow/workflow.json`

工程開始前に対象会話・必要model・人間の完了回答・model名をstateへ記録する。model未確認ではprototype design、production plan、reviewを開始しない。暗黙fallbackは禁止し、代替は人間承認とする。Issueごと、stage/roleごとの会話分離を維持する。

prototype designにもproduction planと同じ独立レビュー契約を適用する。design → dedicated review → improvementを最低3 qualifying rounds実施し、Critical/High解消後だけprototype実装承認へ進む。production planと共通review-loop helperを使い、計画会話とレビュー会話を分離し、同じレビュー会話をラウンド間で継続する。

### 4. execution manifest

ChatGPTの計画は各unitについて、unit id、目的、dependency IDs、変更範囲・想定ファイル、受入条件、単体テスト、統合条件を必須にする。prototype unitでは加えて `hypothesis`、`success_criteria`、`failure_criteria`、`evaluation_method` を必須にする。1 unitも許可する。DAG循環、未知dependency、重複id、範囲不明は承認前に拒否し、scopeが重複または判定不能なparallel候補は直列化する。人間向けplanとscheduler用manifestを同一approval digestへbindingする。

### 5. child task、scheduler、worktree

追加:

- `src/child-task-runner.js`
- `src/task-scheduler.js`
- `src/worktree-manager.js`
- `src/adapters/git.js`

変更: `src/adapters/codex.js`, `src/orchestrator.js`, `templates/project-config.json`, `schemas/workflow-config.schema.json`

adapterはcapabilities、start、status、cancel、structured completion resultを表現する。child起動時に専用worktree/cwd、書込み可能パス、親state拒否、GitHub/publish/merge能力除去、認証情報・環境の最小化、許可Git操作を実行境界として適用する。childには専用worktree内の編集・テスト・local commitだけを許可し、GitHub publish/merge、integration branch変更、親state変更を禁止する。事後のdiff/result検証は防御の追加層とし、`max_parallel_codex_tasks` の初期値は3。

unitごとに専用branch/worktreeを割り当て、起動時のintegration HEADをimmutable `base_revision`として保存する。依存unitはdependency統合後のHEADから作る。worktreeは設定root配下だけを許可し、path traversal、別repo、base lineage外commit、別branch、scope外変更を拒否する。schedulerは依存統合済み・scope conflictなし・slotありのunitだけを起動する。

### 6. 親だけが統合しPRをgateする

追加: `src/integration-manager.js`

変更: `src/orchestrator.js`, `src/approvals.js`, 必要に応じて `schemas/approval.schema.json`

親がintegration branchへunitを承認済みtopological orderで直列統合し、各取り込み後にunit統合テスト、全unit後にfinal integration suiteを実行する。全unit統合と最終テスト成功なしに `production_pr_draft` へ遷移できない。既存の無条件 `implementationComplete()` はこのgateを通す。

child PRは作らず、統合済み成果物からGitHub PRを1本だけ作る。Issue作成・更新を含むGitHub writeは既存Issue #4のguard/state machineを通し、親オーケストレーターから未承認の直接writeを行わない。artifact presentation、stale approval再検証、承認前停止を維持する。merge後のworktree/branch cleanupはrevisionにbindingした人間承認後だけ行う。

統合後のPRレビューは、最終統合revisionを提示してChatGPTがレビューし、Critical/High等のblocking findingをfix unitへ変換する。fix unitは通常unitと同じchild制限・親統合・テストを通し、integration HEADが変わったら以前のレビュー・提示・公開承認を破棄してPRを再生成し、同じ段階のレビュー会話で再レビューする。

### 7. 失敗・範囲外変更・manual fallback

- recoverable failureは同一childを最大2回再試行（初回込み最大3 attempts）。
- retry枯渇・runner継続不能時はsuccessor childへhandoffし、旧結果・blocker・worktreeを保持する。
- failed unitのdependentsだけBLOCKEDにし、独立unitは継続可能にする。
- 仕様・設計判断が必要、分類不能なfailure、API/受入条件/仕様変更を伴う競合はHUMAN_WAITING。再開にはdecision recordを要求し、unit/run、generation、base revision、関連diff/result digest、blocker identityと、accept revised scope / reject-and-retry / cancel等の判断を記録する。staleな判断は拒否する。
- cancelは対象とdependentsを停止し、branch/worktree/artifactを保持する。
- scope外commitはdiff digestと理由を提示して統合保留。純粋な機械的競合だけ自動解消する。
- child起動capabilityがない場合、orchestratorは実装を代行せず、unitごとのworktree、prompt、base、受入条件を `manual_start_required` として提示し、人間が起動後に同じrun identityへbindingする。

### 8. CLI・managed distribution

変更: `src/cli.js`, `.ai-workflow/managed-manifest.json`, `templates/project-config.json`

`status`はgeneration、running slots、unit state、dependencies、attempts、integration queue、blocker、manual-start actionに加え、unitごとのresult artifact、test evidence、worktree/commit、revision/digestを表示する。model確認、manual binding、cancel、cleanup approval、HUMAN_WAITINGのdecision/resumeはdurable command/APIで扱う。managed schema/templateを同期し、Python onboardingはmanifest-drivenのまま共通lifecycle-startを呼ぶ。

## 変更ファイル

追加: `docs/issue-8-formal-spec.md`, `src/orchestrator-lifecycle.js`, `src/task-scheduler.js`, `src/child-task-runner.js`, `src/worktree-manager.js`, `src/integration-manager.js`, `src/adapters/git.js`, `schemas/execution-plan.schema.json`, `schemas/child-task-result.schema.json`, `.ai-workflow/managed/execution-plan.schema.json`, `.ai-workflow/managed/child-task-result.schema.json`, `test/task-scheduler.test.js`, `test/child-task-runner.test.js`, `test/worktree-manager.test.js`, `test/integration-manager.test.js`

変更: `docs/ai-development-workflow-package-spec.md`, `src/model.js`, `src/state-store.js`, `src/validation.js`, `src/workflow.js`, `src/orchestrator.js`, `src/onboarding.js`, `src/ai_workflow/onboarding.py`, `src/ai_workflow/cli.py`, `src/conversation-runner.js`, `src/adapters/codex.js`, `src/approvals.js`, `src/cli.js`, `src/ai_workflow/issue_guard.py`, `src/ai_workflow/issue_state.py`, `src/ai_workflow/change_control.py`, `workflow/workflow.json`, `schemas/workflow-state.schema.json`, `schemas/workflow-config.schema.json`, `schemas/approval.schema.json`, `templates/project-config.json`, `.ai-workflow/managed/templates/project-config.json`, `.ai-workflow/managed-manifest.json`, `prompts/c2c-production-planning.md`, `prompts/c2c-prototype-design.md`, `prompts/c2c-production-plan-refinement.md`, `prompts/c2c-independent-plan-review.md`, `prompts/c2c-pr-review.md`, `.ai-workflow/managed/prompts/c2c-production-planning.md`, `.ai-workflow/managed/prompts/c2c-prototype-design.md`, `.ai-workflow/managed/prompts/c2c-production-plan-refinement.md`, `.ai-workflow/managed/prompts/c2c-independent-plan-review.md`, `.ai-workflow/managed/prompts/c2c-pr-review.md`, `skills/production-planning/SKILL.md`, `skills/prototype-design/SKILL.md`, `skills/independent-plan-review/SKILL.md`, `skills/pr-review/SKILL.md`, `.agents/skills/production-planning/SKILL.md`, `.agents/skills/prototype-design/SKILL.md`, `.agents/skills/independent-plan-review/SKILL.md`, `.agents/skills/pr-review/SKILL.md`, `test/orchestrator.test.js`, `test/onboarding.test.js`, `test/state-store.test.js`, `test/conversation-runner.test.js`, `test/workflow.test.js`, `tests/test_onboarding.py`, `tests/test_manifest_and_paths.py`

## 検証計画

### Unit / migration

DAG cycle/unknown dependency、並行数初期値3・設定変更、scope重複、固定base worktree、child権限境界、親state直接変更拒否、retry/successor、failed dependency isolation、cancel伝播、scope overrun、競合分類、model未確認block、single active orchestrator、manifest digest stale、legacy migration冪等性、backup保持、half-migrated/unknown/unsafe state拒否を検証する。

### Integration / prototype / fallback / E2E

Issue #4 guardの承認前API未呼出し、payload/hash stale、重複公開、remote競合、仕様変更、部分label失敗の回帰、Python/Node両入口の一意起動、childの実操作によるpublish/merge/親state変更拒否、prototype必須項目のschema正負、最終PRレビューblocking findingからのfix/reintegrate/retest/rereview、HUMAN_WAITING decisionのstale拒否、child起動/統合クラッシュ再調整、独立3 unitの並行実行と直列統合、依存統合後の後続開始、各統合後テスト、final suite、prototype/production双方の独立3ラウンドレビュー、Critical/High block、capabilityなしのmanual-start artifact、実Git repo/worktree、実Codex+ChatGPT接続、model確認、最終統合PR提示までを検証する。加えて、次の名前付きケースを最終マトリクスに含める: `superseded_generation_rejects_mutation_start_cancel_integrate_and_result`、`prototype_children_local_review_evaluation_integration_promotion_gate`、`missing_stale_or_blocking_local_review_rejects_integration`、`canMigrate_rejects_each_blocker_and_accepts_exact_safe_stop`、`prototype_approval_requires_fresh_presentation_receipt`、`managed_installation_distributes_issue8_contracts`。これらはそれぞれ lifecycle/state-store、orchestrator/integration、scheduler/integration、migration、ArtifactPresenter/approval、onboarding/manifest のテストスイートへ配置する。さらに、実際のCodexとChatGPT/C2C接続を使った手動ライブ検証を少なくとも1回実施し、run identity、実施日時、接続先、実行結果、失敗時の原因・対応、最終PR成果物を閲覧できたことを記録する。

回帰コマンド:

```text
npm test
npm run validate:fixture
pytest
git diff --check
```

## 主要リスクと受入条件

Highリスクは、承認済みmanifestとscheduler graphの不一致、childによる親state/integration/GitHub変更、並行worktree競合、orchestrator二重起動、実行中legacy stateの誤migrationである。digest binding、capability enforcement、固定base・親直列統合、logical singleton、safe-stop migrationで防ぐ。

受入条件:

- onboarding検証後にproject専用orchestratorが一意に開始または再利用される。
- prototype designとproduction planが独立レビュー会話で最低3 qualifying roundsを通る。
- 承認済みplanから1〜N unitを復元し、上限内で並行実行できる。
- 各childが専用worktree/branch/fixed baseで動き、親権限を持たない。
- dependency、failure isolation、retry、successor、cancelがdurable stateから再開できる。
- 親の直列統合、各段階テスト、final suite成功なしにPRへ進めない。
- scope overrun、設計競合、model未確認、unsafe migration、曖昧ownershipはfail-closedになる。
- child PRは0本、最終統合PRは1本。
- merge後cleanupは人間承認なしに実行されない。
- Issue #2/#4/#6のIssue guard・conversation identity、3-round review、artifact presentation、approval binding、C2C recoveryを退行させない。
- 自動テストやfixtureだけでは代替せず、実際のCodex＋ChatGPT/C2C接続による手動ライブ検証を1回以上完了し、その結果記録と最終PR成果物の閲覧確認を残す。
