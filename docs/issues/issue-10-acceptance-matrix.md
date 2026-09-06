# Issue #10 受入対応表

| ID | 受入対応 | Positive fixture / test | Negative fixture / test | 証跡 |
|---|---|---|---|---|
| RQ-01 | base・implementation・review revisionと許可metadata commit集合を分離して検証 | `review-contract.test.js` revision contract | 未許可commit・review head不一致 | review bundle / preflight result |
| RQ-02 | input path、hash basis、Git object ID、path scope、expected change scope、work identityを固定 | `review-contract.test.js` scope and identity | scope外変更・digest/object ID不一致 | bundle digest |
| RQ-03 | bundle後変更・重複・秘密情報・receipt不一致を送信前fail-closed | `review.test.js` preflight success | changed input、duplicate、secret、stale receipt | preflight audit |
| RQ-04 | 前回recordを再読込し、digest・round・finding ID・fix revision・rangeを実体照合 | `review-contract.test.js` re-review lineage | 欠落record、未知finding、未検証range | review record |
| RQ-05 | working-tree bytes、canonical UTF-8、Git SHA-1/SHA-256、binary、symlinkを区別 | `artifact-digest.test.js`; digest fixtures | symlink・非regular file | digest record |
| RQ-06 | aggregate申告ではなく実review群と人間承認receiptからplan gateを導出 | `workflow.test.js` approved record set | 3件の `NEEDS_WORK` がaggregate `APPROVE` を上書き | stage evidence |
| RQ-07 | named branch、durable exclusive lock、HEAD/branch/generation、recovery、cleanupを固定 | `worktree-manager.test.js` real Git fixture | parent共有、lock/branch衝突、dirty recovery | worktree record |
| RQ-08 | workflow stage/status/evidence chainを共通ハーネスで検証 | `workflow.test.js` transition matrix | stage skip、approval前implementation | state/audit |
| RQ-09 | GitHub auth failureはwriteせずauth_waiting、checkpointから再開 | `adapters.test.js`, `recovery.test.js` | 401 / auth expiry | operation record |
| RQ-10 | C2C disconnect/binding mismatchは送信せずconnection_waiting、二重送信なし | `adapters.test.js`, `recovery.test.js` | disconnect / wrong binding | operation record |
| RQ-11 | result unknownはremote照合なしに再createせずreuseまたはblocked | `external-operation.test.js` | remoteなし・key不一致 | recovery checkpoint |
| RQ-12 | clean checkout、positive/negative fixture、integrated test、live E2E未実施を明示 | `bootstrap-clean-checkout.test.js`, `npm run validate:fixtures` | validation失敗は非0終了 | execution record |

## Fixture coverage

- Positive schema fixtures: `fixtures/issue-10/state.json`, `digest.json`, `digest-binary.json`, `digest-git-sha256.json`。
- Negative contract cases are generated in tests so each case is checked against a real temporary Git repository; no external write or live E2E is performed.
- Clean checkout verification is `npm ci` → `npm test` → `npm run validate:fixtures`。`node_modules` は成果物に含めず、検証完了後に削除する。
- live E2E は認証情報を持たないため未実施。fixture／contract testを代替証跡とし、live E2Eを実施済みとは扱わない。

未実施の live E2E は `HUMAN_DECISION` として扱う。
