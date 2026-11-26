# The format in detail

This page describes the files of a deck created from the [template](https://github.com/NayanChauveau/deckdock-template): `deckdock.yaml`, the notes, the media, then what happens with each version. The full technical reference is the [deckdock/1 specification](https://github.com/NayanChauveau/deckdock/blob/main/spec/deckdock-1.md).

## The deckdock.yaml file

This is the deck’s identity card, at the root of the repository.

```yaml
id: european-capitals
name:
  fr: Capitales d’Europe
  en: European capitals
icon: 🏛️
description:
  fr: Les capitales des pays d’Europe, avec leur carte.
  en: The capitals of European countries, with their map.
editions: [fr, en]
license: CC-BY-4.0
homepage: https://github.com/your-name/capitals-deck
options:
  new_per_day: 20
  reviews_per_day: 200
```

| Key | Required | Purpose |
| --- | --- | --- |
| `id` | yes | The deck’s id: lowercase letters, digits and single dashes (`european-capitals`). It is also the id you give when creating the deck on this site. **Permanent once published.** |
| `name` | yes | The deck’s name: one text, or one text per edition (`fr:`, `en:`…), which must then cover every edition. |
| `editions` | yes | The list of published editions, for example `[fr, en]`. **Permanent once published.** |
| `description` | no | A short text (Markdown), shown on the deck’s page. One text, or one per edition. |
| `icon` | no | A single emoji, shown next to the deck in the catalogue and on its page. A flag or a combined emoji counts as one. Without an icon, the site shows the name’s initial. |
| `license` | no | The content’s licence, for example `CC-BY-4.0` or `CC0-1.0`. Shown on the deck’s page. |
| `homepage` | no | The address of the deck’s source. If you leave it out, GitHub’s CI fills in your repository’s address. The site shows it as a **Source** link on the deck’s page, if it starts with `https://`. |
| `options` | no | The suggested study settings: `new_per_day` (new notes per day) and `reviews_per_day` (reviews per day), whole numbers. |

> **Note**
> Repositories created from an earlier version of the template need no change: `icon` and `homepage` are optional.

## Editions

An edition is a version of the deck in one language (or one variant): each has its own address, which learners paste into Anki, and its own versions. In the template, an edition code is a **language code**: `fr`, `en`, `pt-br`… The `en` edition is compiled to `dist/en/deck.json`.

A note’s text is written either directly on the note (the same in every edition), or in one block per edition (`fr:`, `en:`). A note without a block for an edition is left out of that edition.

## Note types

Each note has an `id` (unique across the whole deck, **permanent once published**) and a `type`. Common optional keys: `deck` (a sub-deck, such as `Europe::West`), `tags` (a list of tags) and `status` (`draft` for a draft, left out of the deck).

**`basic`**: a question, an answer.

```yaml
- id: capital-australia
  type: basic
  tags: [oceania]
  front: What is the capital of Australia?
  back: Canberra
```

**`reversed`**: like `basic`, but Anki also creates the card the other way round.

```yaml
- id: canberra
  type: reversed
  front: Canberra
  back: Capital of Australia
```

**`cloze`**: fill in the blanks. Each `{{c1::…}}` is a blank; the numbers (`c1`, `c2`…) group blanks into cards. `extra` is shown on the back.

```yaml
- id: mitochondria
  type: cloze
  text: "{{c1::Mitochondria}} produce most of the cell’s {{c2::ATP}}."
  extra: "Source: biology course, week 3."
```

**`mcq`**: multiple choice, with at least two choices, exactly one of them correct. `explanation` is shown on the back.

```yaml
- id: river-paris
  type: mcq
  question: Which river flows through Paris?
  choices:
    - {text: Seine, correct: true}
    - {text: Loire}
    - {text: Rhône}
  explanation: The Loire and the Rhône are other major French rivers.
```

Texts accept Markdown: `**bold**`, `*italics*`, lists, links.

## Media

Images and sounds go in the repository’s `media/` folder and are used with the path `media/<name>`:

```markdown
![Map of Australia](media/australia.png)
```

- No other location is accepted: only `media/<name>`.
- Describe the image in the text between the square brackets: this is what people who cannot see it will read.
- Limits: 10 MiB per file, 500 MiB of media per edition, and 50,000 notes per edition.

## Versions

Each publication creates a **version** of each edition. The template’s CI names it after the commit’s date and time (in universal time) followed by its short id, for example `2026-11-26T10:00:00Z+a1b2c3d`.

- The site orders versions by arrival: the last one received is the one learners get.
- Re-running CI on the same commit sends the same version with the same files: the site answers `already_published`, and nothing changes.
- The same version with different files is refused: make a new commit, which gives a new version.
- A deck compiled on your computer without a version carries the version `"dev"`, which the site refuses: publish from CI, or set a version (see [Publish without GitHub](/en/guide/publish-without-github)).

## What breaks compatibility

Learners already have your notes and their types in their Anki collection, with their progress. Some changes go through without trouble, others don’t:

| Change | Effect for learners |
| --- | --- |
| Note text, tags, adding or removing notes, card layout and style | Applied normally, progress kept. |
| Adding a field **at the end** of a note type | Accepted with a warning: learners will need a full sync with AnkiWeb. Avoid it if you can. |
| Removing, renaming or reordering fields, adding or removing a card side, switching between `basic` and `cloze` | **Refused** by the site, to protect learners. Create a new note type for new notes instead. |
| Changing the deck’s `id`, an edition code or a note’s `id` | Never do this: Anki would see new notes, and learners would lose the progress of the old ones. |

> **Warning**
> Never rename an `id` that is already published, not even to fix a typo. To remove a note, delete it; to replace it, create a new one with a new `id`.
