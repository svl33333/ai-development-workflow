# Issue #2 implementation plan — same-stage review round 4

- Verdict: `NEEDS_WORK`
- Reviewer: ChatGPT（実装計画レビュー工程の継続会話）
- Scope: 会話分離・継続利用方針、旧レビュー履歴の移行、会話交代の人間承認

## 採否と改善

| ID | Severity | Disposition | 対応 |
| --- | --- | --- | --- |
| R1 | IMPORTANT | adopted | 現行ゲートに数えるのは、アクティブ工程と同一の工程専用レビュー会話へ結び付いた連続履歴だけと定義した。会話ID不明・異なる会話IDの旧履歴は監査用に保持するが、品質ゲートには数えない。導出値と移行fail-closedのテストを追加した。 |
| R2 | IMPORTANT | adopted | `review_conversation_replacement` 承認を追加する設計とし、作業・工程・役割・失われた会話・理由・レビュー履歴リビジョンへの束縛、直前検証、承認消費、誤用拒否のテストを追加した。 |

## 次ラウンドへの入力

修正版の `design-docs-for-ai/issue2-chatgpt-conversation-adapter-implementation-plan.md` と、この実装計画レビュー工程の過去のレビュー・採否記録を、同じ工程専用レビュー会話へ渡す。計画作成会話の履歴・自己評価は渡さない。
