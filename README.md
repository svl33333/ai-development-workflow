# AI Development Workflow

CodexとGitHub Copilotで、プロトタイプから本番開発までのAI開発フローを共通化するための共通マスターです。

## Status

Phase 1の最小縦切りを実装中。Node.js CLIとfixtureの基本検証が利用できます。

## Quick start

```text
npm test
npm run validate:fixture
node bin/ai-workflow.js setup --product <your-product> --project-id <project-id>
node bin/ai-workflow.js status --product <your-product> --json
node bin/ai-workflow.js validate --product <your-product>
node bin/ai-workflow.js update --product <your-product> --check
```

Codexが実行・状態管理・Git操作を担い、ChatGPTはC2C/MCP経由で設計・計画・レビューを行います。プロトタイプ用と本番用のChatGPT Projectは分離し、承認前の仕様確定・実装・公開・マージは行いません。

## 目的

- AI開発による理解負債を抑制する
- 個人環境と会社環境で工程・成果物・承認基準を共通化する
- Codex/Copilotの差をアダプターで吸収する
- 会社環境の機密情報を環境外へ自動送信しない

## Documents

- [仕様書](docs/ai-development-workflow-package-spec.md)
- [Phase 1仕様サマリー](docs/phase1-grill-summary.md)
- [Codex向け実装計画作成プロンプト](user-prompts/issue1-implementation-plan.md)
