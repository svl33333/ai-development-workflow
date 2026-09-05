# Local PR draft — ChatGPT conversation adapter and GitHub credential path

## Issue

https://github.com/svl33333/ai-development-workflow/issues/2

## このPRで対応する範囲

- Codex実行・ChatGPT計画/レビューの会話ライフサイクルを安全に再開するC2Cアダプター境界
- 実装計画レビューを、計画会話と分離した専用レビュー会話で最低3回行う品質ゲート
- ChatGPT Projectの厳密な名前解決、曖昧時停止、ワークスペース/リポジトリ照合
- リポジトリに限定した資格情報ストアと、GitHub公開操作への期限・権限検証
- 会話状態、レビュー履歴、承認バインディング、fixtureと回帰テスト

## このPRで対応しない範囲

- GitHub PRの実公開、マージ、資格情報の初回登録（いずれも人間承認が必要）
- ChatGPT Project自動作成
- 会社環境のCopilot向けアダプターと、環境横断の同期
- 複数プロジェクトを一覧する運用UI

## 確認結果

- `npm test`: 39 passed, 0 failed
- `npm run validate:fixture`: passed
- `git diff --check`: passed
- fixture縦断テストとIssue #2の会話・資格情報・Project境界テストを実行
- ChatGPT PRレビュー: `c2c_9f2a` iteration 4で承認、blockingなし
- 証跡: `work/runs/issue2-e2e-and-pr-review.md`

## 変更点概要

ChatGPT側を計画・レビュー専用に保ち、Codexが実装・テスト・修正を担うための実行境界を追加する。会話送信の重複・未送信を再開時に安全に扱い、実装計画のレビュー会話を段階内で継続利用する。ProjectとGitHub資格情報は、誤った対象や期限切れの認証情報で先に進めないようにする。

## レビュアーに重点的に確認してほしい点

- 3回の実装計画レビューと未解決blocking指摘が、実装への進行を確実に止めるか
- `prepared` / `sending` / `ambiguous` の会話送信状態で重複送信や送信漏れを起こさないか
- Projectのworkspace/repository照合が設定値との独立比較になっているか
- 資格情報が成果物・状態・ChatGPTへのメッセージに保存されないか

## 既知の制約

- 本PRはローカルPR草案であり、公開とマージは人間が別途承認する。
- 実際のChatGPT Project作成はユーザー操作を前提とする。
