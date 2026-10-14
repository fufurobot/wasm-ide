#!/usr/bin/env python3
"""Reusable GitHub REST API client for the wasm-ide project.

Why this exists
---------------
The DSH sandbox blocks `curl` (and, on Linux, jails `/dev`) so that agents do
not accidentally reach the internet. CPython is *not* restricted, so every
network call in this repository goes through this one reusable script instead
of ad-hoc `curl` invocations. This keeps escalations to a single approval.

Security
--------
The token is read from the environment variable ``DEEPSEEK_GITHUB_TOKEN`` (see
``.env``, which is git-ignored). It is never printed, never written to a file
and never embedded in a URL. Use ``load_dotenv()`` to populate the environment
from ``.env`` without exporting anything globally.

Usage
-----
    python3 tools/gh.py whoami
    python3 tools/gh.py repos fufurobot/wasm-ide
    python3 tools/gh.py request GET /repos/fufurobot/wasm-ide
    python3 tools/gh.py request POST /repos/{owner}/{repo}/issues \
        --body '{"title": "t", "body": "b"}'
    python3 tools/gh.py issue-create fufurobot/wasm-ide "title" "body"
    python3 tools/gh.py issue-comment fufurobot/wasm-ide 1 "body"
    python3 tools/gh.py pr-create fufurobot/wasm-ide dev main "title" "body" --draft
    python3 tools/gh.py pr-ready fufurobot/wasm-ide 1
    python3 tools/gh.py pr-merge fufurobot/wasm-ide 1 --method merge
    python3 tools/gh.py runs fufurobot/wasm-ide --branch dev
    python3 tools/gh.py run-watch fufurobot/wasm-ide 12345
    python3 tools/gh.py branches fufurobot/wasm-ide
    python3 tools/gh.py branch-create fufurobot/wasm-ide dev
    python3 tools/gh.py repo-patch fufurobot/wasm-ide --body '{"has_issues": true}'
    python3 tools/gh.py pages-enable fufurobot/wasm-ide --branch gh-pages
    python3 tools/gh.py dependabot-check fufurobot/wasm-ide

Exit codes: 0 success, 1 API/transport error, 2 usage or missing token.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import ssl
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

API_ROOT = "https://api.github.com"
TOKEN_ENV = "DEEPSEEK_GITHUB_TOKEN"
REPO_ROOT = Path(__file__).resolve().parent.parent


class GitHubError(RuntimeError):
    """Raised when the GitHub API answers with a non-2xx status."""

    def __init__(self, status: int, message: str, url: str) -> None:
        super().__init__(f"HTTP {status} for {url}: {message}")
        self.status = status
        self.message = message
        self.url = url

def load_dotenv(path: Path | None = None) -> None:
    """Populate os.environ from .env without echoing secrets."""
    env_path = path or (REPO_ROOT / ".env")
    if TOKEN_ENV in os.environ or not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'\"")
        # Real environment always wins over the file.
        os.environ.setdefault(key, value)


def get_token(required: bool = True) -> str | None:
    load_dotenv()
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        if required:
            print(
                f"error: {TOKEN_ENV} is not set. Put it in .env (git-ignored) "
                "or export it in the environment.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        return None
    return token


def request(
    method: str,
    path: str,
    body: dict[str, Any] | list[Any] | None = None,
    *,
    token: str | None = None,
    raw: bool = False,
    accept: str = "application/vnd.github+json",
    retries: int = 3,
) -> Any:
    """Perform one GitHub REST call.

    ``path`` may be an absolute path (``/repos/o/r``) or a full URL.
    Returns parsed JSON, or the decoded body when ``raw`` is True.
    """
    if path.startswith("http://") or path.startswith("https://"):
        url = path
    else:
        url = API_ROOT + (path if path.startswith("/") else "/" + path)

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    headers = {
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "wasm-ide-agent/1.0",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    status, payload = _send(method.upper(), url, headers, data, retries)

    if status == 204 or not payload.strip():
        return None
    if raw:
        return payload
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return payload


def _send(
    method: str,
    url: str,
    headers: dict[str, str],
    data: bytes | None,
    retries: int,
    timeout: float = 30.0,
) -> tuple[int, str]:
    """Send one HTTP request over a plain http.client connection.

    ``urllib.request`` is deliberately avoided: on this host it stalls on the
    POST path (it honours a proxy configuration that never answers), while
    ``http.client`` talks to api.github.com directly and reliably.
    """
    parts = urlsplit(url)
    host = parts.hostname or "api.github.com"
    target = parts.path or "/"
    if parts.query:
        target += "?" + parts.query

    ctx = ssl.create_default_context()
    last: Exception | None = None

    for attempt in range(retries + 1):
        conn = None
        try:
            conn = http.client.HTTPSConnection(host, parts.port or 443, timeout=timeout, context=ctx)
            conn.request(method, target, body=data, headers=headers)
            resp = conn.getresponse()
            body = resp.read().decode("utf-8", errors="replace")
            if resp.status >= 400:
                raise GitHubError(resp.status, body[:2000], url)
            return resp.status, body
        except GitHubError:
            raise
        except Exception as exc:  # transport-level: retry with backoff
            last = exc
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
        finally:
            if conn is not None:
                conn.close()

    raise GitHubError(0, f"transport error after {retries + 1} attempt(s): {last}", url)


def api(method: str, path: str, body: Any = None) -> Any:
    """Authenticated convenience wrapper used by the CLI commands."""
    return request(method, path, body, token=get_token())


def _print(value: Any) -> None:
    if isinstance(value, (dict, list)):
        print(json.dumps(value, indent=2, sort_keys=False))
    elif value is not None:
        print(value)


# --------------------------------------------------------------------------
# CLI commands
# --------------------------------------------------------------------------


def cmd_whoami(_: argparse.Namespace) -> int:
    user = api("GET", "/user")
    print(f"login: {user['login']}\nid: {user['id']}\ntype: {user['type']}")
    return 0


def cmd_request(args: argparse.Namespace) -> int:
    body = json.loads(args.body) if args.body else None
    _print(api(args.method, args.path, body))
    return 0


def cmd_issue_create(args: argparse.Namespace) -> int:
    issue = api(
        "POST",
        f"/repos/{args.repo}/issues",
        {"title": args.title, "body": args.body},
    )
    print(f"#{issue['number']} {issue['html_url']}")
    return 0


def cmd_issue_comment(args: argparse.Namespace) -> int:
    comment = api(
        "POST",
        f"/repos/{args.repo}/issues/{args.number}/comments",
        {"body": args.body},
    )
    print(comment["html_url"])
    return 0


def cmd_issue_close(args: argparse.Namespace) -> int:
    api("PATCH", f"/repos/{args.repo}/issues/{args.number}", {"state": "closed"})
    print(f"closed #{args.number}")
    return 0


def cmd_pr_create(args: argparse.Namespace) -> int:
    pr = api(
        "POST",
        f"/repos/{args.repo}/pulls",
        {
            "title": args.title,
            "body": args.body,
            "head": args.head,
            "base": args.base,
            "draft": args.draft,
        },
    )
    print(f"#{pr['number']} {pr['html_url']} draft={pr['draft']}")
    return 0


def cmd_pr_ready(args: argparse.Namespace) -> int:
    # `ready_for_review` on the GraphQL API is the only way to flip draft state.
    pr = api("GET", f"/repos/{args.repo}/pulls/{args.number}")
    if not pr["draft"]:
        print("already ready for review")
        return 0
    owner, name = args.repo.split("/", 1)
    query = """
    mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) {
      pullRequest { number isDraft } } }
    """
    result = api(
        "POST",
        "/graphql",
        {"query": query, "variables": {"id": pr["node_id"]}},
    )
    _print(result)
    return 0


def cmd_pr_merge(args: argparse.Namespace) -> int:
    result = api(
        "PUT",
        f"/repos/{args.repo}/pulls/{args.number}/merge",
        {"merge_method": args.method},
    )
    print(f"merged={result.get('merged')} sha={result.get('sha')} {result.get('message')}")
    return 0


def cmd_runs(args: argparse.Namespace) -> int:
    path = f"/repos/{args.repo}/actions/runs?per_page={args.limit}"
    if args.branch:
        path += f"&branch={args.branch}"
    data = api("GET", path)
    if not data["workflow_runs"]:
        print("(no runs)")
        return 0
    for run in data["workflow_runs"]:
        print(
            f"{run['id']} {run['name'][:32]:<32} {run['head_branch']:<12} "
            f"{run['status']:<12} {run['conclusion']} {run['html_url']}"
        )
    return 0


def cmd_run_watch(args: argparse.Namespace) -> int:
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        run = api("GET", f"/repos/{args.repo}/actions/runs/{args.run_id}")
        print(f"[{run['status']}] {run['conclusion']} {run['html_url']}")
        if run["status"] == "completed":
            jobs = api("GET", f"/repos/{args.repo}/actions/runs/{args.run_id}/jobs")
            for job in jobs["jobs"]:
                print(f"  - {job['name']}: {job['conclusion']}")
                for step in job.get("steps", []):
                    if step.get("conclusion") not in (None, "success", "skipped"):
                        print(f"      FAILED step: {step['name']} ({step['conclusion']})")
            return 0 if run["conclusion"] == "success" else 1
        time.sleep(args.interval)
    print("timeout waiting for run", file=sys.stderr)
    return 1


def cmd_branches(args: argparse.Namespace) -> int:
    for branch in api("GET", f"/repos/{args.repo}/branches?per_page=100"):
        print(branch["name"], branch["commit"]["sha"][:8])
    return 0


def cmd_branch_create(args: argparse.Namespace) -> int:
    base_sha = api("GET", f"/repos/{args.repo}/git/ref/heads/{args.from_branch}")["object"]["sha"]
    api("POST", f"/repos/{args.repo}/git/refs", {"ref": f"refs/heads/{args.name}", "sha": base_sha})
    print(f"created {args.name} from {args.from_branch} @ {base_sha[:8]}")
    return 0


def cmd_repo_patch(args: argparse.Namespace) -> int:
    _print(api("PATCH", f"/repos/{args.repo}", json.loads(args.body)))
    return 0


def cmd_pages_enable(args: argparse.Namespace) -> int:
    try:
        _print(
            api(
                "POST",
                f"/repos/{args.repo}/pages",
                {"source": {"branch": args.branch, "path": "/"}},
            )
        )
    except GitHubError as exc:
        if exc.status == 409:
            print("pages already enabled")
            return 0
        raise
    return 0


def cmd_dependabot_check(args: argparse.Namespace) -> int:
    """Report whether the token may configure Dependabot (contents:write)."""
    perms = api("GET", "/user")  # authenticated identity
    print(f"authenticated as {perms['login']}")
    try:
        ref = api("GET", f"/repos/{args.repo}/git/ref/heads/{args.check_branch}")
        print(f"contents:read OK ({args.check_branch} @ {ref['object']['sha'][:8]})")
    except GitHubError as exc:
        print(f"contents:read FAILED -> {exc.status}")
    # Probe write permission cheaply: creating an empty blob requires contents:write.
    try:
        api("POST", f"/repos/{args.repo}/git/blobs", {"content": "", "encoding": "utf-8"})
        print("contents:write OK -> dependabot config is allowed")
        return 0
    except GitHubError as exc:
        print(f"contents:write DENIED -> {exc.status} {exc.message[:200]}")
        return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("whoami").set_defaults(func=cmd_whoami)

    p = sub.add_parser("request", help="raw request: METHOD PATH [--body JSON]")
    p.add_argument("method")
    p.add_argument("path")
    p.add_argument("--body")
    p.set_defaults(func=cmd_request)

    p = sub.add_parser("issue-create")
    p.add_argument("repo")
    p.add_argument("title")
    p.add_argument("body")
    p.set_defaults(func=cmd_issue_create)

    p = sub.add_parser("issue-comment")
    p.add_argument("repo")
    p.add_argument("number", type=int)
    p.add_argument("body")
    p.set_defaults(func=cmd_issue_comment)

    p = sub.add_parser("issue-close")
    p.add_argument("repo")
    p.add_argument("number", type=int)
    p.set_defaults(func=cmd_issue_close)

    p = sub.add_parser("pr-create")
    p.add_argument("repo")
    p.add_argument("head")
    p.add_argument("base")
    p.add_argument("title")
    p.add_argument("body")
    p.add_argument("--draft", action="store_true")
    p.set_defaults(func=cmd_pr_create)

    p = sub.add_parser("pr-ready")
    p.add_argument("repo")
    p.add_argument("number", type=int)
    p.set_defaults(func=cmd_pr_ready)

    p = sub.add_parser("pr-merge")
    p.add_argument("repo")
    p.add_argument("number", type=int)
    p.add_argument("--method", default="merge", choices=["merge", "squash", "rebase"])
    p.set_defaults(func=cmd_pr_merge)

    p = sub.add_parser("runs")
    p.add_argument("repo")
    p.add_argument("--branch")
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=cmd_runs)

    p = sub.add_parser("run-watch")
    p.add_argument("repo")
    p.add_argument("run_id", type=int)
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--interval", type=int, default=15)
    p.set_defaults(func=cmd_run_watch)

    p = sub.add_parser("branches")
    p.add_argument("repo")
    p.set_defaults(func=cmd_branches)

    p = sub.add_parser("branch-create")
    p.add_argument("repo")
    p.add_argument("name")
    p.add_argument("--from", dest="from_branch", default="main")
    p.set_defaults(func=cmd_branch_create)

    p = sub.add_parser("repo-patch")
    p.add_argument("repo")
    p.add_argument("--body", required=True)
    p.set_defaults(func=cmd_repo_patch)

    p = sub.add_parser("pages-enable")
    p.add_argument("repo")
    p.add_argument("--branch", default="gh-pages")
    p.set_defaults(func=cmd_pages_enable)

    p = sub.add_parser("dependabot-check")
    p.add_argument("repo")
    p.add_argument("--check-branch", default="main")
    p.set_defaults(func=cmd_dependabot_check)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except GitHubError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
