from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .contracts import WorkflowState
from .persistence import calculate_sha256, load_json, write_json_atomically

ALLOWED_TRANSITIONS = {
    "draft": {"grilling", "grilling_skipped"},
    "grilling": {"grilling_complete", "grilling_skipped"},
    "grilling_complete": {"spec_approved"},
    "grilling_skipped": {"spec_approved"},
    "spec_approved": {"ready_to_publish"},
    "ready_to_publish": {"published", "publish_failed", "label_sync_failed"},
    "publish_failed": {"ready_to_publish"},
    "label_sync_failed": {"ready_to_publish"},
}


def state_path(product_root: Path) -> Path:
    return product_root / ".codex" / "workflow-state.json"


def load_state(product_root: Path, theme_id: str, spec_version: str) -> WorkflowState:
    path = state_path(product_root)
    if not path.exists():
        return WorkflowState(theme_id=theme_id, spec_version=spec_version)
    raw = load_json(path)
    if raw.get("theme_id") != theme_id or raw.get("spec_version") != spec_version:
        raise ValueError("state theme or specification version does not match")
    expected_digest = raw.get("integrity_sha256")
    unsigned = {key: value for key, value in raw.items() if key != "integrity_sha256"}
    if not expected_digest or calculate_sha256(unsigned) != expected_digest:
        raise ValueError("workflow state integrity verification failed; re-approval is required")
    previous_hash = None
    for event in raw.get("history", []):
        event_without_hash = {key: value for key, value in event.items() if key != "event_hash"}
        if event.get("event_hash") != calculate_sha256({"previous": previous_hash, **event_without_hash}):
            raise ValueError("workflow history chain verification failed; re-approval is required")
        previous_hash = event["event_hash"]
    return WorkflowState(**{key: raw[key] for key in WorkflowState.__dataclass_fields__ if key in raw})


def transition_state(product_root: Path, state: WorkflowState, next_stage: str, **event: Any) -> WorkflowState:
    if next_stage not in ALLOWED_TRANSITIONS.get(state.stage, set()):
        raise ValueError(f"invalid state transition: {state.stage} -> {next_stage}")
    state.stage = next_stage
    state.revision += 1
    state.updated_at = datetime.now(timezone.utc).isoformat()
    previous_hash = state.history[-1].get("event_hash") if state.history else None
    event_hash = calculate_sha256({"previous": previous_hash, "stage": next_stage, "at": state.updated_at, **event})
    state.history.append({"stage": next_stage, "at": state.updated_at, "event_hash": event_hash, **event})
    unsigned = {key: value for key, value in state.as_dict().items() if key != "integrity_sha256"}
    state.integrity_sha256 = calculate_sha256(unsigned)
    write_json_atomically(state_path(product_root), state.as_dict())
    return state
