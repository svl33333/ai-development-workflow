# Issue #8 実装計画レビュー 第1ラウンド

- Task: `c2c_i8p1`
- Round: 1/3
- Reviewer: ChatGPT（計画作成会話とは独立した会話）
- Verdict: `CHANGES_REQUIRED`
- Summary: Critical 1 / High 5 / Medium 3 / Low 0

## Findings

### Critical

- C1: Issue #4 の `.codex/workflow-state.json` と Issue guard が計画上の親オーケストレーター正本と未統合。Issue作成を直接実行せず、既存guard/state machineを呼び出すか、全不変条件を保持した移行を仕様化する必要がある。

### High

- H1: 公開運用経路である Python `ai-workflow` から新オーケストレーターが起動される計画になっていない。
- H2: 子タスクのGitHub公開、親state、integration branch等の禁止が事後検証中心で、実行前の権限制限になっていない。
- H3: prototype unitに必要な `hypothesis`、成功条件、失敗条件、評価方法がmanifest必須項目にない。
- H4: 最終統合後のChatGPT PRレビュー→修正unit→再統合→再テスト→再レビューの経路が未定義。
- H5: `HUMAN_WAITING` 後の判断記録・stale判定・安全な再開操作が未定義。

### Medium

- M1: child起動直後・統合直後のクラッシュを再調整するidempotency/reconciliationが未定義。
- M2: 最高性能の選択可能な推論モデルを既定にする規約の表現と検証が不足。
- M3: childごとの成果物・テスト証跡・worktree/commitリンクがstatus/presentation契約に不足。

レビューでは、plan作成・実装は行われていない。

