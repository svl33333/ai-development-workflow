from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .contracts import ApprovalPayload, WorkflowState
from .issue_guard import IssueTransport, publish_payload


@dataclass(frozen=True)
class WorkflowAdapter:
    name: str

    def publish(self, product_root: Path, state: WorkflowState, transport: IssueTransport, payload: ApprovalPayload) -> WorkflowState:
        return publish_payload(product_root, state, transport, payload)


CODEX_ADAPTER = WorkflowAdapter("codex")
COPILOT_ADAPTER = WorkflowAdapter("copilot")
