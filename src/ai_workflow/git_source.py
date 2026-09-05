from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath

from .persistence import calculate_file_sha256


@dataclass(frozen=True)
class SourceSnapshot:
    url: str
    requested_ref: str
    resolved_commit: str
    files: tuple[tuple[str, str], ...]


def _run_git(*args: str, cwd: Path | None = None) -> str:
    completed = subprocess.run(
        ["git", *args], cwd=cwd, check=False, capture_output=True, text=True
    )
    if completed.returncode:
        raise RuntimeError(completed.stderr.strip() or "git command failed")
    return completed.stdout.strip()


def clone_at_commit(url: str, ref: str) -> tuple[Path, str, tempfile.TemporaryDirectory[str]]:
    if not url.startswith(("https://", "ssh://", "git@")):
        raise ValueError("master URL must be a GitHub-compatible remote URL")
    temporary_directory = tempfile.TemporaryDirectory(prefix="ai-workflow-master-")
    checkout = Path(temporary_directory.name) / "master"
    _run_git("clone", "--filter=blob:none", url, str(checkout))
    commit = _run_git("rev-parse", ref, cwd=checkout)
    _run_git("checkout", "--detach", commit, cwd=checkout)
    return checkout, commit, temporary_directory


def install_managed_files(
    source_root: Path, destination_root: Path, managed_paths: list[str]
) -> SourceSnapshot:
    candidates = []
    for relative_path in sorted(set(managed_paths)):
        validate_managed_path(relative_path)
        source = source_root / relative_path
        if not source.is_file():
            raise FileNotFoundError(f"managed file does not exist: {relative_path}")
        candidates.append((relative_path, source))
    conflicts = [str(path) for relative, _ in candidates if (path := destination_root / relative).exists()]
    if conflicts:
        raise FileExistsError("conflicting files: " + ", ".join(conflicts))
    staging_root = Path(tempfile.mkdtemp(prefix="ai-workflow-install-", dir=destination_root.parent))
    try:
        for relative_path, source in candidates:
            staged = staging_root / relative_path
            staged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, staged)
        for relative_path, _ in candidates:
            destination = destination_root / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(staging_root / relative_path), str(destination))
    except Exception:
        for relative_path, _ in candidates:
            (destination_root / relative_path).unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)
    return SourceSnapshot(
        url="",
        requested_ref="",
        resolved_commit="",
        files=tuple((relative, calculate_file_sha256(source_root / relative)) for relative, _ in candidates),
    )


def validate_managed_path(relative_path: str) -> None:
    path = PurePosixPath(relative_path.replace("\\", "/"))
    allowed = path.as_posix().startswith((".agents/", ".ai-workflow/", ".github/"))
    if path.is_absolute() or ".." in path.parts or not allowed:
        raise ValueError(f"managed path is outside the allowed relative prefixes: {relative_path}")
