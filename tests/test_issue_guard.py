from pathlib import Path

import pytest

from ai_workflow.contracts import ApprovalPayload, WorkflowState
from ai_workflow.issue_guard import approve_final_payload, approve_payload, prepare_payload, publish_payload
from ai_workflow.issue_state import load_state


class FakeTransport:
    def __init__(self):
        self.calls = []

    def read_issue(self, repository, number):
        self.calls.append(("read", repository, number))
        return type("Issue", (), {"title": "title", "body": payload().rendered_body, "number": number})()

    def create_issue(self, repository, title, body):
        self.calls.append(("create", repository, title, body))
        return type("Issue", (), {"number": 7})()

    def update_issue(self, repository, number, title, body):
        self.calls.append(("update", repository, number, title, body))
        return type("Issue", (), {"number": number})()

    def sync_labels(self, repository, number, labels):
        self.calls.append(("labels", repository, number, labels))

    def find_matching_issue(self, repository, theme_id, spec_version):
        self.calls.append(("find", repository, theme_id, spec_version))
        return None


def payload():
    return ApprovalPayload("issue-4", "v1", "owner/repo", None, "title", "body", ("enhancement",))


def test_publish_is_fail_closed_before_approval(tmp_path: Path):
    transport = FakeTransport()
    with pytest.raises(ValueError):
        publish_payload(tmp_path, WorkflowState("issue-4", "v1"), transport, payload())
    assert transport.calls == []


def test_approved_payload_is_published_and_labeled(tmp_path: Path):
    state = WorkflowState("issue-4", "v1", stage="grilling_complete")
    state = approve_payload(tmp_path, state, payload(), "user", "approve")
    state = prepare_payload(tmp_path, state, payload())
    state = approve_final_payload(tmp_path, state, "user", "final approve")
    state = publish_payload(tmp_path, state, FakeTransport(), payload())
    assert state.stage == "published"


def test_changed_payload_is_rejected_before_api_call(tmp_path: Path):
    transport = FakeTransport()
    original = payload()
    state = approve_payload(tmp_path, WorkflowState("issue-4", "v1", stage="grilling_complete"), original, "user", "approve")
    state = prepare_payload(tmp_path, state, original)
    state = approve_final_payload(tmp_path, state, "user", "final approve")
    changed = ApprovalPayload("issue-4", "v1", "owner/repo", None, "changed", "body")
    with pytest.raises(ValueError):
        publish_payload(tmp_path, state, transport, changed)
    assert transport.calls == []


def test_tampered_state_is_rejected(tmp_path: Path):
    state = approve_payload(tmp_path, WorkflowState("issue-4", "v1", stage="grilling_complete"), payload(), "user", "approve")
    state = prepare_payload(tmp_path, state, payload())
    state_path = tmp_path / ".codex" / "workflow-state.json"
    raw = state_path.read_text(encoding="utf-8").replace('"stage": "ready_to_publish"', '"stage": "draft"')
    state_path.write_text(raw, encoding="utf-8")
    with pytest.raises(ValueError, match="integrity"):
        load_state(tmp_path, "issue-4", "v1")


def test_duplicate_matching_issue_is_rejected(tmp_path: Path):
    class DuplicateTransport(FakeTransport):
        def find_matching_issue(self, repository, theme_id, spec_version):
            self.calls.append(("find", repository, theme_id, spec_version))
            return object()

    original = payload()
    state = approve_payload(tmp_path, WorkflowState("issue-4", "v1", stage="grilling_complete"), original, "user", "approve")
    state = prepare_payload(tmp_path, state, original)
    state = approve_final_payload(tmp_path, state, "user", "final approve")
    transport = DuplicateTransport()
    with pytest.raises(ValueError, match="duplicate"):
        publish_payload(tmp_path, state, transport, original)
    assert transport.calls == [("find", "owner/repo", "issue-4", "v1")]


def test_label_failure_cli_retry_reuses_issue_and_syncs_labels_only(tmp_path, monkeypatch):
    from ai_workflow import cli
    class PartialTransport(FakeTransport):
        def __init__(self):
            super().__init__()
            self.issue = type("Issue", (), {"number": 9, "title": "title", "body": payload().rendered_body})()
            self.fail_once = True
        def read_issue(self, repository, number):
            self.calls.append(("read", repository, number))
            return self.issue
        def create_issue(self, repository, title, body):
            self.calls.append(("create", repository, title, body))
            return self.issue
        def sync_labels(self, repository, number, labels):
            self.calls.append(("labels", repository, number, labels))
            if self.fail_once:
                self.fail_once = False
                raise RuntimeError("temporary")

    transport = PartialTransport()
    monkeypatch.setattr(cli, "GitHubIssueTransport", lambda: transport)
    original = payload()
    state = approve_payload(tmp_path, WorkflowState("issue-4", "v1", stage="grilling_complete"), original, "user", "approve")
    state = prepare_payload(tmp_path, state, original)
    state = approve_final_payload(tmp_path, state, "user", "final approve")
    with pytest.raises(ValueError, match="label synchronization"):
        publish_payload(tmp_path, state, transport, original)
    assert load_state(tmp_path, "issue-4", "v1").published["issue_number"] == 9
    assert cli.main(["retry", "--product", str(tmp_path), "--theme-id", "issue-4", "--spec-version", "v1", "--repository", "owner/repo", "--issue-number", "9", "--title", "title", "--body", "body"]) == 0
    retry_state = load_state(tmp_path, "issue-4", "v1")
    published = publish_payload(tmp_path, retry_state, transport, original)
    assert published.stage == "published"
    assert sum(call[0] == "create" for call in transport.calls) == 1


def test_unknown_create_result_recovers_matching_remote_issue(tmp_path):
    class UnknownCreateTransport(FakeTransport):
        def __init__(self):
            super().__init__()
            self.issue = type("Issue", (), {"number": 11, "title": "title", "body": payload().rendered_body})()
        def create_issue(self, *args):
            self.calls.append(("create",))
            raise TimeoutError("response lost")
        def find_matching_issue(self, *args):
            self.calls.append(("find",))
            return None if self.calls.count(("find",)) == 1 else self.issue
        def read_issue(self, *args):
            self.calls.append(("read",))
            return self.issue
    original = payload()
    transport = UnknownCreateTransport()
    with pytest.raises(ValueError, match="unknown"):
        state = approve_payload(tmp_path, WorkflowState("issue-4", "v1", stage="grilling_complete"), original, "user", "approve")
        state = prepare_payload(tmp_path, state, original)
        state = approve_final_payload(tmp_path, state, "user", "final approve")
        publish_payload(tmp_path, state, transport, original)
    assert load_state(tmp_path, "issue-4", "v1").published["issue_number"] == 11
    assert sum(call[0] == "create" for call in transport.calls) == 1
