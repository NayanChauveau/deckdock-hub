# Publish without GitHub

GitHub is not required: any machine that can build the deck can send it to this site, with the `deckdock publish` command or with a plain HTTP request. This page is for people who build their deck with their own tools, or with another continuous integration service (GitLab, their own server…).

> **Note**
> If you are just starting out, prefer [Publish with GitHub, step by step](/en/guide/publish-with-github): everything happens in your browser.

## What you need

- **A compiled deck** in the `deckdock/1` format: a `dist/` folder holding, for each edition, `dist/<edition>/deck.json` and its media in `dist/<edition>/media/`. The [template](https://github.com/NayanChauveau/deckdock-template) builds it with `uv run compile`; the rules are in [The format in detail](/en/guide/format).
- **A real version**: the `deck.version` field must not be `"dev"`, which is refused. The template reads the version from the `DECKDOCK_VERSION` environment variable (CI sets it to the commit’s date and short id); without it, it writes `"dev"`.
- **A terminal** for the commands below: a window where you type commands (the *Terminal* app on macOS, *PowerShell* on Windows). The examples are written for macOS and Linux.

## The token

Each deck has its own **publish token**, starting with `ddk_`. You get it by creating the deck in your author space (**My decks › + New deck**, with your deck’s `deck.id`), and it is shown only once.

- Keep it like a password: never write it in a file you share or publish.
- The tools read it from the `DECKDOCK_TOKEN` environment variable.
- Lost or leaked? **Regenerate the token**, on the deck’s page, creates a new one and disables the old one at once. **Revoke the token** disables it without replacing it.

The hub checks the token before anything else: a wrong or revoked token gets a 401 error.

## With the deckdock publish command

The `deckdock` library (version 0.3.0 or later) provides the `deckdock publish` command, which sends every edition of the `dist/` folder. With nothing installed but [uv](https://docs.astral.sh/uv/), run it like this:

```sh
export DECKDOCK_TOKEN=ddk_your_token
uvx --from "git+https://github.com/NayanChauveau/deckdock@v0#subdirectory=cli" deckdock publish dist --hub https://<hub>
```

Replace `https://<hub>` with this site’s address, as shown on your deck’s page. In a repository created from the template, the library is already there:

```sh
export DECKDOCK_TOKEN=ddk_your_token
DECKDOCK_VERSION="$(date -u +%Y-%m-%dT%H:%M:%SZ)" uv run compile
uv run deckdock publish dist --hub https://<hub>
```

Good to know:

- `--hub` defaults to the `DECKDOCK_HUB_URL` environment variable. The address must use `https` (plain `http` is accepted only for `localhost`, for testing), and redirects are never followed, so the token cannot go anywhere else.
- Each `dist/<edition>/deck.json` is sent in its own archive, editions in alphabetical order. Publishing stops at the first edition the hub refuses: the hub’s errors are printed and the command exits with code 1.
- `--max-bytes N` refuses an archive larger than N bytes before sending it (default 104857600, the hub’s limit); `--json` prints the result as JSON instead of text.

## With an HTTP request

The same can be done by hand, with any tool that can send a request: one `POST /api/publish/<edition>` request per edition.

- Header `Authorization: Bearer <token>`;
- header `Content-Type: application/gzip`;
- body: a `tar.gz` archive of the edition’s folder, with `deck.json` and `media/…` at the root of the archive, and nothing else.

For example with `curl`, for the `en` edition:

```sh
export DECKDOCK_TOKEN=ddk_your_token
tar -czf en.tar.gz -C dist/en .
curl --request POST "https://<hub>/api/publish/en" \
  --header "Authorization: Bearer $DECKDOCK_TOKEN" \
  --header "Content-Type: application/gzip" \
  --data-binary @en.tar.gz
```

> **Warning**
> On macOS, `tar` may add hidden files (`._deck.json`…) that the hub refuses as extra files. Create the archive with `COPYFILE_DISABLE=1 tar -czf en.tar.gz -C dist/en .` to avoid them.

## The hub’s answers

The hub always answers in JSON, with these fields:

```json
{
  "status": "pending_review",
  "version": "2026-11-26T10:00:00Z+a1b2c3d",
  "notes": 120,
  "warnings": [],
  "errors": []
}
```

- `status`: the outcome (see below);
- `version` and `notes`: the version received and its number of notes;
- `warnings`: warnings that don’t prevent publishing;
- `errors`: when refused, the list of problems, each with `where` (where: `token`, `archive`, `deck.json`, `quota`…) and `message` (what).

When the upload is accepted, the HTTP status is 200 and `status` is:

| `status` | Meaning |
| --- | --- |
| `pending_review` | First version of a new deck: received, it awaits an administrator’s approval. The deck is not in the catalogue yet, but it can already be tested with its address. |
| `published` | New version of an approved deck: published straight away. |
| `already_published` | This version was already received with exactly the same files: nothing changes. Sending the same version again is therefore safe. |

Adding a field at the end of a note type is accepted with a warning: learners will need a full sync with AnkiWeb.

When refused, `status` is `rejected` and the HTTP status gives the reason:

| Status | Reason |
| --- | --- |
| 401 | Wrong or revoked token. |
| 403 | Quota exceeded: a deck awaiting approval receives at most 3 versions before it is approved, and an author stores at most 2 GiB. |
| 408 | The upload took longer than 120 seconds. |
| 409 | Conflict: `deck.id` differs from the token’s deck, `deck.edition` differs from the address, the version was already received with other files, or the structure of a published note type changed. |
| 410 | The deck was hidden by an administrator. |
| 413 | The archive is larger than 100 MB. |
| 422 | Unreadable or malformed archive, extra files, a `deck.json` that fails the format check, or version `"dev"`. |
| 429 | Too many uploads: wait for the delay given by the `Retry-After` header, then try again. |
| 503 | The hub is busy: wait for the `Retry-After` delay, then try again. |

Retrying is always safe: a version already received with the same files gives `already_published`.

## Limits

- **Per upload**: 100 MB compressed, received within 120 seconds. Once decompressed: at most 500 MiB and 20,000 files, and a `deck.json` of at most 16 MiB.
- **Per author**: 10 decks and 2 GiB stored (the files of every version, each version counted with all its files).
- **Per deck**: 30 uploads every 10 minutes, and at most 3 versions while the deck awaits approval.
