# Issue #10 実装計画

## 目的

レビュー工程へ渡す入力を機械的に固定し、レビュー対象・証跡・ラウンド間の引き継ぎを再現可能にする。

## 計画レビューの運用契約

計画のレビューは、計画作成会話とは独立したChatGPT会話で行う。各ラウンドは工程ごとのレビュー会話を継続利用し、前ラウンドのfinding IDと修正後のplan digestを照合する。最低3ラウンドを実施し、Round 1はcontract／fail-closed、Round 2はrecovery／concurrency、Round 3はverification／scopeを重点とする。

各ラウンドでは plan revision、plan digest、review conversation ID、review bundle digest、findings、disposition、改訂plan digest、qualifying判定を保存する。3というカウンタだけでは完了にせず、連続した3件のqualifying review recordを履歴から再導出できることを条件とする。Round 3後もCritical／Highが残る場合は、解消するまで「レビュー → 採否 → 計画改訂 → 新digest → 再レビュー」を継続する。

## 計画段階の安全条件

計画承認前は実装、ファイル変更、コミット、PR操作、実装タスクの作成・起動を行わない。現working treeはIssue #8由来の変更を含むため、実装開始時は承認済みbase revisionからIssue #10専用branchと専用worktreeを作成する。worktreeなしの並行実行、親cwdとの共有、誤base revisionは拒否し、policyで明示された場合だけ直列化する。

## Round 1指摘反映後の正規化（旧U0〜U4定義を置換）

基準プロジェクト `C:\Projects\AI_Development_Workflow` の `6c4219457d7336d14c8c9b02ecdc737a563fdc57` には、現時点で `src/`、`test/`、`schemas/`、`package.json`、オーケストレーター実装が存在しない。したがって、前節までの「既存JavaScript実装を変更する」という表現は実装順序の根拠として使用せず、以下の新規構築WBSを正とする。

### W0: 基準と仕様の固定

- Issue #10本文、今回のIssue草案、既存仕様書、Issue #1関連資料をリポジトリ内の設計資料として固定し、目的・対象・非対象・受入条件・live E2Eの必須性を明記する。
- 基準revision、remote、runtime、OS、GitHub／C2Cの外部境界を記録する。Issue #10のlive E2Eは、認証情報を保存せず、fixture／contract testで代替可能な項目と分離する。
- `package.json`、test runner、最小CLI、`src/`、`test/`、`schemas/`、`fixtures/`の初期構成を新規作成する。
- 実行基盤はNode.js 24.x、npm、CommonJS、lockfileは `package-lock.json` とする。JSON Schema validatorはAjvの固定major versionを採用し、依存はlockfileで固定する。OS対応はWindows 11とUbuntu 22.04以上、Git 2.40以上とし、path・改行・Git plumbingの差分はadapterで吸収する。
- CLIの最小契約は `npm test`（unit／contract／integration）、`npm run validate:fixtures`（fixture validation）、`node src/cli.js status --json`（副作用なしの状態表示）とする。schema validationの失敗は非0終了、外部write・ChatGPT送信・child起動は0回とする。
- `test/bootstrap-clean-checkout.test.js` を追加し、clean checkoutで `npm ci` → `npm test` → `npm run validate:fixtures` が実行できること、Node／npm／Gitの最低バージョンを検証する。live E2Eはbootstrap testに含めず、認証済み環境の個別テストとして分離する。

### W1: Versioned contract foundation

- `schemas/workflow-state.schema.json`、`schemas/review-bundle.schema.json`、`schemas/review-response.schema.json`、`schemas/child-task-result.schema.json`、`schemas/approval.schema.json`、`schemas/audit-event.schema.json`、`schemas/recovery-checkpoint.schema.json`を新規作成する。
- すべてのschemaにversion、必須／任意項目、追加フィールドの互換性ルールを定義する。canonical serializationはUTF-8、キー順、改行、末尾改行、数値表現を固定する。
- `src/model.js`、`src/state-store.js`、`src/artifact-digest.js`を新規作成する。legacy状態は読み取り専用migrationでversioned stateへ変換し、失敗時は元ファイルを変更せずblockedとする。rollbackは新規stateを隔離して旧stateを保持する。

### W2: Review bundleとpreflight

- `src/review-bundle.js`、`src/review-preflight.js`、`src/review.js`を新規作成する。対象revision、入力path、digest、hash basis、task／work／Issue identity、iteration、conversation binding、allowed metadata revision、期待変更範囲を一意に固定する。
- review送信前に入力凍結、revision再照合、履歴・ラウンド重複、counter、approval／presentation receipt、秘密情報、canonical digestを検証する。失敗時はChatGPT送信を0回にする。
- 応答にはtask、iteration、target revision、finding ID、severity、証拠path、dispositionを必須化し、binding不一致やschema違反を拒否する。

### W3: 共通workflow harnessと外部境界

- `src/workflow.js`、`src/workflow-gates.js`、`src/orchestrator.js`を新規作成する。状態遷移表を正本とし、成果物、承認、receipt、revision、会話役割、外部能力、skip可否を境界ごとに評価する。
- `src/adapters/github.js`、`src/adapters/chatgpt-c2c.js`を新規作成する。外部writeはpreflight→operation reservation→mutation→remote verification→checkpointとし、命名済みidempotency keyを保存する。401は `AUTH_REQUIRED`、C2C切断は `CONNECTION_REQUIRED`、応答不明は `RESULT_UNKNOWN` とし、remote照合なしの再createを禁止する。
- 監査イベントには秘密情報を含めず、operation key、対象repository、対象revision、状態、結果分類、checkpoint参照を保存する。

### W4: worktreeと並行タスク基盤

- `src/worktree-manager.js`、`src/task-scheduler.js`、`src/child-task-runner.js`、`src/integration-manager.js`を新規作成する。
- worktreeは親cwd外かつactive child間で一意、base HEAD一致、branch一意、lock取得済みであることをRUNNING前に検証する。開始・完了時に実HEADを取得し、所有者、generation、cleanup状態を記録する。
- Windows／Unixのpath正規化とGitコマンド差分をadapterに閉じ込める。作成不能時は明示policyにより直列化するかblockedとし、親cwd共有を成功扱いにしない。

### W5: テスト・fixture・E2E

- `test/`にunit、schema、contract、integration、recovery、worktree、harnessテストを追加し、外部adapterはspy／fakeでwrite・send・child launch回数を検証する。
- `fixtures/sample-product/`にstale target、履歴混在、改行差異、stale approval、receipt欠落、worktree衝突、GitHub auth expiry／result unknown、C2C切断、誤binding、承認前逸脱を追加する。
- 負系は外部write・ChatGPT送信・子タスク起動が0回であることを必須とする。live E2Eは、資格情報と一時URLを記録せず、実施済み／未実施を監査記録へ分離する。`npm test`とfixture validationを完了条件とする。

W0 → W1 → W2 → W3 → W4 → W5を正規順序とし、W2とW3の内部unit testは依存部分が完成した時点で実施する。旧U0〜U4と補足Phaseの二重管理は行わない。

Node.js 24.x、npm、Git 2.40以上が利用できない環境ではW0を完了扱いにしない。組織標準と異なる場合は、互換version、変更理由、検証結果をW0のdecision recordへ記録し、人間承認を得る。

### W0の固定成果物とIssue #10対応表

W0で次のファイルを正確に作成し、Issue #10の本文・追加Grilling確定事項・背景事実をその内容として固定する。

- `docs/issues/issue-10-review-evidence-precision.md`: 目的、背景、要求、対象、非対象、制約、live E2Eの扱い。
- `docs/issues/issue-10-acceptance-matrix.md`: 受入条件ID、要求根拠、WBS（W0〜W5）、テスト、実施証跡、未実施時の判定。
- `docs/issues/issue-10-decision-record.md`: Issue #10の要求と既存仕様が衝突した場合の優先順位、採用・保留・対象外の判断。
- `docs/fixtures/issue-10-inputs/`: Issue本文、仕様、計画、レビュー記録を参照入力として固定するfixture。

Issue #10の要求は「レビュー入力と対象revisionの一意性」「レビュー前fail-closed」「全工程ハーネス」「認証・C2C復旧」「worktree分離」「再現可能なテスト」の6群に分類する。各要求には必ず受入条件ID、実装WBS、unit／contract／integration／E2Eテスト、監査証跡の保存先を1対1で割り当てる。live E2Eは認証済み個人環境でのみ実施可能な外部境界に限定し、未実施でもfixture／contract testで代替できる条件と、未実施のまま完了できない条件を対応表に明示する。

### W1のnormative digest契約

- ハッシュアルゴリズムはSHA-256、digest表現は小文字hex、canonical bundleの文字コードはUTF-8とする。
- `working_tree_bytes` は指定pathのファイルをOSの変換なしにバイト列として読む。`git_blob` は `blob <byte-length>\\0<content-bytes>` をSHA-256へ入力する。`canonical_utf8` はテキストに限り、UTF-8 BOMなし・LF改行・末尾改行1個・JSONキー辞書順・配列順序保持・数値表記固定でシリアライズする。
- bundle内の入力順は正規化済み相対pathのUnicode code point昇順とし、path、artifact kind、revision、hash basis、digest、byte lengthをcanonical recordへ含める。除外は明示されたsecret／生成キャッシュだけとし、除外pathを監査記録に残す。
- binary、symlink、読取不能、存在しないpath、改行変換不能なデータは推測・正規化せずエラーにする。CRLFとLFは `working_tree_bytes` では別digest、`canonical_utf8` では規約に従った同一digestとなることをgolden fixtureで検証する。
- `schemas/digest.schema.json` と `test/artifact-digest.test.js` に上記規約、LF／CRLF、binary、symlink、path順、Git blobのgolden値を固定する。

### W3の外部操作・冪等性契約

- `operation_key` は `sha256(operation_type + "\\n" + repository_identity + "\\n" + issue_or_pr_identity + "\\n" + task_id + "\\n" + generation + "\\n" + target_revision)` の小文字hexとする。秘密情報は入力しない。
- `schemas/external-operation.schema.json` にoperation type、scope、operation key、reservation state、checkpoint、target identity、結果分類、remote verification結果を定義する。reservationは同じscopeとkeyについて一度だけ取得できる。
- write前はpreflight→reservation→mutation→remote verification→checkpoint。応答不明またはプロセス中断時は `result_unknown` とし、Issue／PR／commitのrepository scoped identity、head/base、operation key markerを照合する。既存なら再利用し、無ければ同じkeyで一度だけ再開する。照合不能時はblockedとしcreateを繰り返さない。
- ChatGPT送信もtask、stage、iteration、bundle digest、target revisionを含む同じ形式のoperation keyで管理し、送信済みcheckpointがある場合は再送せず結果取得・照合へ進む。
- `test/recovery.test.js` と adapter contract testで、認証切れ、401、timeout、応答不明（remoteあり／なし／照合不能）、再認証後resume、二重Issue／PR作成防止、二重ChatGPT送信防止を検証する。

### W4のworktree lifecycle契約

- `parent_cwd` はworkflow開始時に解決したGit worktree root、`worktree_root` は設定されたchild root配下の専用ディレクトリとする。`worktree_root`は`parent_cwd`と同一不可で、実体pathを正規化して比較する。
- lifecycleは `reserved → created → running → completed|failed|abandoned → cleaned` とし、owner（task ID、process/run ID）、branch、base revision、generation、lock path、作成時／終了時HEADを `schemas/worktree.schema.json` に保存する。
- lock取得とworktree存在・HEAD・branch検証を完了するまでchildをRUNNINGにしない。異常終了は `abandoned` として扱い、ownerの生存確認、未コミット変更、HEAD一致、lock解放を確認できた場合だけ再利用する。それ以外は新規worktreeかblockedとする。
- cleanup責任者はscheduler、実行中のcleanup禁止条件、失敗時の隔離先、保持期間、Windows／UnixのGitコマンド差分をadapter contractに定義する。並行worktree作成不能時の既定値はblocked、直列化は設定名 `parallelFallback: serial` を明示した場合だけ許可する。
- `test/worktree-manager.test.js` とfixtureで親cwd共有、branch衝突、lock衝突、異常終了、再開、cleanup失敗、Windows pathを検証する。

## Round 1採否記録

Round 1のレビュー結果は `work/plan-reviews/issue-10/round-1-review.md` に保存した。R1〜R6とR7を採用し、基準プロジェクトに存在しない実装を既存前提にしないようW0〜W5へ再編した。次ラウンドでは、W0〜W5の依存、scope、schema・idempotency・worktree・テスト契約の具体性を確認する。

## Round 2採否記録

Round 2のレビュー結果は `work/plan-reviews/issue-10/round-2-review.md` に保存した。R8〜R11をすべて採用し、Issue #10の固定文書・対応表、digestのnormative仕様、外部操作の冪等性、worktree lifecycleを追加した。次ラウンドでは、これらが基準プロジェクトで実装可能な範囲に閉じ、受入条件とテストへ追跡可能かを確認する。

## Round 3採否記録

Round 3のレビュー結果は `work/plan-reviews/issue-10/round-3-review.md` に保存した。R13〜R16をすべて採用し、以下の要求台帳、Git object IDとcustom digestの分離、atomic reservation、ChatGPT専用operation keyを追加した。

## Round 4採否記録

Round 4のレビュー結果は `work/plan-reviews/issue-10/round-4-review.md` に保存した。R18、R19を採用し、旧草案のU0〜U4・旧実装順序・補足Phaseを削除し、W0〜W5だけを正規WBSにした。実行基盤、lockfile、CLI、schema validator、clean-checkout test、OS/Git要件をW0へ追加した。

## Round 5採否記録

Round 5のレビュー結果は `work/plan-reviews/issue-10/round-5-review.md` に保存した。R21を採用し、旧U0〜U4および旧実装順序の実体を計画本文から削除した。R22も採用し、runtime要件と組織標準の不一致をW0のdecision recordと人間承認へ紐付けた。

## Issue #10要求台帳（計画単体でのスコープ固定）

この台帳がIssue #10の要求本文と受入条件の正本であり、W0で要約を作り直してはならない。要求ID、受入条件、WBS、テスト、監査証跡を以下のとおり固定する。台帳外の機能は本Issueの対象外で、追加する場合は別Issueまたは人間承認付きの仕様変更とする。

| 要求ID | 固定要求 | WBS | 検証 | 証跡 |
|---|---|---|---|---|
| RQ-01 | ChatGPTレビュー開始時にレビュー対象revisionを一意に確定し、base／implementation／review／許可metadataの関係を機械検証する | W1,W2 | bundle/preflight contract test | review bundle |
| RQ-02 | Issue・仕様・計画・manifest・テスト結果・PR draft・stateの入力path、revision、digest、hash basisを再現可能にする | W1,W2 | golden bundle test | bundle and audit |
| RQ-03 | bundle生成後の入力変更、履歴混在、round重複、counter不一致、approval／presentation receipt失効をChatGPT送信前にfail-closedする | W2,W3 | negative fixture | preflight audit |
| RQ-04 | Critical／High指摘、前回finding ID、修正範囲、再レビュー対象を一意に紐付ける | W2 | review response test | review record |
| RQ-05 | Git object IDと作業ツリー／custom digestの意味を区別し、CRLF／LF・binary・symlinkを曖昧に扱わない | W1,W2 | digest golden test | digest record |
| RQ-06 | 計画承認・仕様承認・人間提示receiptが対象revision/digestと一致しない限り実装・外部writeへ進まない | W3 | gate test | approval/audit |
| RQ-07 | 実装・テスト・並行子タスクを計画タスクから分離し、専用worktree、branch、HEAD、generationを固定する | W4 | worktree/concurrency test | child result |
| RQ-08 | 全工程の許可遷移、必須成果物、承認、会話役割、Project／workspace／repository bindingを共通ハーネスで検証する | W3 | transition matrix test | state/audit |
| RQ-09 | GitHub認証切れ・401・権限不足は外部writeなしでauth_waitingへ停止し、再認証後に同一checkpointから重複なく再開する | W3 | adapter recovery test | operation record |
| RQ-10 | C2C接続切断・binding不一致はconnection_waitingへ停止し、同一bundle／checkpointから依頼を二重送信せず再開する | W3 | C2C contract test | operation record |
| RQ-11 | 外部操作の結果不明はremote照合なしに再createせず、既存Issue／PR等を再利用またはblockedとする | W3 | result_unknown test | recovery checkpoint |
| RQ-12 | 正常系および工程飛ばし・承認不足・証跡不一致・認証／接続障害・worktree衝突・再開をfixture、統合、live E2Eで検証する | W5 | coverage matrix | E2E report |

### 非対象と優先順位

非対象は、モデル再学習・モデル性能そのものの評価、リポジトリ全体のChatGPTへのアップロード、子タスクごとのGitHub PR、仕様確定・人間承認・マージ判断の自動化、未承認変更の正式成果物化、ChatGPT Project／Connectorの完全自動作成である。要求間の優先順位は RQ-01〜RQ-05（入力の正確性）、RQ-06〜RQ-08（逸脱防止・分離）、RQ-09〜RQ-11（外部境界の復旧）、RQ-12（検証）の順とする。live E2Eは個人環境で実行権限と安全なテスト対象がある場合のみ実施し、ない場合はfixture／contract testを必須代替とする。ただし代替した場合、live E2E未実施を完了済みと表現せず、人間承認を得る。

### RQ-01〜RQ-12の完了条件

各要求は、実装WBS、schema validation、該当テスト、監査証跡の4点が揃った場合だけ完了とする。対応表にない受入条件、未実施テスト、未定義の外部境界は `HUMAN_DECISION` とし、計画承認へ進めない。

## digestとGit object IDの分離契約

- 実Gitの識別子は `git_object_id: {algorithm: sha1|sha256, value: <Gitが返すobject ID>}` として保存する。Gitのrepository object formatを検出し、`git hash-object`または同等のGit plumbing結果と一致することを検証する。
- `working_tree_bytes` と `canonical_utf8` はGit object IDではなく、`custom_digest: {algorithm: sha256, basis: ..., value: ...}` として保存する。フィールド名に `git_blob` を使用してcustom SHA-256を表現しない。
- Git blob相当の計算を補助的に行う場合も `git_blob_compat_digest` と明示し、実Git object IDとは別フィールドにする。repository形式がsha1とsha256で混在する場合はalgorithm付きIDを比較し、値だけを比較しない。
- golden fixtureはsha1 repositoryとcustom SHA-256、working-tree CRLF/LF、binary、symlinkについて、入力バイト列・Git object ID・custom digestを別々に期待値として持つ。

## external operationの永続化とChatGPT専用key

- `state-store`の保存先はプロジェクトの管理対象stateディレクトリ内の `external-operations/<operation_key>.json` とし、資格情報・token・一時URLは保存しない。
- reservationはexclusive create-if-absentで取得する。実装はOS標準のexclusive file createまたは同等のatomic primitiveを使い、既存keyがある場合は唯一の勝者を再利用する。temp file→atomic renameだけでreservationの競合を解決したことにしてはならない。
- 各recordは `operation_key`、operation type、scope、target identity、generation、target revision、status（reserved／mutating／result_unknown／verified／failed）、checkpoint、owner、created_at、updated_at、remote verificationを必須とする。
- クラッシュ後はrecordを再読込し、`reserved`のowner生存確認、`mutating`／`result_unknown`のremote照合、`verified`の再利用、照合不能時のblockedを行う。reservation→mutation→verification→checkpointの各境界をクラッシュfixtureで検証する。
- GitHub用keyは `sha256(operation_type + "\\n" + repository_identity + "\\n" + issue_or_pr_identity + "\\n" + task_id + "\\n" + generation + "\\n" + target_revision)` とする。
- ChatGPT用keyはGitHub identityを使わず、`sha256("chatgpt_request\\n" + connector_identity + "\\n" + workspace_identity + "\\n" + project_identity + "\\n" + conversation_identity + "\\n" + task_id + "\\n" + stage + "\\n" + iteration + "\\n" + bundle_digest + "\\n" + target_revision)` とする。connector identityは秘密情報を含まない安定名、conversation identityは工程専用会話の識別子とする。
- ChatGPT送信前に同keyのcheckpointを確認し、送信済みなら再送せず結果取得へ進む。`result_unknown`は同じkey・同じbundle digestでのみ再開し、bundleやtarget revisionが変わった場合は新しいiterationとして人間確認を要求する。
