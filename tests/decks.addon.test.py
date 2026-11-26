"""The DeckDock add-on's own code reads an edition served by a test hub.

Run by tests/decks.serve.http.ts: `python -P decks.addon.test.py <origin> <base path> <edition>`,
with PYTHONPATH pointing at deckdock/addon/src (the add-on and its embedded `deckdock` library,
not installed in Anki). The add-on only accepts HTTPS: the learner's address is the HTTPS one the
deck page gives, and the opener given to the add-on's urllib transport sends each request to the
plain-HTTP test server instead, with the same path and headers. Nothing in the add-on is patched.
"""

from __future__ import annotations

import json
import sys
from typing import cast
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, build_opener

from deckdock_addon import sources  # pyright: ignore[reportMissingImports]

PUBLIC_HOST = "hub.deckdock.test"


def main(origin: str, base_path: str, edition: str) -> int:
    local = urlsplit(origin)
    # What a learner pastes: `<base>/<edition>/` on the hub's HTTPS address.
    address = f"https://{PUBLIC_HOST}{base_path}{edition}/"
    seen: list[str] = []

    def to_test_server(request: Request) -> sources.RawResponse:
        url = urlsplit(request.full_url)
        assert url.scheme == "https" and url.hostname == PUBLIC_HOST, request.full_url
        seen.append(url.path)
        rewritten = urlunsplit((local.scheme, local.netloc, url.path, url.query, ""))
        forwarded = Request(rewritten, headers=dict(request.header_items()), method="GET")
        # The add-on's own no-redirect handler: every hop stays vetted by its transport.
        opener = build_opener(sources._NoRedirect)  # pyright: ignore[reportPrivateUsage]
        return cast(sources.RawResponse, opener.open(forwarded, timeout=30))

    def transport(url: str, headers: dict[str, str], max_bytes: int) -> sources.Response:
        return sources.urllib_transport(url, headers, max_bytes, opener=to_test_server)

    source = sources.parse_source(address)
    assert source.kind == "base", source
    base_url = sources.edition_base_url(source, edition)
    assert base_url == address, base_url

    fetched = sources.fetch_deck(base_url, etag=None, transport=transport)
    assert fetched is not None
    deck = fetched.deck
    info = deck["deck"]
    assert info["edition"] == edition, info
    assert fetched.etag and fetched.etag.startswith('"'), fetched.etag

    # Each media file is read and checked against its size and sha256 in deck.json.
    for entry in deck["media"]:
        _ = sources.fetch_media(base_url, entry, transport=transport)

    # Unchanged since the ETag the add-on stored: 304, nothing downloaded.
    assert sources.fetch_deck(base_url, etag=fetched.etag, transport=transport) is None

    # index.json, parsed by the add-on's reader (a base source has no index of its own, so the
    # deck's `<base>/index.json` is given here), and byte for byte what make_index.py writes.
    index_url = base_url.removesuffix(f"{edition}/") + "index.json"
    index_source = sources.Source("base", base_url, index_url, None, None)
    editions = sources.fetch_index(index_source, transport=transport)
    raw = transport(index_url, {}, sources.MAX_INDEX_BYTES).body
    data = cast(dict[str, object], json.loads(raw))
    assert raw == (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode(), raw
    assert data["format"] == "deckdock-index/1"
    assert [e.edition for e in editions] == sorted(e.edition for e in editions)
    listed = next(e for e in editions if e.edition == edition)
    assert listed.version == info["version"] and listed.name == info["name"], listed

    assert all(path.startswith(base_path) for path in seen), seen
    print(
        f"addon ok: {info['id']} {edition} {info['version']}, {len(deck['media'])} media,"
        + f" index {len(editions)} editions"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(*sys.argv[1:4]))
