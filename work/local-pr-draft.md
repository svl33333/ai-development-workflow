# Local PR draft

## Issue

https://github.com/svl33333/ai-development-workflow/issues/1

## このPRで対応する範囲

- 個人環境のCodex + ChatGPT/C2C向けPhase 1基盤
- 状態・承認・工程遷移・C2C契約・fixture・自動テスト
- Prototypeからproduction、ローカルPRレビューまでの実行境界

## このPRで対応しない範囲

- 会社環境のCopilotオーケストレーション
- 複数プロジェクト横断UI
- 実運用GitHubへの自動公開・マージ
- ChatGPT Projectの完全自動作成

## 確認結果

- `npm test`: 22 tests passed, 0 failed
- `npm run validate:fixture`: passed
- `git diff --check`: passed
- 実行記録: `work/runs/phase1-test-execution.json`（phase1-local-002）
- 実GitHubへの外部書込み: 未実施
- C2C実接続レビュー: iteration 16で APPROVED（blockingなし）

## 変更点概要

Node.js CLI、Markdown + YAML front matter状態管理、承認ゲート、工程遷移、C2C／Project／GitHub adapter境界、Skills／prompts／templates、fixtureとテストを追加した。

## 変更理由

会話履歴に依存せず、Codexが実行、ChatGPTが計画・レビュー、人間が承認する責務分担を再現可能な成果物と状態で検証するため。

## 主な変更内容

- `src/state-store.js`: 状態の永続化、revision、ロック
- `src/orchestrator.js`: 承認付きfixture縦切り
- `src/adapters/`: C2C、Project、Codex、Copilot、fake GitHub境界
- `src/review.js`: blocking／仕様変更／範囲による自動修正判定
- `test/`、`fixtures/`: 成功・拒否・停止・完了経路
- 通常productではC2C／GitHub adapter未設定時にfakeへフォールバックせず停止

## レビュアーに重点的に確認してほしい点

- 人間承認なしで仕様確定、Issue作成、実装、公開、マージへ進まないか
- 状態の再開時にagent_stateとtop-level stateが一致するか
- C2C入力に秘密情報やファイル本文を含めないか
- review findingの自動修正条件が3条件のANDになっているか
- fixtureが実際のIssue解決とPR作成・マージを検証しているか

## 未解決事項・既知の制約（Phase 1のスコープ外）

- 実際のGit/head・test run・review artifactからpublish/merge approval bindingを導出するadapter接続
- 実サービスへ接続するGitHub・C2C・ChatGPT Project providerの実装
- 複数プロジェクトを横断する運用UIと、ChatGPT Projectの完全自動作成
- 実運用GitHubへの公開・マージを行う外部adapterの接続
- 実運用環境でのlive C2C／Project／evidence／GitHub adapter接続

今回の検証で完了:

- canonical state filenameとrevisionベースのactive state選択
- validateのstate/config・artifact・lock整合性検証とstructured errors
- nextのvalidate先行ゲート
- nextの承認済みゲート再開、公開・マージdispatch
- 現行schemasの実行時type/required/enum/properties/items検証
- update digestを含む管理ファイルのfail-closed検証
- lock collision、stale publish approval、missing merge approvalのnegative tests
- 通常productのC2C／GitHub adapter欠落時のfail-closed検証

## 補足情報

通常のfixtureテストはfake adapterだけを使用し、外部サービスへ接続しない。
