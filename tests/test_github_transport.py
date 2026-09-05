from ai_workflow.github_issue import GitHubIssueTransport


def test_matching_issue_uses_explicit_get(monkeypatch):
    transport = GitHubIssueTransport()
    calls = []
    monkeypatch.setattr(transport, "_api", lambda *args, **kwargs: calls.append(args) or {"items": []})
    assert transport.find_matching_issue("owner/repo", "issue-4", "v1") is None
    assert calls == [("search/issues", "--method", "GET", "-f", 'q=repo:owner/repo in:body "ai-workflow:issue-4:v1"')]
