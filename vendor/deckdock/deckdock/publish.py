"""Publish compiled DeckDock editions to a hub. Standard library only.

The single implementation behind `deckdock publish` and the Action's `publish` command
(action/publish.py imports this module from the Action's checkout, without installing anything).

For each <dist>/<edition>/ containing deck.json, the edition directory is archived as tar.gz
(members relative to the edition directory: deck.json, media/...) and POSTed to
<hub>/api/publish/<edition> with the deck's bearer token. Stops at the first failed edition.
"""

import io
import json
import os
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import urllib.response
from collections.abc import Mapping
from http.client import HTTPMessage
from pathlib import Path
from typing import IO, Protocol, cast

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

# The hub's default upload limit (100 MB): a larger archive is refused before it is sent.
DEFAULT_MAX_BYTES = 104_857_600

# Seconds to wait for the hub's answer. The hub may queue an upload for a publish slot (30 s), then
# run the checker (up to 120 s) and the notetype comparison (up to 120 s): 330 s covers the worst case.
POST_TIMEOUT = 330


def esc(value: object) -> str:
    """Escape a value for a GitHub workflow command line (anti-injection)."""
    return str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _plain(value: object) -> str:
    """A hub-provided value on one terminal line."""
    return str(value).replace("\r", " ").replace("\n", " ")


class Reporter(Protocol):
    def error(self, message: str) -> None: ...
    def warning(self, edition: str, message: str) -> None: ...
    def published(
        self, edition: str, status: str, version: str, notes: str
    ) -> None: ...


class GithubReporter:
    """GitHub workflow annotations, as the Action has always printed them."""

    def error(self, message: str) -> None:
        print(f"::error::{esc(message)}")

    def warning(self, edition: str, message: str) -> None:
        print(f"::warning::{esc(edition)}: {esc(message)}")

    def published(self, edition: str, status: str, version: str, notes: str) -> None:
        print(f"{edition}: {esc(status)} (version {esc(version)}, {esc(notes)} notes)")


class TextReporter:
    """Plain text for a terminal: results on stdout, problems on stderr."""

    def error(self, message: str) -> None:
        print(f"error: {_plain(message)}", file=sys.stderr)

    def warning(self, edition: str, message: str) -> None:
        print(f"warning: {edition}: {_plain(message)}", file=sys.stderr)

    def published(self, edition: str, status: str, version: str, notes: str) -> None:
        print(
            f"{edition}: {_plain(status)} (version {_plain(version)}, {_plain(notes)} notes)"
        )


class JsonReporter:
    """Collects the outcome; `report()` is printed once at the end."""

    def __init__(self) -> None:
        self.ok: bool = True
        self.problems: list[str] = []
        self.editions: list[dict[str, object]] = []
        self._warnings: dict[str, list[str]] = {}

    def error(self, message: str) -> None:
        self.ok = False
        self.problems.append(message)

    def warning(self, edition: str, message: str) -> None:
        self._warnings.setdefault(edition, []).append(message)

    def published(self, edition: str, status: str, version: str, notes: str) -> None:
        self.editions.append(
            {
                "edition": edition,
                "status": status,
                "version": version,
                "notes": notes,
                "warnings": self._warnings.get(edition, []),
            }
        )

    def report(self) -> dict[str, object]:
        return {"ok": self.ok, "editions": self.editions, "errors": self.problems}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: they could forward the bearer token elsewhere.

    No `typing.override` here: the Action runs this module with the runner's own python3, which
    may predate 3.12.
    """

    def redirect_request(  # pyright: ignore[reportImplicitOverride]
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> urllib.request.Request | None:
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def build_archive(edition_dir: Path) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in sorted(edition_dir.rglob("*")):
            if path.is_file():
                tar.add(path, arcname=path.relative_to(edition_dir).as_posix())
    return buf.getvalue()


def check_hub_url(hub_url: str) -> str | None:
    parts = urllib.parse.urlsplit(hub_url)
    if parts.scheme == "https" and parts.hostname:
        return None
    if parts.scheme == "http" and parts.hostname in LOCAL_HOSTS:
        return None
    return (
        "hub-url must use https (plain http is only allowed for localhost), "
        "so the token is never sent in clear text."
    )


def post(url: str, token: str, data: bytes) -> tuple[int, bytes]:
    """Return (status, body bytes). Never raises on HTTP errors."""
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/gzip",
        },
    )
    try:
        response = cast(
            urllib.response.addinfourl, _OPENER.open(req, timeout=POST_TIMEOUT)
        )
        with response:
            return response.status or 200, response.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def publish_edition(
    base: str,
    token: str,
    edition: str,
    edition_dir: Path,
    reporter: Reporter,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> int:
    url = f"{base}/api/publish/{urllib.parse.quote(edition)}"
    archive = build_archive(edition_dir)
    if len(archive) > max_bytes:
        reporter.error(
            f"{edition}: the archive is {len(archive)} bytes, more than max-bytes ({max_bytes}); "
            + "the hub would refuse it. Make the deck smaller (media files), or raise max-bytes "
            + "if your hub accepts more."
        )
        return 1
    try:
        status, raw = post(url, token, archive)
    except (urllib.error.URLError, OSError) as err:
        reason = cast(object, getattr(err, "reason", err))
        reporter.error(f"{edition}: could not reach the hub ({type(reason).__name__}).")
        return 1
    body: dict[str, object] | None
    try:
        parsed = cast(object, json.loads(raw))
        body = cast(dict[str, object], parsed) if isinstance(parsed, dict) else None
    except ValueError:
        body = None

    if body is None or status >= 400:
        errors = body.get("errors") if body else None
        entries = (
            [
                cast(dict[str, object], e)
                for e in cast(list[object], errors)
                if isinstance(e, dict)
            ]
            if isinstance(errors, list)
            else []
        )
        if entries:
            for e in entries:
                reporter.error(f"{e.get('where', edition)}: {e.get('message', '')}")
        else:
            reporter.error(f"{edition}: hub responded with HTTP {status}")
        return 1

    warnings = body.get("warnings")
    for w in cast(list[object], warnings) if isinstance(warnings, list) else []:
        reporter.warning(edition, str(w))
    reporter.published(
        edition,
        str(body.get("status", "?")),
        str(body.get("version", "?")),
        str(body.get("notes", "?")),
    )
    return 0


def editions_in(dist: Path) -> list[Path]:
    if not dist.is_dir():
        return []
    return sorted(p for p in dist.iterdir() if (p / "deck.json").is_file())


def publish_dist(
    dist: Path,
    hub_url: str,
    token: str,
    *,
    reporter: Reporter,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> int:
    """Publish every edition of `dist`: 0 if all were published, 1 otherwise."""
    if not hub_url:
        reporter.error("hub-url is required for the publish command.")
        return 1
    if not token:
        reporter.error("DECKDOCK_TOKEN is required for the publish command.")
        return 1
    problem = check_hub_url(hub_url)
    if problem:
        reporter.error(problem)
        return 1
    editions = editions_in(dist)
    if not editions:
        reporter.error(f"No edition found in {dist} (expected <edition>/deck.json).")
        return 1
    base = hub_url.rstrip("/")
    for edition_dir in editions:
        if publish_edition(
            base, token, edition_dir.name, edition_dir, reporter, max_bytes
        ):
            return 1
    return 0


def parse_max_bytes(raw: str) -> int | None:
    """A positive number of bytes (ASCII digits only), or None."""
    raw = raw.strip()
    if not raw:
        return DEFAULT_MAX_BYTES
    if raw.isascii() and raw.isdigit() and int(raw) > 0:
        return int(raw)
    return None


def main_from_env(env: Mapping[str, str] = os.environ) -> int:
    """The Action's entry point: DECKDOCK_HUB_URL, DECKDOCK_TOKEN, DECKDOCK_PATH, DECKDOCK_MAX_BYTES."""
    reporter = GithubReporter()
    hub_url = (env.get("DECKDOCK_HUB_URL") or "").strip()
    token = env.get("DECKDOCK_TOKEN") or ""
    dist = Path(env.get("DECKDOCK_PATH") or "dist")
    raw_max = env.get("DECKDOCK_MAX_BYTES") or ""
    if not hub_url:
        reporter.error("hub-url is required for the publish command.")
        return 1
    if not token:
        reporter.error("DECKDOCK_TOKEN is required for the publish command.")
        return 1
    problem = check_hub_url(hub_url)
    if problem:
        reporter.error(problem)
        return 1
    max_bytes = parse_max_bytes(raw_max)
    if max_bytes is None:
        reporter.error(
            f"max-bytes must be a positive number of bytes, not {raw_max.strip()!r}."
        )
        return 1
    return publish_dist(dist, hub_url, token, reporter=reporter, max_bytes=max_bytes)
