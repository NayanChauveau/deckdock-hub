"""Command-line entry point."""

import argparse
import json
from pathlib import Path
from typing import cast

from deckdock import __version__
from deckdock.compat import notetype_changes
from deckdock.format import CompiledDeck, check_deck, check_dist
from deckdock.issues import Issue, print_issues


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="deckdock")
    _ = parser.add_argument(
        "--version", action="store_true", help="show version and exit"
    )
    subparsers = parser.add_subparsers(dest="command", metavar="<command>")
    check = subparsers.add_parser("check", help="check compiled deckdock/1 editions")
    _ = check.add_argument(
        "dist", nargs="?", default="dist", help="dist directory (default: dist)"
    )
    _ = check.add_argument(
        "--non-strict",
        action="store_true",
        help="ignore unknown keys (as a consumer of the format would)",
    )
    _ = check.add_argument(
        "--json", action="store_true", help="print the result as JSON on stdout"
    )
    compat = subparsers.add_parser(
        "compat", help="compare the notetype structure of two deck.json files"
    )
    _ = compat.add_argument("previous", help="deck.json of the published version")
    _ = compat.add_argument("new", help="deck.json of the new version")
    _ = compat.add_argument(
        "--json", action="store_true", help="print the result as JSON"
    )
    return parser


def _check(args: argparse.Namespace) -> int:
    issues = check_dist(
        Path(cast(str, args.dist)), strict=not cast(bool, args.non_strict)
    )
    if not cast(bool, args.json):
        return print_issues(issues)
    report = {
        "ok": not issues,
        "issues": [
            {
                "path": issue.path,
                "where": issue.where,
                "message": issue.detail,
                "line": issue.line,
            }
            for issue in issues
        ],
    }
    print(json.dumps(report))
    return 1 if issues else 0


def _load_deck(path: str) -> CompiledDeck | list[Issue]:
    try:
        with open(path, encoding="utf-8") as handle:
            data = cast(object, json.load(handle))
    except (OSError, UnicodeDecodeError) as exc:
        return [Issue(path, f"cannot read file: {exc}")]
    except json.JSONDecodeError as exc:
        return [Issue(path, f"invalid JSON: {exc.msg}", exc.lineno)]
    issues = check_deck(data, path=path, strict=False)
    return issues or cast(CompiledDeck, data)


def _compat(args: argparse.Namespace) -> int:
    previous = _load_deck(cast(str, args.previous))
    new = _load_deck(cast(str, args.new))
    if isinstance(previous, list) or isinstance(new, list):
        problems = [
            *(previous if isinstance(previous, list) else []),
            *(new if isinstance(new, list) else []),
        ]
        return print_issues(problems)
    changes = notetype_changes(previous, new)
    if cast(bool, args.json):
        print(
            json.dumps(
                [
                    {"notetype": c.notetype, "kind": c.kind, "detail": c.detail}
                    for c in changes
                ]
            )
        )
    else:
        for c in changes:
            print(f"{c.kind}: {c.notetype}: {c.detail}")
    return 1 if any(c.kind == "breaking" for c in changes) else 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if cast(bool, args.version):
        print(f"deckdock {__version__}")
        return 0
    command = cast(str | None, args.command)
    if command is None:
        parser.print_help()
        return 0
    if command == "check":
        return _check(args)
    if command == "compat":
        return _compat(args)
    return 0
