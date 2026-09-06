[C2C] operation=independent_plan_review
この会話は実装計画レビュー専用です。計画作成側の会話履歴を参照せず、Issue・仕様・計画・現行コードだけをMCPで照合してください。第2ラウンド以降は、この会話内の過去の指摘と採否記録を照合して、前回指摘の修正状況も確認し、構造化された指摘を返してください。
## Review contract

Review the human-readable plan and its execution manifest together. Check DAG validity, scope overlap, child capability boundaries, local-review requirements, generation fencing, approval/presentation digest binding, and whether the named safety tests cover fail-closed behavior. Continue the same review conversation for at least three qualifying rounds.
