# Issue #10 受入対応表

| ID | 要求 | WBS | 検証 | 証跡 |
|---|---|---|---|---|
| RQ-01〜05 | revision、入力、digest、fail-closed | W1/W2 | schema・bundle・digest test | review bundle/preflight |
| RQ-06〜08 | 承認、遷移、worktree分離 | W3/W4 | gate・workflow・worktree test | state/audit/child result |
| RQ-09〜11 | 認証、C2C、結果不明復旧 | W3 | adapter/recovery contract test | operation checkpoint |
| RQ-12 | 正常・負系・fixture再現性 | W5 | npm test・fixture validation | test output |

未実施の live E2E は `HUMAN_DECISION` として扱う。
