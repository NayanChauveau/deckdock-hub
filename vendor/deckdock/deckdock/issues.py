"""User-facing error reporting in the `<path>:<line>: <message>` format."""

import sys
from dataclasses import dataclass
from typing import override


@dataclass(frozen=True)
class Issue:
    """`message` is the full text shown to users; `where` names the JSON location it is about."""

    path: str
    message: str
    line: int | None = None
    where: str = ""

    @property
    def detail(self) -> str:
        """The message without its `where` prefix (`message` keeps the full text)."""
        return (
            self.message.removeprefix(f"{self.where}: ") if self.where else self.message
        )

    @override
    def __str__(self) -> str:
        if self.line is None:
            return f"{self.path}: {self.message}"
        return f"{self.path}:{self.line}: {self.message}"


def print_issues(issues: list[Issue]) -> int:
    """Write issues to stderr; return the process exit code (1 if any, else 0)."""
    for issue in issues:
        print(issue, file=sys.stderr)
    return 1 if issues else 0
