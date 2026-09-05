import pytest

from ai_workflow.adapters import CODEX_ADAPTER, COPILOT_ADAPTER
from ai_workflow.change_control import complete_post_review, record_change, record_emergency_change, resolve_change
from ai_workflow.issue_guard import prepare_payload
from ai_workflow.contracts import ApprovalPayload, WorkflowState


def test_scope_change_is_persisted_as_approval_required(tmp_path):
    record = record_change(tmp_path, "scope_change", "new feature", "new API", "v1")
    assert record["status"] == "approval_required"
    assert (tmp_path / ".codex" / "change-control.json").exists()


def test_codex_and_copilot_share_publish_contract():
    assert CODEX_ADAPTER.publish.__func__ is COPILOT_ADAPTER.publish.__func__


def test_skip_requires_explicit_confirmation():
    from ai_workflow.cli import main
    assert main(["skip-grilling", "--product", ".", "--theme-id", "issue-4", "--spec-version", "v1", "--actor", "u", "--reason", "r", "--risk", "risk"]) == 2


def test_unresolved_scope_change_blocks_prepare(tmp_path):
    record_change(tmp_path, "scope_change", "new feature", "new API", "v1")
    with pytest.raises(ValueError, match="requires approval"):
        prepare_payload(tmp_path, WorkflowState("issue-4", "v1", stage="spec_approved"), ApprovalPayload("issue-4", "v1", "owner/repo", None, "t", "b"))


def test_emergency_change_stays_blocked_until_post_review(tmp_path):
    record_emergency_change(tmp_path, "security incident", "temporary mitigation", "v1", "user")
    with pytest.raises(ValueError, match="requires approval"):
        prepare_payload(tmp_path, WorkflowState("issue-4", "v1", stage="spec_approved"), ApprovalPayload("issue-4", "v1", "owner/repo", None, "t", "b"))
    resolve_change(tmp_path, 0, True, "user", "approved emergency change")
    with pytest.raises(ValueError, match="requires approval"):
        prepare_payload(tmp_path, WorkflowState("issue-4", "v1", stage="spec_approved"), ApprovalPayload("issue-4", "v1", "owner/repo", None, "t", "b"))
    complete_post_review(tmp_path, 0, "reviewer", "reviewed")
    prepare_payload(tmp_path, WorkflowState("issue-4", "v1", stage="spec_approved"), ApprovalPayload("issue-4", "v1", "owner/repo", None, "t", "b"))
