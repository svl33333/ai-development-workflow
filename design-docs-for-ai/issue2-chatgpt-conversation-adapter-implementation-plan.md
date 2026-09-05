# Issue #2: ChatGPT会話操作アダプターとCodex側GitHub認証経路の標準化 実装計画

## 状態

独立レビュー中・未承認・実装開始不可。作業ツリーにあるIssue #2向けの未コミット変更は検証用の先行作業として扱い、計画の最終承認・本実装の根拠にはしない。レビューの進捗と判定は、計画本文ではなくレビュー履歴と状態正本から判定する。

実装へ進む前提は、状態正本の連続レビュー履歴から導出した `qualifying_plan_review_iteration >= 3`、その各ラウンドのレビュー・採否・改善記録が存在すること、未解決のCritical／High相当指摘がないこと、これらを確認した後の有効な人間承認 `production_plan` が保存されていることとする。`plan_review_iteration` 単独は承認条件に使用しない。

## 計画の前提

- Issue本文は `docs/issue2-chatgpt-conversation-adapter.md` を一次資料とする。
- Codexが実装・テスト・Git操作を担い、ChatGPTは計画・レビューを担う。
- Project自動作成、GitHub App、複数ワークスペース横断管理、統合ダッシュボードは対象外。
- 既存のfixture用fake adapterは維持し、本番経路から暗黙に利用しない。

## 実装順序

### 1. 会話操作アダプターの契約を定義する

対象: `src/adapters/chatgpt-c2c.js`

- 既存の `createRequest`、`sanitizeRequest`、`parseResponse` は維持する。
- `startConversation`、`resumeConversation`、`sendMessage`、`waitForResponse`、`readResponse`、`getStatus` の6操作を定義する。
- 戻り値はProject、会話、メッセージ、応答、状態、要約済み失敗情報だけを含む構造化結果とする。
- 認証情報を結果・リクエストに含めない。
- `createFakeC2CAdapter` も同じ契約を実装する。

### 2. 会話状態を永続化する

対象: `src/model.js`、`schemas/workflow-state.schema.json`、`src/state-store.js`

- 既存の工程状態とは別に会話実行状態を保持する。
- `INIT → PLAN → EXECUTING → EXECUTED → REVIEW → DONE/BLOCKED` を表現する。
- タスクID、反復回数、Project識別情報、会話識別情報、ワークスペース、現在状態、最後に処理したメッセージID、次の操作、要約済み失敗理由を保存する。
- `{task_id, iteration, message_id}` が送信済みか判断できる冪等性情報を保存する。
- 不正・矛盾した状態はfail closedする。
- PAT、OAuth情報、Cookie、Authorizationヘッダーは保存しない。

### 3. 会話実行ランナーを追加する

対象: `src/conversation-runner.js`（新規）、`src/orchestrator.js`

- 開始または再開を選択する。
- 送信前に送信済み状態を確認する。
- 成功直後にリモートメッセージIDを保存する。
- `getStatus` / `waitForResponse` をポーリングする。
- 推論中と失敗を区別する。
- 応答取得後に状態を進める。
- BLOCKED理由を要約保存する。
- Orchestratorは「何を依頼するか」、Runnerは「どう安全に実行・再開するか」を担当する。

### 4. 再試行と重複送信防止を実装する

- 通信・状態取得は上限付き指数バックオフで再試行する。
- タイムアウト後に送信を盲目的に再実行しない。
- まず状態を再取得し、リモート結果の不存在を証明できない場合はfail closedする。
- ChatGPTが推論中なら待機を継続する。
- 仕様・権限・受入条件の変更は自動解決しない。
- 既存仕様から一意に導ける軽微な補完だけ許可する。

### 5. Project名生成・解決を標準化する

対象: `src/adapters/chatgpt-project.js`

- `基本名称--8文字英数字ID` を生成する。
- 完全一致、メタデータ検証、候補の曖昧性、URL fallback、ワークスペース／リポジトリ検証を扱う。
- 0件で一覧取得可能なら推測せず停止する。
- 1件ならワークスペース検証へ進む。
- 同一IDが複数なら最近利用された順で提示するが、自動接続しない。
- 一覧取得不能時だけユーザーにProject URLを求める。
- ワークスペース不一致はBLOCKEDとする。

### 6. ローカルProject・会話設定を追加する

対象: `schemas/workflow-config.schema.json`、`src/cli.js` または専用設定モジュール

- 生成Project名、Project ID／URL、会話ID／URL、ワークスペース識別情報を環境ごとのローカル設定に保存する。
- リポジトリ管理設定と分離し、認証情報は保存しない。
- CLIはブラウザ、キーチェーン、認証状態を自ら探索せず、依存関係として受け取る。

### 7. Codex側GitHub認証を実装する

対象: `src/adapters/github.js`、`src/adapters/codex.js`、`src/adapters/credential-store.js`（新規）

- OS資格情報ストアから、安定したキーでPATを取得する。
- fixtureではインメモリの合成資格情報を使う。
- 利用前に期限と対象リポジトリへの必要最小権限を検証する。
- 認証エラー時のみ、同じPATで1回だけ再試行する。
- 2回目も失敗したらBLOCKEDとして人間の判断を待つ。
- PATを自動発行・置換しない。
- PATをChatGPT／C2Cへ渡さない。

### 8. GitHub操作の監査記録を追加する

- 操作種別、対象、Issue／PR番号、結果、要約済み失敗理由、時刻／作業識別情報だけを保存する。
- PAT、Authorizationヘッダー、機密性のある資格情報識別子、資格情報を含むHTTP本文は保存しない。

### 9. 承認ゲートを維持してGitHubへ接続する

対象: `src/orchestrator.js`

外部変更の順序を次に固定する。

`人間承認の検証 → リポジトリ／PAT検証 → GitHub変更 → 監査記録 → 状態遷移`

PATの有無や認証リカバリーで承認を迂回しない。

### 9.1 実装計画の最低3ラウンド品質ゲートを追加する

対象: `src/orchestrator.js`、`src/workflow.js`、`src/model.js`、状態テンプレート、独立計画レビューSkill

- 実装計画レビュー回数を状態正本の `plan_review_iteration` として永続化する。
- すべてのレビュー後に `production_plan_review → production_plan_improvement` を通す。第1・第2ラウンドの改善後は、計画作成会話とは分離された同じ工程専用レビュー会話で次ラウンドを行う。第3ラウンド以降も、改善工程で全指摘の採否・根拠・反映内容または変更不要根拠を保存・検証してから、blockingなしの場合にだけ人間承認ステージへ遷移させる。
- 各改善では、前ラウンドの指摘の採否と根拠を保存し、採用分を計画へ反映する。変更不要の場合も根拠を保存する。
- 現行の品質ゲートに数えるのは、アクティブな実装計画レビュー工程とその `review_conversation_id` に結び付いた連続したレビュー履歴だけとする。会話の役割・工程・会話IDを記録していない旧方式のレビュー、または会話IDが異なるレビューは監査履歴として保持するが、`qualifying_plan_review_iteration` に数えない。欠落した会話IDを推測して移行しない。
- 3回完了後にのみ `production_plan_waiting_approval` へ遷移できる。未解決の重大指摘がある場合は改善を継続するか `BLOCKED` とする。
- fixtureテストで、1回・2回の時点の承認拒否、3回の工程専用レビューと3回の採否・改善記録を経た承認可能化、3回すべてのレビュー記録を検証する。旧方式の `plan_review_iteration: 3`、会話IDなしの履歴、異なる会話IDを持つ3件の履歴では承認できず、同じ工程専用会話による連続3件だけが数えられることを検証する。第3回のSUGGESTION、findingなしのAPPROVE、採否記録欠落時の承認拒否も検証する。

### 9.2 レビュー履歴と条件付き遷移を状態正本へ追加する

対象: `src/model.js`、`src/state-store.js`、`src/workflow.js`、`src/orchestrator.js`、`src/approvals.js`、`schemas/workflow-state.schema.json`

- `plan_review_iteration` だけではなく、各ラウンドのレビュー成果物、`finding_id`、`severity`、`disposition`、`rationale`、`plan_change`、`resolved`、未解決blocking件数を永続化する。
- `planning_conversation_id`、工程名、工程専用の `review_conversation_id`、Project識別情報を状態正本とレビュー成果物・採否記録へ保存する。実装計画レビューの `review_conversation_id` は `planning_conversation_id` と異なることを必須にし、第1〜第3ラウンドでは同じ `review_conversation_id` を継続利用する。
- `qualifying_plan_review_iteration` は、アクティブ工程・`review_conversation_id`・ラウンド順序・採否記録が揃った連続履歴から導出する。旧方式のカウンタや会話ID不明の履歴をコピーして承認ゲートを通過させない。旧履歴は削除せず監査用に残す。
- 実装計画レビュー、PRレビュー、プロトタイプ評価には異なる工程専用会話を割り当てる。重大な設計判断、未解決のCritical／High、または人間の依頼により開始するセカンドオピニオンは `review_role: second_opinion` として標準レビュー会話とは別に記録し、標準レビュー会話を置き換えない。
- Critical／High相当の対応関係、`unresolved_blocking_findings` の導出規則、review artifactから履歴へ取り込む構造を固定する。手入力したカウンタでgateを通過できないよう、履歴から導出するか整合性検証する。
- 遷移規則を一箇所で評価する。すべてのラウンドで `production_plan_review → production_plan_improvement`、改善記録検証後にラウンドが3以上かつblockingなしなら `production_plan_improvement → production_plan_waiting_approval`、blockingありなら同じ工程専用レビュー会話で次のレビューまたは `blocked` とする。
- `canTransition()`、状態検証、オーケストレーターが同じ条件付き遷移規則を使い、任意の `setStage()` による規則外の承認待ち遷移を許さない。
- プロセス再開後もレビュー履歴・未解決指摘・次の工程が失われないこと、blocking件数を直接0へ書き換えてgateを迂回できないこと、3回を超える改善・再レビューが可能なことを検証する。
- `independent_plan_review` は第1ラウンドで `startConversation` を使用し、第2ラウンド以降と途中停止の再開では同じ `review_conversation_id` に `resumeConversation` を使用する。計画作成会話をレビュー会話として再利用した場合、工程をまたいで同じレビュー会話を使った場合、会話IDなしで回数だけを増やした場合はfail closedする。
- 工程専用レビュー会話が再開不能と確定した場合は `BLOCKED` とし、人間承認後にだけ代替会話を開始する。承認種別 `review_conversation_replacement` を追加し、`work_id`、レビュー工程、レビュー役割、再開不能になった `old_conversation_id`、失敗理由の要約、レビュー履歴の現在リビジョンに束縛する。代替開始直前にこの束縛を検証し、交代後は承認を消費または無効化する。`production_plan` 承認を会話交代の承認として扱わない。
- 代替会話には計画作成会話の履歴を渡さず、Issue・現行計画・レビュー工程の過去のレビュー／採否記録だけを引き継ぎ、交代理由と新旧の会話IDを保存する。交代後は新しい会話IDに対する連続した3ラウンドを改めて満たすまで、旧会話のラウンドと合算して品質ゲートを通過させない。
- セカンドオピニオンは別の補助レビュー会話を開始するだけとし、アクティブな工程専用レビュー会話のID・連続レビュー履歴・`qualifying_plan_review_iteration` を変更しない。セカンドオピニオンのラウンドは品質ゲートに数えず、指摘と採否を別記録に残す。
- 計画作成会話とレビュー会話のIDが異なること、3ラウンドで同じ工程専用レビュー会話を再利用すること、工程間でレビュー会話が異なること、中断後に重複会話を作らず再開すること、代替会話への交代に正しい束縛を持つ人間承認が必要なこと、無承認・別作業／別工程／別会話向け・履歴更新後の古い承認・再開不能未確定での交代を拒否すること、セカンドオピニオンがアクティブ会話・品質ゲート回数を変えないこと、会話IDなしで回数だけを増やしても承認できないことを検証する。

### 9.3 曖昧な送信失敗を再送しない会話ランナーへ具体化する

対象: `src/conversation-runner.js`、`src/adapters/chatgpt-c2c.js`、状態モデル、専用テスト

- `getStatus`、`waitForResponse`、安全な読み取りだけを上限付き指数バックオフの対象とする。
- `sendMessage` は、送信前に `{ task_id, iteration, message_id }` の冪等性レコードを `prepared` として保存し、送信開始後は `sending`、確認済みは `confirmed`、結果不明は `ambiguous` として保存する。
- 送信後の通信切断・タイムアウトでは再送せず、会話／メッセージ照合または状態取得で到達状況を確認する。非到達を積極的に証明できない場合は `BLOCKED` とする。
- 「リモートは受理したがクライアントがタイムアウト」「受理とローカル確認の間でプロセス停止」の双方で、論理メッセージが1件だけになるテストを追加する。

### 9.4 会話状態スキーマを具体化する

対象: `schemas/workflow-state.schema.json`、`src/model.js`、状態ストアとテスト

- 会話状態の列挙値、Project／会話／メッセージ識別子、送信済み記録の形、状態依存の必須項目をスキーマと実行時検証の双方で定義する。
- 不完全・矛盾した会話状態は読み込み時点でfail closedする。

### 9.5 PATの人間承認付きbootstrap／復旧を追加する

対象: `src/cli.js` または専用の認証設定モジュール、credential store、GitHub adapter、テスト、運用文書

- PATが存在しない・期限切れ・権限不足・対象リポジトリ不一致の場合、Codexは必要な対象リポジトリ、最小scope、有効期限を表示して停止する。
- ユーザーがGitHub上で認証・PAT作成を行い、登録を明示承認した場合にだけcredential storeへ登録する。CodexはPATを自動発行・置換しない。
- 生のPATはコマンドライン引数、リポジトリ内ファイル、状態、成果物、監査記録、通常ログから受け取らない。非表示の対話入力またはOSネイティブの資格情報登録経路だけを使い、取得した値はcredential storeへ直送してワークフロー／設定オブジェクトへ保持しない。
- 登録後に期限・対象リポジトリ・最小権限を検証してから、承認済みのGitHub操作に利用する。
- PATなし、ユーザー承認なし、過剰権限、対象リポジトリ不一致、期限切れではGitHub変更を実行しないテストを追加する。
- PATが状態・設定・成果物・監査出力・CLI出力・エラー出力に出ないこと、永続化されるCLI引数としてPATを渡せないこと、認証失敗は同一資格情報で1回だけ再試行し途中で資格情報を取得・発行・置換しないこと、非認証エラーではPAT再試行しないことを検証する。

### 9.6 リモート送信照合契約を固定する

対象: 会話adapter契約、conversation runner、専用テスト

- `sendMessage` に渡す論理message IDが、`getStatus` または読み取り操作でリモート受理済みか照合できることをadapter契約として明記する。
- C2C実装がこの照合に必要な会話ID・メッセージID・状態を提供できない場合は、疑似的な再開をせず `BLOCKED` とする。

### 10. CLIの構成境界で本番アダプターを注入する

対象: `src/cli.js` または専用composition module

- 会話アダプター、Project resolver、ローカル設定、credential store、認証済みGitHubアダプターを明示的に構成する。
- 本番でC2Cが利用できない場合はfail closedする。
- 未解決Project、無効PATもBLOCKEDとして扱う。
- Orchestratorに外部サービス探索を持たせない。

### 11. ドキュメントを整合させる

対象: `docs/ai-development-workflow-package-spec.md`、`docs/phase1-grill-summary.md`、README／復旧手順

- ChatGPTはOAuthコネクター、Codexはリポジトリ限定fine-grained PATというIssue #2の規範を反映する。
- `skills/independent-plan-review/SKILL.md` と `.agents/skills/codex-plan-review-loop/SKILL.md` に、工程専用レビュー会話の継続利用、会話交代の承認、セカンドオピニオンの補助的役割を同じ意味で反映する。
- Project名生成、手動作成、解決、状態遷移、重複送信防止、推論中の待機、PAT検証、BLOCKED処理を記載する。
- 旧来の認証方針と矛盾する記述を削除・修正する。

## 検証

- fixtureテスト: fake adapter、状態遷移、Project解決、資格情報ストア。
- 統合テスト: RunnerとOrchestrator、再試行、冪等性、承認ゲート、fail closed。
- 実環境E2E: 手動Project作成、Project特定、会話開始、指示送信、推論中待機、応答取得、通信失敗からの再開。
- 標準検証: `npm test`、`npm run validate:fixture`、`git diff --check`。

## 主なリスク

- ブラウザ／コネクター固有処理をOrchestratorへ埋め込むと、テストと保守性が悪化する。
- GitHubの全エラーを認証エラー扱いすると、不要な再認証が発生する。
- 変更リクエストが部分成功した後の自動fallbackは、外部変更の重複を起こす可能性がある。
- 本番CLIでfake adapterを使うと、既存のfail-closed境界を破る。
- ログや監査記録に資格情報が混入しないよう、アダプター境界で遮断する。
