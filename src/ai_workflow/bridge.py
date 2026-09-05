from __future__ import annotations

import hashlib
import json
from pathlib import Path
from dataclasses import dataclass

PROTOCOL_VERSION = 1
EXIT_OK = 0
EXIT_INVALID = 2
EXIT_CONFLICT = 3
EXIT_FAILED = 4


@dataclass(frozen=True)
class BridgeRequest:
    project_id: str
    work_id: str
    operation: str
    generation: int = 1
    request_id: str = ""

    def as_dict(self) -> dict[str, object]:
        payload = {
            "project_id": self.project_id,
            "work_id": self.work_id,
            "operation": self.operation,
            "generation": self.generation,
        }
        key = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        return {"protocol_version": PROTOCOL_VERSION, "request_id": self.request_id, "idempotency_key": key, **payload}


def dispatch(request: dict[str, object], handler) -> tuple[int, dict[str, object]]:
    if request.get("protocol_version") != PROTOCOL_VERSION:
        return EXIT_INVALID, {"ok": False, "error": "unsupported protocol version"}
    required = ("project_id", "work_id", "operation", "generation", "idempotency_key")
    if any(not request.get(key) for key in required):
        return EXIT_INVALID, {"ok": False, "error": "invalid bridge request"}
    try:
        return EXIT_OK, {"ok": True, **handler(request)}
    except Exception as error:  # pragma: no cover - caller-specific failures are serialized
        return getattr(error, "code", EXIT_FAILED), {"ok": False, "error": str(error)}


def handle_bridge_request(request: dict[str, object]) -> dict[str, object]:
    """Persist a lifecycle command so the Node orchestrator can consume it safely."""
    operation = request.get("operation")
    if operation not in {"ensure_orchestrator", "supersede_orchestrator", "issue_prepare", "issue_publish"}:
        raise ValueError(f"unsupported bridge operation: {operation}")
    product_path = request.get("product_path")
    if not product_path:
        raise ValueError("product_path is required for bridge operations")
    events_path = Path(str(product_path)) / ".ai-workflow" / "bridge-events.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)
    event = {"request_id": request.get("request_id"), "idempotency_key": request["idempotency_key"], "operation": operation, "generation": request["generation"]}
    existing = events_path.read_text(encoding="utf-8").splitlines() if events_path.exists() else []
    if not any(json.loads(line).get("idempotency_key") == event["idempotency_key"] for line in existing if line.strip()):
        with events_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")
    return {"accepted": True, "operation": operation, "event_path": str(events_path)}
