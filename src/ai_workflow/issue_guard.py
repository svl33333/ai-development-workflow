from __future__ import annotations

import json
import os
import time
from dataclasses import replace
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Protocol

from .contracts import ApprovalPayload, WorkflowState
from .issue_state import transition_state
from .persistence import calculate_sha256


def _assert_no_unresolved_changes(product_root: Path) -> None:
    change_path = product_root / ".codex" / "change-control.json"
    if change_path.exists():
        changes = json.loads(change_path.read_text(encoding="utf-8")).get("changes", [])
        if any(change.get("status") == "approval_required" or change.get("post_review_status") != "completed" and change.get("post_review_required") for change in changes):
            raise ValueError("unresolved scope or constraint change requires approval")


class IssueTransport(Protocol):
    def read_issue(self, repository: str, number: int): ...
    def create_issue(self, repository: str, title: str, body: str): ...
    def update_issue(self, repository: str, number: int, title: str, body: str): ...
    def sync_labels(self, repository: str, number: int, labels: tuple[str, ...]) -> None: ...

    def find_matching_issue(self, repository: str, theme_id: str, spec_version: str): ...


@contextmanager
def acquire_publish_lock(product_root: Path) -> Iterator[None]:
    """同一製品での公開を一度に一つへ制限する。"""
    lock_path = product_root / ".codex" / "workflow-publish.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            descriptor = lock_path.open("x", encoding="utf-8")
            descriptor.write(json.dumps({"pid": os.getpid(), "started_at": time.time()}))
            descriptor.flush()
            break
        except FileExistsError as error:
            try:
                lock = json.loads(lock_path.read_text(encoding="utf-8"))
                if time.time() - float(lock.get("started_at", 0)) > 900:
                    lock_path.unlink(missing_ok=True)
                    continue
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                pass
            raise ValueError("another publish operation is already running") from error
    try:
        yield
    finally:
        descriptor.close()
        lock_path.unlink(missing_ok=True)


def prepare_payload(product_root: Path, state: WorkflowState, payload: ApprovalPayload, transport: IssueTransport | None = None) -> WorkflowState:
    _assert_no_unresolved_changes(product_root)
    if state.stage != "spec_approved":
        raise ValueError("specification approval is required before prepare")
    prepared_payload = {"payload": payload.as_dict(), "sha256": calculate_sha256(payload.as_dict()), "prepared_revision": state.revision}
    if payload.issue_number is not None and transport is not None:
        remote = transport.read_issue(payload.repository, payload.issue_number)
        prepared_payload.update({"expected_remote_title": remote.title, "expected_remote_body_hash": calculate_sha256(remote.body), "expected_repository": payload.repository, "expected_issue_number": payload.issue_number})
    prepared = replace(state, prepared_payload=prepared_payload)
    return transition_state(product_root, prepared, "ready_to_publish", payload_hash=prepared.prepared_payload["sha256"])


def approve_payload(product_root: Path, state: WorkflowState, payload: ApprovalPayload, approver: str, wording: str) -> WorkflowState:
    if state.stage not in {"grilling_complete", "grilling_skipped"}:
        raise ValueError("grilling completion or explicit skip is required")
    approval = {"theme_id": payload.theme_id, "spec_version": payload.spec_version, "approver": approver, "approved_at": datetime.now(timezone.utc).isoformat(), "wording": wording, "payload_hash": calculate_sha256(payload.as_dict())}
    approved = replace(state, approval=approval)
    return transition_state(product_root, approved, "spec_approved", approval=approval)


def approve_final_payload(product_root: Path, state: WorkflowState, approver: str, wording: str) -> WorkflowState:
    if state.stage != "ready_to_publish" or not state.prepared_payload:
        raise ValueError("prepare must complete before final approval")
    state.final_approval = {"theme_id": state.theme_id, "spec_version": state.spec_version, "approver": approver, "approved_at": datetime.now(timezone.utc).isoformat(), "wording": wording, "payload_hash": state.prepared_payload["sha256"], "prepared_revision": state.prepared_payload.get("prepared_revision")}
    from .persistence import write_json_atomically
    from .issue_state import state_path
    unsigned = {key: value for key, value in state.as_dict().items() if key != "integrity_sha256"}
    state.integrity_sha256 = calculate_sha256(unsigned)
    write_json_atomically(state_path(product_root), state.as_dict())
    return state


def publish_payload(product_root: Path, state: WorkflowState, transport: IssueTransport, payload: ApprovalPayload) -> WorkflowState:
    with acquire_publish_lock(product_root):
        _assert_no_unresolved_changes(product_root)
        if state.stage != "ready_to_publish" or not state.approval or not state.final_approval or not state.prepared_payload:
            raise ValueError("publish approval is incomplete")
        payload_hash = calculate_sha256(payload.as_dict())
        if payload_hash != state.approval.get("payload_hash") or payload_hash != state.final_approval.get("payload_hash") or payload_hash != state.prepared_payload.get("sha256"):
            raise ValueError("approved payload does not match the publish payload")
        if state.published and not (state.last_failure and state.last_failure.get("kind") == "label_sync_failed"):
            raise ValueError("this specification has already been published")
        failed_issue_number = (state.last_failure or {}).get("issue_number")
        try:
            if state.last_failure and state.last_failure.get("kind") == "label_sync_failed" and failed_issue_number:
                issue = transport.read_issue(payload.repository, int(failed_issue_number))
                _assert_same_issue(issue, payload)
                transport.sync_labels(payload.repository, issue.number, payload.labels)
                published = replace(state, published={"issue_number": issue.number, "body_hash": calculate_sha256(payload.rendered_body)}, last_failure=None)
                return transition_state(product_root, published, "published", issue_number=issue.number, retried=True)
            issue_number = payload.issue_number or failed_issue_number
            if issue_number is None:
                find_matching_issue = getattr(transport, "find_matching_issue", None)
                existing = find_matching_issue(payload.repository, payload.theme_id, payload.spec_version) if find_matching_issue else None
                if existing is not None:
                    raise ValueError("matching issue already exists; refusing duplicate publication")
                issue = transport.create_issue(payload.repository, payload.title, payload.rendered_body)
            else:
                remote = transport.read_issue(payload.repository, int(issue_number))
                expected = state.prepared_payload
                if expected.get("expected_repository") != payload.repository or expected.get("expected_issue_number") != int(issue_number) or expected.get("expected_remote_title") != remote.title or expected.get("expected_remote_body_hash") != calculate_sha256(remote.body):
                    raise ValueError("remote issue changed since prepare; re-fetch and re-approve")
                issue = transport.update_issue(payload.repository, int(issue_number), payload.title, payload.rendered_body)
            published_info = {"issue_number": issue.number, "body_hash": calculate_sha256(payload.rendered_body)}
            try:
                transport.sync_labels(payload.repository, issue.number, payload.labels)
            except Exception as error:
                failed = replace(state, published=published_info, last_failure={"kind": "label_sync_failed", "error": str(error), "issue_number": issue.number, "external_state": "body_written"})
                transition_state(product_root, failed, "label_sync_failed", error=str(error), issue_number=issue.number)
                raise ValueError(f"label synchronization failed: {error}") from error
        except ValueError:
            raise
        except Exception as error:
            if failed_issue_number is None:
                try:
                    existing = transport.find_matching_issue(payload.repository, payload.theme_id, payload.spec_version)
                    if existing is not None:
                        _assert_same_issue(existing, payload)
                        recovered = replace(state, published={"issue_number": existing.number, "body_hash": calculate_sha256(payload.rendered_body)}, last_failure={"kind": "label_sync_failed", "error": str(error), "issue_number": existing.number, "external_state": "create_result_unknown"})
                        transition_state(product_root, recovered, "label_sync_failed", error=str(error), issue_number=existing.number, external_state="create_result_unknown")
                        raise ValueError("create result was unknown; matching remote Issue found, retry labels") from error
                except ValueError:
                    raise
                except Exception:
                    pass
            failed = replace(state, last_failure={"kind": "publish_failed", "error": str(error), "issue_number": failed_issue_number, "external_state": "unknown"})
            transition_state(product_root, failed, "publish_failed", error=str(error))
            raise
        published = replace(state, published={"issue_number": issue.number, "body_hash": calculate_sha256(payload.rendered_body)}, last_failure=None)
        return transition_state(product_root, published, "published", issue_number=issue.number)


def _assert_same_issue(issue: object, payload: ApprovalPayload) -> None:
    if calculate_sha256({"title": issue.title, "body": issue.body}) != calculate_sha256({"title": payload.title, "body": payload.rendered_body}):
        raise ValueError("remote issue changed; re-fetch and re-approve")
