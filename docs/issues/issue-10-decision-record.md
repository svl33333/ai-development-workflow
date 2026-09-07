# Issue #10 decision record

- 優先順位は計画書の要求台帳を正本とし、Issue本文、既存仕様、計画の順に整合を確認する。
- 基準 revision に実装がないため W0 で新規構築する。
- Git object ID と custom SHA-256 digest は別フィールドにする。
- 外部操作と live E2E は fake/contract を完了条件の中心とし、外部 write・送信・merge はこのタスクでは行わない。
- 専用 worktree 作成は sandbox の `.git` lock 権限制約で失敗した。既存未追跡変更を保全するため、本タスクは単一実装として対象プロジェクト直下の新規ファイルだけを変更する。
