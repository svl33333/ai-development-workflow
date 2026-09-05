from __future__ import annotations

import hashlib
import json
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
