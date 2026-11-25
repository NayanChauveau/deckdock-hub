"""Deterministic Anki GUIDs, compatible with genanki.guid_for.

Standard library only: this module is embedded into an Anki add-on later.
"""

import hashlib
import string

_TABLE = (
    string.ascii_letters + string.digits + "!#$%&()*+,-./:;<=>?@[]^_`{|}~"
)  # 91 chars


def guid_for(*values: str) -> str:
    """Return a stable, Anki-safe GUID derived from the given strings."""
    digest = hashlib.sha256("__".join(values).encode("utf-8")).digest()[:8]
    number = int.from_bytes(digest, "big")
    out: list[str] = []
    while number > 0:
        number, rest = divmod(number, len(_TABLE))
        out.append(_TABLE[rest])
    return "".join(reversed(out))


def card_guid(deck_id: str, card_id: str, edition: str) -> str:
    """Return the GUID of one card in one edition of a deck."""
    return guid_for("deckdock", deck_id, card_id, edition)
