from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ManagedFile:
    relative_path: str
    sha256: str


@dataclass(frozen=True)
class ApprovalPayload:
    theme_id: str
    spec_version: str
    repository: str
    issue_number: int | None
    title: str
    body: str
    labels: tuple[str, ...] = ()
    links: tuple[str, ...] = ()

    @property
    def identity_marker(self) -> str:
        return f"<!-- ai-workflow:{self.theme_id}:{self.spec_version} -->"

    @property
    def rendered_body(self) -> str:
        return self.body if self.identity_marker in self.body else f"{self.body}\n\n{self.identity_marker}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "theme_id": self.theme_id,
            "spec_version": self.spec_version,
            "repository": self.repository,
            "issue_number": self.issue_number,
            "title": self.title,
            "body": self.rendered_body,
            "labels": list(self.labels),
            "links": list(self.links),
        }


@dataclass
class WorkflowState:
    theme_id: str
    spec_version: str
    stage: str = "draft"
    grilling: dict[str, Any] | None = None
    approval: dict[str, Any] | None = None
    final_approval: dict[str, Any] | None = None
    prepared_payload: dict[str, Any] | None = None
    published: dict[str, Any] | None = None
    last_failure: dict[str, Any] | None = None
    revision: int = 0
    updated_at: str | None = None
    integrity_sha256: str | None = None
    history: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()
