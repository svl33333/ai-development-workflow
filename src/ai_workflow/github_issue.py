from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RemoteIssue:
    repository: str
    number: int
    title: str
    body: str
    labels: tuple[str, ...]


class GitHubIssueTransport:
    """Issueのread/create/update/label-syncだけを公開する限定transport。"""

    def _api(self, *args: str, input_value: str | None = None) -> dict[str, Any]:
        completed = subprocess.run(
            ["gh", "api", *args], input=input_value, capture_output=True, text=True, check=False
        )
        if completed.returncode:
            raise RuntimeError(completed.stderr.strip() or "GitHub API request failed")
        return json.loads(completed.stdout)

    def read_issue(self, repository: str, number: int) -> RemoteIssue:
        raw = self._api(f"repos/{repository}/issues/{number}")
        return RemoteIssue(repository, number, raw["title"], raw.get("body") or "", tuple(label["name"] for label in raw.get("labels", [])))

    def find_matching_issue(self, repository: str, theme_id: str, spec_version: str) -> RemoteIssue | None:
        query = f'repo:{repository} in:body "ai-workflow:{theme_id}:{spec_version}"'
        raw = self._api("search/issues", "--method", "GET", "-f", f"q={query}")
        items = raw.get("items", [])
        if not items:
            return None
        item = items[0]
        return RemoteIssue(repository, item["number"], item["title"], item.get("body") or "", tuple(label["name"] for label in item.get("labels", [])))

    def create_issue(self, repository: str, title: str, body: str) -> RemoteIssue:
        raw = self._api(f"repos/{repository}/issues", "--method", "POST", "--field", f"title={title}", "--field", f"body={body}")
        return RemoteIssue(repository, raw["number"], raw["title"], raw.get("body") or "", tuple(label["name"] for label in raw.get("labels", [])))

    def update_issue(self, repository: str, number: int, title: str, body: str) -> RemoteIssue:
        raw = self._api(f"repos/{repository}/issues/{number}", "--method", "PATCH", "--field", f"title={title}", "--field", f"body={body}")
        return RemoteIssue(repository, number, raw["title"], raw.get("body") or "", tuple(label["name"] for label in raw.get("labels", [])))

    def sync_labels(self, repository: str, number: int, labels: tuple[str, ...]) -> None:
        self._api(f"repos/{repository}/issues/{number}/labels", "--method", "PUT", "--input", "-", input_value=json.dumps({"labels": list(labels)}))
