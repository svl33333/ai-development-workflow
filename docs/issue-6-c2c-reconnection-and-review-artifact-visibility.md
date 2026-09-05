# Issue #6 正式仕様

## Scope

Issue #6は、導入先ワークスペースを正本とするC2C/Project/会話の復旧と、人間レビュー前の成果物提示を扱う。導入元masterのパスや接続情報は導入先へ継承しない。

## Identity

- C2C connection identity: workspace + canonical repository。branchは実行時コンテキストであり、branch変更だけでは接続を作り直さない。
- Project identity: generated unique identifier + workspace + repositoryの全一致。
- Issue identity: Issue作成前は`provisional_work_id`、作成後はrepository-scoped Issue identityを正本とする。
- Conversation identity: repository-scoped Issue identity + stage + role。別Issue・別工程・別roleの会話は自動再利用しない。

## Recovery

復旧順序は state → workspace/repository → existing C2C connection → Project → Issue/stage/role conversation → message reconciliation とする。既存接続の修復・再認証を優先し、別接続・別Project・別会話を推測して作成しない。不一致、metadata取得不能、resume不能、二重候補はBLOCKED/HUMAN_WAITINGとして停止する。

## Issue gate

`production_issue_creating`でIssueを作成し、`production_issue_waiting_review`でIssue本文を提示して人間確認を待つ。Issue presentation receiptと`production_issue_review` approvalなしに`production_planning`へ進めない。

## Review artifact presentation

仕様、Issue、実装計画、PR公開、マージの人間レビュー前に、ArtifactPresenterがroot内pathを検証し、実際の表示/open adapterの成功を確認してreceiptを発行する。receiptにはpresentation ID、path、kind、canonical revision、SHA-256 digest、時刻、方法、結果を保存する。表示成功なしの記録だけでは承認へ進めない。

承認にはpresentation ID、digest、canonical revision、Issue identityを不可変に結合する。承認作成時とゲート通過直前に再計算し、変更・不一致をstaleとして拒否する。ChatGPT内部レビューはユーザー向け提示の対象外とする。

## Migration and validation

state schemaはversioned migrationを行い、migrationは決定的・冪等・fail-closedとする。serialize/readのround-trip、半migration、review_contextとconversation registryの不一致を検証する。

## Verification

正常系だけでなく、wrong workspace/repository/Project/Issue/stage/role、metadata取得不能、non-resumable conversation、presentation failure、artifact変更、承認後変更、ambiguous deliveryをテストし、無断fallbackなしに停止することを確認する。
