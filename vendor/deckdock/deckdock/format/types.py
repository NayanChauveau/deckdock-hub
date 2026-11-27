"""Typed shapes of a compiled deckdock/1 deck (standard library only).

For custom generators written in Python: build a `CompiledDeck`, write it as JSON,
then check it with `check_deck` / `check_dist`. The types describe the structure
only; the rules (slugs, uniqueness, limits) are enforced by the checker.
"""

from typing import Literal, NotRequired, TypedDict


class DeckOptions(TypedDict, total=False):
    new_per_day: int
    reviews_per_day: int


class Deck(TypedDict):
    id: str
    edition: str
    name: str
    language: list[str]
    version: str
    anki_id: NotRequired[int]
    options: NotRequired[DeckOptions]
    description: NotRequired[str]
    icon: NotRequired[str]
    homepage: NotRequired[str]
    license: NotRequired[str]
    generator: NotRequired[str]


class Template(TypedDict):
    name: str
    front: str
    back: str


class Notetype(TypedDict):
    id: str
    name: str
    kind: Literal["standard", "cloze"]
    fields: list[str]
    templates: list[Template]
    css: str
    anki_id: NotRequired[int]


class Note(TypedDict):
    guid: str
    notetype: str
    deck: str
    fields: dict[str, str]
    tags: list[str]


class MediaEntry(TypedDict):
    filename: str
    sha256: str
    size: int


class CompiledDeck(TypedDict):
    format: str
    deck: Deck
    notetypes: list[Notetype]
    notes: list[Note]
    media: list[MediaEntry]
