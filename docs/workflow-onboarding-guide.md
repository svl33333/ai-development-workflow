# 既存Codexプロジェクトへの導入ガイド

## 概要

既存のCodexプロジェクトへ、共通マスターのAI Development Workflowを導入する。導入処理は現在開いている対象プロジェクトで実行し、共通マスターのファイルを対象プロジェクトへ不足分だけ配置する。

ChatGPT Projectの作成だけはChatGPT側の人間操作が必要である。Project作成後に導入処理を再開し、Codex with ChatGPTで対象ワークスペース・リポジトリとの対応を確認する。

## 別PJTのCodexへ最初に送る指示

次の内容を、導入対象プロジェクトを開いたCodexへそのまま送る。

```text
このプロジェクトに、共通マスター
C:\Users\yuyab\Documents\ChatGPT\AI Development Workflow
のAI Development Workflowを導入してください。

対象は現在開いているプロジェクトです。

次の作業を行ってください。

1. 既存のコード・設定・Git状態を確認する
2. 共通マスターのworkflow-onboarding Skillを使用する
3. 次のコマンドで導入する

node "C:\Users\yuyab\Documents\ChatGPT\AI Development Workflow\bin\ai-workflow.js" onboard --product "<現在のプロジェクトの絶対パス>" --master "C:\Users\yuyab\Documents\ChatGPT\AI Development Workflow" --project-id "<プロジェクトID>" --base-name "<プロジェクト名>"

4. .ai-workflow/、不足しているSkills、プロンプト、テンプレートを導入する
5. 既存ファイルは上書きせず、競合があれば一覧化する
6. 導入結果を検証する
7. Prototype用とProduction用のChatGPT Project名を提示する

ChatGPT Projectは自動作成せず、作成が必要な場合は、正確なProject名と私が行う操作を一つだけ提示して停止してください。

導入結果、競合ファイル、検証結果、次に私が行う操作を日本語で報告してください。
```

`<現在のプロジェクトの絶対パス>`、`<プロジェクトID>`、`<プロジェクト名>`は、Codexに自動判定させてもよい。プロジェクト名を明示したい場合だけ置き換える。

## ChatGPT Project作成後の再開

Codexが提示した名前でChatGPT Projectを作成する。PrototypeとProductionを使う場合は、原則として2つ作成する。Project-only memoryを選択し、共通マスターが提示した名前を変更しない。

作成後、導入対象のCodexへ次を送る。

```text
ChatGPT Projectを指定された名前で作成しました。導入を続行してください。
```

Codexは次を確認してから導入完了とする。

- `.ai-workflow/onboarding.json`の状態
- ChatGPT Project名
- Codex with ChatGPTの接続状態
- 対象ワークスペース
- 対象リポジトリ
- `node bin/ai-workflow.js validate --product <対象プロジェクト>`の結果

## CLIを直接実行する場合

```powershell
node "C:\Users\yuyab\Documents\ChatGPT\AI Development Workflow\bin\ai-workflow.js" onboard `
  --product "C:\Projects\MyProduct" `
  --master "C:\Users\yuyab\Documents\ChatGPT\AI Development Workflow" `
  --project-id "my-product" `
  --base-name "My Product"
```

PrototypeまたはProductionだけを準備する場合は、次を追加する。

```powershell
--start prototype
```

または

```powershell
--start production
```

## 導入されるもの

- 対象プロジェクトの`.ai-workflow/`
- 不足しているプロジェクトローカルSkills
- プロンプト
- テンプレート
- ワークフロー定義と状態スキーマ
- `.ai-workflow/onboarding.json`

既存ファイルは上書きされない。既存ファイルと同じパスがある場合は、結果の`conflicting_files`に記録される。

## 導入完了後の利用

導入後は、対象プロジェクトのCodexで次のように依頼する。

```text
このプロジェクトにAI Development Workflowを導入済みです。
既存コードとドキュメントを確認し、prototypeから始めるべきか、本番grill-with-docsから始めるべきか判断してください。
状態と判断理由は.ai-workflow/に記録してください。
```

## 現時点の制約

- ChatGPT Projectの新規作成は自動化しない。
- ChatGPT Project作成後の接続確認にはCodex with ChatGPTの設定が必要。
- PR公開・マージ・資格情報登録は自動実行せず、人間承認を必要とする。
- 既存の同名ファイルは自動更新しない。共通マスター更新時は、競合内容を確認してから更新する。
