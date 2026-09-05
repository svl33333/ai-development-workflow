from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .persistence import load_json, write_json_atomically


@dataclass(frozen=True)
class ChangeDecision:
    category: str
    can_continue: bool
    reason: str


def classify_change(category: str, changes_public_contract: bool = False) -> ChangeDecision:
    if category not in {"bug_fix", "clarification", "scope_change", "constraint_change"}:
        raise ValueError(f"unknown change category: {category}")
    can_continue = category in {"bug_fix", "clarification"} and not changes_public_contract
    reason = "continue with impact record" if can_continue else "stop and request re-approval"
    return ChangeDecision(category, can_continue, reason)


def record_change(product_root: Path, category: str, reason: str, impact: str, spec_version: str) -> dict[str, Any]:
    decision = classify_change(category, changes_public_contract=category in {"scope_change", "constraint_change"})
    path = product_root / ".codex" / "change-control.json"
    existing = load_json(path) if path.exists() else {"changes": []}
    record = {"category": category, "reason": reason, "impact": impact, "spec_version": spec_version, "status": "approved_to_continue" if decision.can_continue else "approval_required", "created_at": datetime.now(timezone.utc).isoformat(), "next_action": decision.reason}
    existing.setdefault("changes", []).append(record)
    write_json_atomically(path, existing)
    return record


def resolve_change(product_root: Path, index: int, approved: bool, actor: str, wording: str) -> dict[str, Any]:
    path = product_root / ".codex" / "change-control.json"
    state = load_json(path)
    record = state["changes"][index]
    record.update({"status": "approved" if approved else "rejected", "resolved_by": actor, "resolved_at": datetime.now(timezone.utc).isoformat(), "resolution": wording})
    write_json_atomically(path, state)
    return record


def record_emergency_change(product_root: Path, reason: str, impact: str, spec_version: str, actor: str) -> dict[str, Any]:
    record = record_change(product_root, "constraint_change", reason, impact, spec_version)
    record.update({"emergency": True, "actor": actor, "post_review_required": True, "post_review_status": "required"})
    path = product_root / ".codex" / "change-control.json"
    state = load_json(path)
    state["changes"][-1] = record
    write_json_atomically(path, state)
    return record


def record_retest_scope(product_root: Path, change_index: int, scope: str, actor: str) -> dict[str, Any]:
    path = product_root / ".codex" / "change-control.json"
    state = load_json(path)
    record = state["changes"][change_index]
    record["retest_scope"] = scope
    record["retest_recorded_by"] = actor
    write_json_atomically(path, state)
    return record


def complete_post_review(product_root: Path, change_index: int, actor: str, wording: str) -> dict[str, Any]:
    path = product_root / ".codex" / "change-control.json"
    state = load_json(path)
    record = state["changes"][change_index]
    record.update({"post_review_status": "completed", "post_review_by": actor, "post_review_at": datetime.now(timezone.utc).isoformat(), "post_review_wording": wording})
    write_json_atomically(path, state)
    return record
