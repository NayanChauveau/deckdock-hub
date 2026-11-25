"""Compatibility of a published notetype's structure between two deck versions.

Mirrors the rule applied by the Anki add-on (see "Changing a published notetype" in
the spec), so that every consumer judges structure changes the same way.
Standard library only.
"""

from dataclasses import dataclass
from typing import Literal

from deckdock.format.types import CompiledDeck, Notetype


@dataclass(frozen=True)
class NotetypeChange:
    notetype: str
    kind: Literal["appended_fields", "breaking"]
    detail: str


def structure_problem(previous: Notetype, new: Notetype) -> str | None:
    """Why `new` cannot replace `previous` in place, or None when it can."""
    if previous["kind"] != new["kind"]:
        return "its kind (standard or cloze) changed"
    if len(previous["templates"]) != len(new["templates"]):
        return "a card template was added or removed"
    old_fields = previous["fields"]
    if new["fields"][: len(old_fields)] != old_fields:
        return "a field was removed, renamed or reordered"
    return None


def notetype_changes(previous: CompiledDeck, new: CompiledDeck) -> list[NotetypeChange]:
    """Structure changes of the notetypes present in both decks (matched by `id`).

    Added or removed notetypes are not changes. Template text and CSS are ignored.
    """
    old_by_id = {nt["id"]: nt for nt in previous["notetypes"]}
    changes: list[NotetypeChange] = []
    for nt in new["notetypes"]:
        old = old_by_id.get(nt["id"])
        if old is None:
            continue
        problem = structure_problem(old, nt)
        if problem is not None:
            changes.append(NotetypeChange(nt["id"], "breaking", problem))
        elif len(nt["fields"]) > len(old["fields"]):
            added = ", ".join(nt["fields"][len(old["fields"]) :])
            changes.append(
                NotetypeChange(nt["id"], "appended_fields", f"fields added: {added}")
            )
    return changes
