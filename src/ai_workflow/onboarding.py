from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .git_source import clone_at_commit, install_managed_files
from .git_source import validate_managed_path
from .persistence import write_json_atomically
from .persistence import calculate_file_sha256


def rollback_installed_files(product_root: Path, files: list[str]) -> None:
    for relative_path in files:
        (product_root / relative_path).unlink(missing_ok=True)


def run_onboarding(
    *, product_root: Path, master_url: str, ref: str, managed_paths: list[str]
) -> dict[str, Any]:
    evidence_path = product_root / ".ai-workflow" / "onboarding.json"
    temporary_directory = None
    snapshot = None
    try:
        source_root, resolved_commit, temporary_directory = clone_at_commit(master_url, ref)
        manifest_path = source_root / ".ai-workflow" / "managed-manifest.json"
        if not manifest_path.is_file():
            raise ValueError("master manifest is missing: .ai-workflow/managed-manifest.json")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest.get("files"), list) or not manifest["files"]:
            raise ValueError("master manifest must declare a non-empty files list")
        managed_paths = [str(path) for path in manifest["files"]]
        for path in managed_paths:
            validate_managed_path(path)
        required_prefixes = (".agents/", ".ai-workflow/managed/prompts/", ".ai-workflow/managed/templates/", ".github/")
        if not all(any(path.startswith(prefix) for path in managed_paths) for prefix in required_prefixes):
            raise ValueError("master manifest is incomplete: required managed categories are missing")
        snapshot = install_managed_files(source_root, product_root, managed_paths)
        snapshot = snapshot.__class__(master_url, ref, resolved_commit, snapshot.files)
        for relative_path, expected_hash in snapshot.files:
            installed = product_root / relative_path
            if not installed.is_file() or calculate_file_sha256(installed) != expected_hash:
                raise ValueError(f"post-install validation failed: {relative_path}")
        evidence = {
            "status": "completed",
            "source_url": master_url,
            "requested_ref": ref,
            "resolved_commit": resolved_commit,
            "installed_files": [{"path": path, "sha256": digest} for path, digest in snapshot.files],
            "conflicts": [],
            "validation": "passed",
            "human_actions": [],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as error:
        if snapshot is not None:
            rollback_installed_files(product_root, [relative_path for relative_path, _ in snapshot.files])
        evidence = {
            "status": "failed",
            "source_url": master_url,
            "requested_ref": ref,
            "resolved_commit": locals().get("resolved_commit"),
            "conflicts": [str(error)] if isinstance(error, FileExistsError) else [],
            "installed_files": [],
            "validation": "not_completed",
            "error": str(error),
            "next_action": "resolve the failure and rerun onboarding",
            "rollback": "completed for files copied by this attempt",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        write_json_atomically(evidence_path, evidence)
        raise
    finally:
        if temporary_directory is not None:
            temporary_directory.cleanup()
    write_json_atomically(evidence_path, evidence)
    return evidence
