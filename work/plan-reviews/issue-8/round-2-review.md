# Issue #8 実装計画レビュー 第2ラウンド

- Task: `c2c_i8p1`
- Round: 2/3
- Reviewer: ChatGPT（第1ラウンドと同じ独立レビュー会話）
- Verdict: `CHANGES_REQUIRED`
- Summary: Critical 0 / High 4 / Medium 3 / Low 0

## Findings

### High

- R2-H1: Python/Nodeの制御プレーン境界が未定義。専用bridge protocol（JSON入出力、終了コード、idempotency key）とruntime責務を明記する必要がある。
- R2-H2: prototypeの実装・評価がchild task/scheduler/integration経路に接続されていない。
- R2-H3: `accept revised scope` がIssue #4のchange-controlを迂回し得る。仕様変更はIssue #4へ委譲し、manifest内の範囲補正と区別する必要がある。
- R2-H4: successor generationにfencing tokenがなく、旧世代の遅延プロセスがchild起動・cancel・統合できる可能性がある。

### Medium

- R2-M1: childのCodexローカルレビューがintegration eligibilityの必須条件になっていない。
- R2-M2: migrationの安全停止条件が曖昧。running child、未完了review、pending approval等を明示した決定的predicateが必要。
- R2-M3: scope overrun時にdigestだけでなく、変更パス・差分参照・宣言scope・理由を人間が閲覧できる成果物として提示する必要がある。

第1ラウンドのH2/H3/H4/M1/M2/M3は計画上反映済みと判定された。

