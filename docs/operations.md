# 運用手順

## 初期導入

`ai-workflow onboard --product <製品ルート> --master <GitHub URL> --ref <branch/tag/commit> --managed <相対パス...>` を実行する。

取得元と解決済みcommitは `.ai-workflow/onboarding.json` に記録される。競合や検証失敗時はコピーせず、成功状態も記録しない。

## Issue公開

正式Issueの操作は、状態ファイル `.codex/workflow-state.json` を唯一の判定材料とする。Grilling、仕様承認、公開payloadのhash、最終承認が揃わない限り、GitHub write transportを呼び出してはならない。

公開後の本文hashとIssue番号を記録し、ラベル同期の失敗は公開完了として扱わない。外部状態が不明な場合は、再公開前にIssueを読み直す。
