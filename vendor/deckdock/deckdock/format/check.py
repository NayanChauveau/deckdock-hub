"""Checker for the compiled deckdock/1 format.

Standard library only: the format module is embedded into an Anki add-on later.

`check_deck` verifies the structure of a parsed `deck.json` without touching the
disk. `check_dist` adds the on-disk checks (media files, sizes, hashes) and the
media references found in fields, templates and CSS.
"""

import hashlib
import html
import json
import re
import urllib.parse
from collections.abc import Iterator
from pathlib import Path
from typing import cast, final

from deckdock.issues import Issue

FORMAT = "deckdock/1"
MAX_NOTES = 50_000
MAX_MEDIA_BYTES = 10_485_760
MAX_TOTAL_MEDIA_BYTES = 524_288_000
MAX_ANKI_ID = 2**63 - 1  # Anki ids are signed 64-bit integers

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")

_TOP_KEYS = ("format", "deck", "notetypes", "notes", "media")
_DECK_REQUIRED = ("id", "edition", "name", "language", "version")
_DECK_OPTIONAL = (
    "anki_id",
    "options",
    "description",
    "homepage",
    "license",
    "generator",
)
_OPTION_KEYS = ("new_per_day", "reviews_per_day")
_NOTETYPE_REQUIRED = ("id", "name", "kind", "fields", "templates", "css")
_TEMPLATE_KEYS = ("name", "front", "back")
_NOTE_KEYS = ("guid", "notetype", "deck", "fields", "tags")
_MEDIA_KEYS = ("filename", "sha256", "size")

# Media references: src="X", src='X', [sound:X], url(X) with optional quotes.
_REFERENCE_PATTERNS = (
    re.compile(r"""\bsrc\s*=\s*"([^"]*)\"""", re.IGNORECASE),
    re.compile(r"""\bsrc\s*=\s*'([^']*)'""", re.IGNORECASE),
    re.compile(r"\[sound:([^\]]*)\]"),
    re.compile(r"""\burl\(\s*["']?([^"')]*?)["']?\s*\)""", re.IGNORECASE),
)


def _join(base: str, key: str) -> str:
    return f"{base}.{key}" if base else key


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_str_list(value: object) -> bool:
    return isinstance(value, list) and all(
        isinstance(v, str) for v in cast(list[object], value)
    )


@final
class _Checker:
    def __init__(self, path: str, *, strict: bool) -> None:
        self.path = path
        self.strict = strict
        self.issues: list[Issue] = []

    def error(self, where: str, message: str) -> None:
        text = f"{where}: {message}" if where else message
        self.issues.append(Issue(self.path, text, where=where))

    def mapping(self, value: object, where: str) -> dict[str, object] | None:
        if not isinstance(value, dict):
            self.error(where, "must be an object")
            return None
        return cast(dict[str, object], value)

    def sequence(self, value: object, where: str) -> list[object] | None:
        if not isinstance(value, list):
            self.error(where, "must be a list")
            return None
        return cast(list[object], value)

    def keys(
        self,
        obj: dict[str, object],
        where: str,
        required: tuple[str, ...],
        optional: tuple[str, ...] = (),
    ) -> None:
        for key in required:
            if key not in obj:
                self.error(where, f"missing key '{key}'")
        if not self.strict:
            return
        for key in obj:
            if key not in required and key not in optional:
                self.error(where, f"unknown key '{key}'")

    def string(
        self, obj: dict[str, object], key: str, where: str, *, non_empty: bool = False
    ) -> str | None:
        if key not in obj:
            return None
        value = obj[key]
        if not isinstance(value, str):
            self.error(_join(where, key), "must be a string")
            return None
        if non_empty and not value:
            self.error(_join(where, key), "must not be empty")
            return None
        return value

    def integer(
        self,
        obj: dict[str, object],
        key: str,
        where: str,
        *,
        minimum: int,
        maximum: int | None = None,
    ) -> int | None:
        if key not in obj:
            return None
        value = obj[key]
        if not _is_int(value):
            self.error(_join(where, key), "must be an integer")
            return None
        number = cast(int, value)
        if number < minimum:
            self.error(_join(where, key), f"must be >= {minimum}")
            return None
        if maximum is not None and number > maximum:
            self.error(_join(where, key), f"must be <= {maximum}")
            return None
        return number

    # -- sections -----------------------------------------------------------

    def check_root(self, data: object) -> None:
        root = self.mapping(data, "")
        if root is None:
            return
        self.keys(root, "", _TOP_KEYS)
        if "format" in root and root["format"] != FORMAT:
            self.error("format", f"format must be '{FORMAT}'")
        if "deck" in root:
            self.check_deck_object(root["deck"])
        notetype_fields = (
            self.check_notetypes(root["notetypes"]) if "notetypes" in root else {}
        )
        if "notes" in root:
            self.check_notes(root["notes"], notetype_fields)
        if "media" in root:
            self.check_media(root["media"])

    def check_deck_object(self, value: object) -> None:
        deck = self.mapping(value, "deck")
        if deck is None:
            return
        self.keys(deck, "deck", _DECK_REQUIRED, _DECK_OPTIONAL)
        deck_id = self.string(deck, "id", "deck")
        if deck_id is not None and not SLUG_RE.fullmatch(deck_id):
            self.error(
                "deck.id",
                f"invalid id {deck_id!r} (lowercase letters, digits and single dashes)",
            )
        edition = self.string(deck, "edition", "deck", non_empty=True)
        if edition is not None and (
            edition in (".", "..") or "/" in edition or "\\" in edition
        ):
            self.error("deck.edition", f"invalid edition {edition!r} (no path allowed)")
        for key in (
            "name",
            "version",
            "description",
            "homepage",
            "license",
            "generator",
        ):
            _ = self.string(deck, key, "deck")
        if "language" in deck:
            language = deck["language"]
            if not _is_str_list(language) or not language:
                self.error("deck.language", "must be a non-empty list of strings")
        _ = self.integer(deck, "anki_id", "deck", minimum=1, maximum=MAX_ANKI_ID)
        if "options" in deck:
            options = self.mapping(deck["options"], "deck.options")
            if options is not None:
                for key in options:
                    if self.strict and key not in _OPTION_KEYS:
                        self.error("deck.options", f"unknown key '{key}'")
                for key in _OPTION_KEYS:
                    _ = self.integer(options, key, "deck.options", minimum=0)

    def check_notetypes(self, value: object) -> dict[str, list[str]]:
        """Check the notetypes; return the field names of each valid notetype id."""
        fields_by_id: dict[str, list[str]] = {}
        notetypes = self.sequence(value, "notetypes")
        if notetypes is None:
            return fields_by_id
        seen: set[str] = set()
        for index, raw in enumerate(notetypes):
            where = f"notetypes[{index}]"
            notetype = self.mapping(raw, where)
            if notetype is None:
                continue
            self.keys(notetype, where, _NOTETYPE_REQUIRED, ("anki_id",))
            notetype_id = self.string(notetype, "id", where, non_empty=True)
            if notetype_id is not None:
                if notetype_id in seen:
                    self.error(f"{where}.id", f"duplicate id {notetype_id!r}")
                seen.add(notetype_id)
            _ = self.string(notetype, "name", where)
            _ = self.string(notetype, "css", where)
            _ = self.integer(notetype, "anki_id", where, minimum=1, maximum=MAX_ANKI_ID)
            kind = notetype.get("kind")
            if "kind" in notetype and kind not in ("standard", "cloze"):
                self.error(f"{where}.kind", "must be 'standard' or 'cloze'")
            names = self.check_field_names(notetype, where)
            self.check_templates(notetype, where, is_cloze=kind == "cloze")
            if notetype_id is not None and names is not None:
                _ = fields_by_id.setdefault(notetype_id, names)
        return fields_by_id

    def check_field_names(
        self, notetype: dict[str, object], where: str
    ) -> list[str] | None:
        if "fields" not in notetype:
            return None
        raw = notetype["fields"]
        if not _is_str_list(raw) or not raw:
            self.error(f"{where}.fields", "must be a non-empty list of strings")
            return None
        names = cast(list[str], raw)
        valid = True
        if any(not name for name in names):
            self.error(f"{where}.fields", "field names must not be empty")
            valid = False
        if len(set(names)) != len(names):
            self.error(f"{where}.fields", "field names must be unique")
            valid = False
        return names if valid else None

    def check_templates(
        self, notetype: dict[str, object], where: str, *, is_cloze: bool
    ) -> None:
        if "templates" not in notetype:
            return
        templates = self.sequence(notetype["templates"], f"{where}.templates")
        if templates is None:
            return
        if not templates:
            self.error(f"{where}.templates", "must not be empty")
        elif is_cloze and len(templates) != 1:
            self.error(
                f"{where}.templates", "a cloze notetype must have exactly one template"
            )
        for index, raw in enumerate(templates):
            template_where = f"{where}.templates[{index}]"
            template = self.mapping(raw, template_where)
            if template is None:
                continue
            self.keys(template, template_where, _TEMPLATE_KEYS)
            for key in _TEMPLATE_KEYS:
                _ = self.string(template, key, template_where)

    def check_notes(self, value: object, fields_by_id: dict[str, list[str]]) -> None:
        notes = self.sequence(value, "notes")
        if notes is None:
            return
        if len(notes) > MAX_NOTES:
            self.error("notes", f"too many notes ({len(notes)} > {MAX_NOTES})")
        seen: set[str] = set()
        for index, raw in enumerate(notes):
            where = f"notes[{index}]"
            note = self.mapping(raw, where)
            if note is None:
                continue
            self.keys(note, where, _NOTE_KEYS)
            guid = self.string(note, "guid", where, non_empty=True)
            if guid is not None:
                if guid in seen:
                    self.error(f"{where}.guid", f"duplicate guid {guid!r}")
                seen.add(guid)
            self.check_note_deck_path(note, where)
            self.check_tags(note, where)
            notetype_id = self.string(note, "notetype", where)
            names: list[str] | None = None
            if notetype_id is not None:
                names = fields_by_id.get(notetype_id)
                if names is None:
                    self.error(f"{where}.notetype", f"unknown notetype {notetype_id!r}")
            self.check_note_fields(note, where, names)

    def check_note_deck_path(self, note: dict[str, object], where: str) -> None:
        path = self.string(note, "deck", where)
        if path and any(not segment for segment in path.split("::")):
            self.error(f"{where}.deck", f"invalid deck path {path!r}")

    def check_tags(self, note: dict[str, object], where: str) -> None:
        if "tags" not in note:
            return
        tags = note["tags"]
        if not _is_str_list(tags):
            self.error(f"{where}.tags", "must be a list of strings")
            return
        for tag in cast(list[str], tags):
            if not tag or any(char.isspace() for char in tag):
                self.error(
                    f"{where}.tags", f"invalid tag {tag!r} (non-empty, no spaces)"
                )

    def check_note_fields(
        self, note: dict[str, object], where: str, names: list[str] | None
    ) -> None:
        if "fields" not in note:
            return
        fields = self.mapping(note["fields"], f"{where}.fields")
        if fields is None:
            return
        for name, field_value in fields.items():
            if not isinstance(field_value, str):
                self.error(f"{where}.fields.{name}", "must be a string")
        if names is None:
            return
        for name in names:
            if name not in fields:
                self.error(f"{where}.fields", f"missing field '{name}'")
        for name in fields:
            if name not in names:
                self.error(f"{where}.fields", f"unknown field '{name}'")

    def check_media(self, value: object) -> None:
        media = self.sequence(value, "media")
        if media is None:
            return
        seen: set[str] = set()
        total = 0
        for index, raw in enumerate(media):
            where = f"media[{index}]"
            entry = self.mapping(raw, where)
            if entry is None:
                continue
            self.keys(entry, where, _MEDIA_KEYS)
            filename = self.string(entry, "filename", where, non_empty=True)
            if filename is not None:
                if "/" in filename or "\\" in filename or filename in (".", ".."):
                    self.error(
                        f"{where}.filename",
                        f"invalid filename {filename!r} (no path allowed)",
                    )
                if filename in seen:
                    self.error(f"{where}.filename", f"duplicate filename {filename!r}")
                seen.add(filename)
            sha256 = self.string(entry, "sha256", where)
            if sha256 is not None and not _SHA256.fullmatch(sha256):
                self.error(
                    f"{where}.sha256", "must be 64 lowercase hexadecimal characters"
                )
            size = self.integer(entry, "size", where, minimum=0)
            if size is not None:
                if size > MAX_MEDIA_BYTES:
                    self.error(
                        f"{where}.size",
                        f"file too large ({size} > {MAX_MEDIA_BYTES} bytes)",
                    )
                total += size
        if total > MAX_TOTAL_MEDIA_BYTES:
            self.error(
                "media",
                f"total media size too large ({total} > {MAX_TOTAL_MEDIA_BYTES} bytes)",
            )


def check_deck(
    data: object, *, path: str = "deck.json", strict: bool = True
) -> list[Issue]:
    """Check the structure of a parsed deck.json; never touches the disk.

    `strict` rejects unknown keys (producers). Consumers pass `strict=False`: unknown
    keys are ignored but every other rule is still enforced.
    """
    checker = _Checker(path, strict=strict)
    checker.check_root(data)
    return checker.issues


# -- on-disk checks ------------------------------------------------------------


def _is_local_reference(name: str) -> bool:
    """Whether `name` designates a file of the edition (not a URL, absolute path or template tag)."""
    return (
        bool(name)
        and "://" not in name
        and not name.startswith(("/", "data:"))
        and "{{" not in name
    )


def _references(text: str) -> list[str]:
    """Local media references in `text`, HTML-unescaped and percent-decoded."""
    found: list[str] = []
    for pattern in _REFERENCE_PATTERNS:
        for name in cast(list[str], pattern.findall(text)):
            name = urllib.parse.unquote(html.unescape(name))
            if _is_local_reference(name) and name not in found:
                found.append(name)
    return found


def _texts(deck: dict[str, object]) -> Iterator[tuple[str, str]]:
    """Yield (JSON path, text) for every field, template and CSS string; deck is structurally valid."""
    for index, note in enumerate(cast(list[dict[str, object]], deck["notes"])):
        for name, value in cast(dict[str, str], note["fields"]).items():
            yield f"notes[{index}].fields.{name}", value
    for index, notetype in enumerate(cast(list[dict[str, object]], deck["notetypes"])):
        where = f"notetypes[{index}]"
        yield f"{where}.css", cast(str, notetype["css"])
        for t_index, template in enumerate(
            cast(list[dict[str, str]], notetype["templates"])
        ):
            yield f"{where}.templates[{t_index}].front", template["front"]
            yield f"{where}.templates[{t_index}].back", template["back"]


def _sha256_of(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _check_edition(edition_dir: Path, display: str, *, strict: bool) -> list[Issue]:
    deck_json = edition_dir / "deck.json"
    try:
        data = cast(object, json.loads(deck_json.read_text(encoding="utf-8")))
    except (OSError, UnicodeDecodeError) as exc:
        return [Issue(display, f"cannot read file: {exc}")]
    except json.JSONDecodeError as exc:
        return [Issue(display, f"invalid JSON: {exc.msg}", exc.lineno)]
    issues = check_deck(data, path=display, strict=strict)
    if issues:
        return issues
    deck = cast(dict[str, object], data)
    entries = cast(list[dict[str, object]], deck["media"])
    listed = {cast(str, entry["filename"]): entry for entry in entries}
    media_dir = edition_dir / "media"

    edition = cast(dict[str, object], deck["deck"])["edition"]
    if edition != edition_dir.name:
        issues.append(
            Issue(
                display,
                f"deck.edition {edition!r} does not match directory {edition_dir.name!r}",
                where="deck.edition",
            )
        )

    for index, entry in enumerate(entries):
        filename = cast(str, entry["filename"])
        where = f"media[{index}]"
        file = media_dir / filename
        if not file.is_file():
            issues.append(
                Issue(display, f"{where}: missing file 'media/{filename}'", where=where)
            )
            continue
        try:
            size = file.stat().st_size
            if size != entry["size"]:
                issues.append(
                    Issue(
                        display,
                        f"{where}: size mismatch for '{filename}' (listed {entry['size']}, on disk {size})",
                        where=where,
                    )
                )
            elif _sha256_of(file) != entry["sha256"]:
                issues.append(
                    Issue(
                        display,
                        f"{where}: sha256 mismatch for '{filename}'",
                        where=where,
                    )
                )
        except OSError as exc:
            issues.append(
                Issue(
                    display,
                    f"{where}: cannot read 'media/{filename}': {exc.strerror or exc}",
                    where=where,
                )
            )

    if media_dir.is_dir():
        try:
            on_disk = sorted(media_dir.iterdir())
        except OSError as exc:
            on_disk = []
            issues.append(
                Issue(
                    display,
                    f"media: cannot read directory: {exc.strerror or exc}",
                    where="media",
                )
            )
        for file in on_disk:
            if file.name not in listed:
                issues.append(
                    Issue(
                        display,
                        f"media/{file.name}: file not listed in 'media'",
                        where=f"media/{file.name}",
                    )
                )

    for where, text in _texts(deck):
        for name in _references(text):
            if "/" in name:
                issues.append(
                    Issue(
                        display,
                        f"{where}: media references must be bare filenames ('{name}')",
                        where=where,
                    )
                )
            elif name not in listed:
                issues.append(
                    Issue(
                        display,
                        f"{where}: references unlisted media '{name}'",
                        where=where,
                    )
                )
    return issues


def check_dist(dist_dir: Path, *, strict: bool = True) -> list[Issue]:
    """Check every `<dist_dir>/<edition>/deck.json`, including media files and references."""
    if not dist_dir.is_dir():
        return [Issue(str(dist_dir), "not a directory")]
    try:
        editions = sorted(p for p in dist_dir.iterdir() if (p / "deck.json").is_file())
    except OSError as exc:
        return [Issue(str(dist_dir), f"cannot read directory: {exc.strerror or exc}")]
    if not editions:
        return [Issue(str(dist_dir), "no editions found")]
    root_name = dist_dir.resolve().name
    issues: list[Issue] = []
    for edition_dir in editions:
        issues.extend(
            _check_edition(
                edition_dir, f"{root_name}/{edition_dir.name}/deck.json", strict=strict
            )
        )
    return issues
