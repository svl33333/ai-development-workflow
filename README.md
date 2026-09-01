# AI Development Workflow

CodexとGitHub Copilotで、プロトタイプから本番開発までのAI開発フローを共通化するためのパッケージです。

## Status

仕様策定・初期実装前。詳細は[仕様書](docs/ai-development-workflow-package-spec.md)を参照してください。

## Design principles

- 共通マスターを一つのGitHubリポジトリで管理する
- Codex/Copilotの差はアダプターで吸収する
- 各プロダクトのオーケストレーターは各環境内で完結する
- 仕様確定、本番移行、マージは人間が承認する
- 会社環境のログ・テスト詳細・固有ポリシーは環境外へ自動送信しない
