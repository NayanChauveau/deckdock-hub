"""The compiled deckdock/1 format: constants, typed shapes and the checker (standard library only)."""

from deckdock.format.check import (
    FORMAT,
    MAX_ANKI_ID,
    MAX_MEDIA_BYTES,
    MAX_NOTES,
    MAX_TOTAL_MEDIA_BYTES,
    SLUG_RE,
    check_deck,
    check_dist,
)
from deckdock.format.types import (
    CompiledDeck,
    Deck,
    DeckOptions,
    MediaEntry,
    Note,
    Notetype,
    Template,
)

__all__ = [
    "FORMAT",
    "MAX_ANKI_ID",
    "MAX_MEDIA_BYTES",
    "MAX_NOTES",
    "MAX_TOTAL_MEDIA_BYTES",
    "SLUG_RE",
    "CompiledDeck",
    "Deck",
    "DeckOptions",
    "MediaEntry",
    "Note",
    "Notetype",
    "Template",
    "check_deck",
    "check_dist",
]
