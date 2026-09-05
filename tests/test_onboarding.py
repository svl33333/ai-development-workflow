from pathlib import Path

import pytest

from ai_workflow.git_source import install_managed_files
from ai_workflow.onboarding import rollback_installed_files
from ai_workflow import onboarding
import json


def test_conflict_does_not_overwrite_existing_file(tmp_path):
    source = tmp_path / "source"
    destination = tmp_path / "destination"
    (source / ".agents").mkdir(parents=True)
    (destination / ".agents").mkdir(parents=True)
    (source / ".agents" / "one.txt").write_text("new", encoding="utf-8")
    existing = destination / ".agents" / "one.txt"
    existing.write_text("old", encoding="utf-8")
    with pytest.raises(FileExistsError):
        install_managed_files(source, destination, [".agents/one.txt"])
    assert existing.read_text(encoding="utf-8") == "old"


def test_copy_failure_rolls_back_staged_files(tmp_path, monkeypatch):
    source = tmp_path / "source"
    destination = tmp_path / "destination"
    (source / ".agents").mkdir(parents=True)
    (source / ".github").mkdir(parents=True)
    (source / ".agents" / "one.txt").write_text("one", encoding="utf-8")
    (source / ".github" / "two.txt").write_text("two", encoding="utf-8")
    original_copy = __import__("shutil").copy2
    calls = {"count": 0}

    def fail_on_second(source_path, destination_path):
        calls["count"] += 1
        if calls["count"] == 2:
            raise OSError("simulated copy failure")
        return original_copy(source_path, destination_path)

    monkeypatch.setattr("ai_workflow.git_source.shutil.copy2", fail_on_second)
    with pytest.raises(OSError):
        install_managed_files(source, destination, [".agents/one.txt", ".github/two.txt"])
    assert not (destination / ".agents" / "one.txt").exists()


def test_post_validation_rollback_removes_all_installed_files(tmp_path):
    first = tmp_path / ".agents" / "one.txt"
    second = tmp_path / ".github" / "two.txt"
    first.parent.mkdir(parents=True)
    second.parent.mkdir(parents=True)
    first.write_text("one", encoding="utf-8")
    second.write_text("two", encoding="utf-8")
    rollback_installed_files(tmp_path, [".agents/one.txt", ".github/two.txt"])
    assert not first.exists() and not second.exists()


def test_onboarding_validation_failure_rolls_back_and_records_failure(tmp_path, monkeypatch):
    source = tmp_path / "master"
    manifest = json.loads(Path(".ai-workflow/managed-manifest.json").read_text(encoding="utf-8"))
    for relative_path in manifest["files"]:
        path = source / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("content", encoding="utf-8")
    manifest_file = source / ".ai-workflow" / "managed-manifest.json"
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    manifest_file.write_text(json.dumps(manifest), encoding="utf-8")
    class Cleanup:
        def cleanup(self): pass
    monkeypatch.setattr(onboarding, "clone_at_commit", lambda *args, **kwargs: (source, "abc123", Cleanup()))
    monkeypatch.setattr(onboarding, "calculate_file_sha256", lambda path: "mismatch")
    with pytest.raises(ValueError, match="post-install"):
        onboarding.run_onboarding(product_root=tmp_path / "product", master_url="https://github.com/o/r.git", ref="main", managed_paths=[])
    evidence = json.loads((tmp_path / "product" / ".ai-workflow" / "onboarding.json").read_text(encoding="utf-8"))
    assert evidence["status"] == "failed" and evidence["validation"] != "passed"
    assert not list((tmp_path / "product" / ".agents").rglob("*.*"))
