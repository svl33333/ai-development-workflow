import json
from pathlib import Path

import pytest

from ai_workflow.git_source import validate_managed_path


@pytest.mark.parametrize("path", ["C:/outside.txt", "/outside.txt", "../outside.txt", ".ai-workflow/../outside.txt", "src/app.py"])
def test_managed_path_boundary_is_fail_closed(path):
    with pytest.raises(ValueError):
        validate_managed_path(path)


def test_manifest_declares_all_managed_categories():
    manifest = json.loads(Path(".ai-workflow/managed-manifest.json").read_text(encoding="utf-8"))
    paths = manifest["files"]
    assert any(path.startswith(".agents/") for path in paths)
    assert any(path.startswith(".ai-workflow/managed/prompts/") for path in paths)
    assert any(path.startswith(".ai-workflow/managed/templates/") for path in paths)
    assert any(path.startswith(".github/") for path in paths)
