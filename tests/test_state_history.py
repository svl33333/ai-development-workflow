import json

import pytest

from ai_workflow.contracts import WorkflowState
from ai_workflow.issue_state import load_state, transition_state


def test_history_chain_tampering_is_rejected(tmp_path):
    state = transition_state(tmp_path, WorkflowState("issue-4", "v1"), "grilling_skipped", actor="user")
    path = tmp_path / ".codex" / "workflow-state.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["history"][0]["actor"] = "attacker"
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError, match="verification"):
        load_state(tmp_path, "issue-4", "v1")
