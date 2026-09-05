from __future__ import annotations

import argparse
import json
from pathlib import Path

from .contracts import ApprovalPayload
from .change_control import complete_post_review, record_change, record_emergency_change, record_retest_scope, resolve_change
from .github_issue import GitHubIssueTransport
from .issue_guard import approve_final_payload, approve_payload, prepare_payload, publish_payload
from .issue_state import load_state, transition_state
from .onboarding import run_onboarding


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ai-workflow")
    subparsers = parser.add_subparsers(dest="command", required=True)
    onboard = subparsers.add_parser("onboard")
    onboard.add_argument("--product", type=Path, required=True)
    onboard.add_argument("--master", required=True)
    onboard.add_argument("--ref", default="HEAD")
    onboard.add_argument("--managed", nargs="+", required=True)
    for name in ("prepare", "approve", "final-approve", "skip-grilling", "publish", "retry", "record-change", "resolve-change", "emergency-change", "retest-scope", "complete-post-review"):
        command = subparsers.add_parser(name)
        command.add_argument("--product", type=Path, required=True)
        command.add_argument("--theme-id", required=True)
        command.add_argument("--spec-version", required=True)
        if name in {"prepare", "approve", "final-approve", "publish"}:
            command.add_argument("--repository", required=True)
            command.add_argument("--title", required=True)
            command.add_argument("--body", required=True)
            command.add_argument("--issue-number", type=int)
            command.add_argument("--label", action="append", default=[])
            command.add_argument("--link", action="append", default=[])
        if name == "retry":
            command.add_argument("--repository", required=True)
            command.add_argument("--issue-number", type=int)
            command.add_argument("--title", required=True)
            command.add_argument("--body", required=True)
        if name == "record-change":
            command.add_argument("--category", required=True)
            command.add_argument("--reason", required=True)
            command.add_argument("--impact", required=True)
        if name in {"resolve-change", "retest-scope", "complete-post-review"}:
            command.add_argument("--index", type=int, required=True)
            command.add_argument("--actor", required=True)
        if name == "resolve-change":
            command.add_argument("--approved", action="store_true")
            command.add_argument("--wording", required=True)
        if name == "retest-scope":
            command.add_argument("--scope", required=True)
        if name == "complete-post-review":
            command.add_argument("--wording", required=True)
        if name == "emergency-change":
            command.add_argument("--reason", required=True)
            command.add_argument("--impact", required=True)
            command.add_argument("--actor", required=True)
    approve = subparsers.choices["approve"]
    approve.add_argument("--approver", required=True)
    approve.add_argument("--wording", required=True)
    final_approve = subparsers.choices["final-approve"]
    final_approve.add_argument("--approver", required=True)
    final_approve.add_argument("--wording", required=True)
    skip = subparsers.choices["skip-grilling"]
    skip.add_argument("--confirm-skip", action="store_true")
    skip.add_argument("--actor", required=True)
    skip.add_argument("--reason", required=True)
    skip.add_argument("--risk", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "onboard":
        print(json.dumps(run_onboarding(product_root=args.product, master_url=args.master, ref=args.ref, managed_paths=args.managed), ensure_ascii=False, indent=2))
        return 0
    if args.command == "record-change":
        print(json.dumps(record_change(args.product, args.category, args.reason, args.impact, args.spec_version), ensure_ascii=False, indent=2))
        return 0
    if args.command == "resolve-change":
        print(json.dumps(resolve_change(args.product, args.index, args.approved, args.actor, args.wording), ensure_ascii=False, indent=2))
        return 0
    if args.command == "emergency-change":
        print(json.dumps(record_emergency_change(args.product, args.reason, args.impact, args.spec_version, args.actor), ensure_ascii=False, indent=2))
        return 0
    if args.command == "retest-scope":
        print(json.dumps(record_retest_scope(args.product, args.index, args.scope, args.actor), ensure_ascii=False, indent=2))
        return 0
    if args.command == "complete-post-review":
        print(json.dumps(complete_post_review(args.product, args.index, args.actor, args.wording), ensure_ascii=False, indent=2))
        return 0
    state = load_state(args.product, args.theme_id, args.spec_version)
    payload = None
    if args.command in {"prepare", "approve", "final-approve", "publish"}:
        payload = ApprovalPayload(
            theme_id=args.theme_id,
            spec_version=args.spec_version,
            repository=args.repository,
            issue_number=args.issue_number,
            title=args.title,
            body=args.body,
            labels=tuple(args.label),
            links=tuple(args.link),
        )
    if args.command == "skip-grilling":
        if not args.confirm_skip:
            print("Grillingをスキップし、未実施のまま正式Issue作成へ進みます。仕様承認・記録・対応確認は別途必須です。")
            return 2
        state = transition_state(args.product, state, "grilling_skipped", actor=args.actor, reason=args.reason, risk=args.risk, confirmation=True)
    elif args.command == "approve":
        state = approve_payload(args.product, state, payload, args.approver, args.wording)
    elif args.command == "final-approve":
        state = approve_final_payload(args.product, state, args.approver, args.wording)
    elif args.command == "prepare":
        state = prepare_payload(args.product, state, payload, GitHubIssueTransport())
    elif args.command == "publish":
        state = publish_payload(args.product, state, GitHubIssueTransport(), payload)
    elif args.command == "retry":
        if state.stage not in {"publish_failed", "label_sync_failed"}:
            raise SystemExit("retry is only available after a recorded publish failure")
        transport = GitHubIssueTransport()
        issue_number = args.issue_number
        if issue_number is None:
            existing = transport.find_matching_issue(args.repository, args.theme_id, args.spec_version)
            issue_number = existing.number if existing is not None else None
        if issue_number is not None:
            remote = transport.read_issue(args.repository, issue_number)
        else:
            remote = None
        retry_payload = ApprovalPayload(args.theme_id, args.spec_version, args.repository, args.issue_number, args.title, args.body)
        if remote is not None and (remote.title != retry_payload.title or remote.body != retry_payload.rendered_body):
            raise SystemExit("remote Issue changed; re-fetch and re-approve before retry")
        state = transition_state(args.product, state, "ready_to_publish", retry_issue_number=issue_number)
    print(json.dumps(state.as_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
