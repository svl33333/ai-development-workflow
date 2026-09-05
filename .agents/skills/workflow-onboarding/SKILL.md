---
name: workflow-onboarding
description: Introduce the shared AI development workflow into an existing Codex project, preserving existing files and stopping only for the human ChatGPT Project creation step.
---

# Workflow onboarding

Use this skill when the user asks to導入、セットアップ、初期設定、または既存のCodexプロジェクトへAI Development Workflowを追加する。

## Procedure

1. Identify the target product root and the workflow master root. Do not assume the current directory is the product.
2. Run the master CLI command:

   `node <master>/bin/ai-workflow.js onboard --product <product> --master <master>`

   Add `--project-id` when the repository's stable product ID is not its directory name. Use `--start prototype` or `--start production` when only one track is needed.
3. Read the JSON result and report validation errors and conflicting files. Never overwrite a conflicting target file automatically.
4. Show the exact `chatgpt_projects` names. Ask the user to create the requested ChatGPT Project(s) manually with those exact names and project-only memory. This is the only expected human setup stop.
5. After the user confirms creation, rerun the same onboarding command. Inspect the saved `.ai-workflow/onboarding.json`, then verify the Project/workspace/repository binding through Codex with ChatGPT before starting work.
6. Do not claim that the project is fully connected when only the local files were installed. A missing C2C adapter, Project binding, GitHub credential, or human approval is a fail-closed state.

## Safety

- The onboarding command is idempotent for managed files: existing files are reported as conflicts and are not overwritten.
- It writes only `.ai-workflow/` and missing project-local `.agents/skills/` files under the target product.
- It never creates a ChatGPT Project, stores tokens, publishes a PR, or merges code.
- Keep the target project's existing code, configuration, and unrelated untracked files untouched.
