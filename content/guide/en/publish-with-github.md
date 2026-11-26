# Publish with GitHub

This guide takes you from nothing to a deck online, without installing anything on your computer and without knowing how to code. Allow half an hour the first time. You need an email address and a web browser.

## 1. GitHub in a nutshell

[GitHub](https://github.com) is a free website that hosts projects as folders of files, called **repositories**. For a deck, it brings three things:

- it **keeps the history** of every change (who changed what, and when);
- it lets other people **suggest fixes**;
- it can **run automatic tasks** on every change, in a tab called **Actions**. This is what checks your deck and sends it to this site.

A few words you will come across on GitHub:

| Word | What it is |
| --- | --- |
| Repository | The online folder that holds your deck. |
| Commit | A saved change, with a short message describing it. |
| `main` | The main version of the repository. Every commit on `main` publishes a new version of the deck. |
| Workflow | The list of automatic tasks run on every commit. |

## 2. Create a GitHub account

1. Open [github.com/signup](https://github.com/signup).
2. Enter your email address, a password and a username, then follow the steps (GitHub emails you a code to confirm your address).
3. Pick the free plan (*Free*) if asked: it is more than enough.

## 3. Create your deck from the template

Rather than starting from a blank page, you copy a template that already has everything you need: the file layout, example notes and the automatic check.

1. Open the template: [github.com/NayanChauveau/deckdock-template](https://github.com/NayanChauveau/deckdock-template).
2. Click the green **Use this template** button, then **Create a new repository**.
3. Name your repository, for example `capitals-deck`. Leave it **Public**: anyone will be able to read your deck and suggest fixes.
4. Click **Create repository**.

<!-- capture: the green "Use this template" button on the template's page, menu open on "Create a new repository" -->

You now have your own repository, with these folders and files:

| Item | Purpose |
| --- | --- |
| `deckdock.yaml` | The deck’s identity card: id, name, description, icon, editions. |
| `cards/` | Your notes, in one or more files. |
| `media/` | The images and sounds your notes use. |
| Everything else | The tools that build and check the deck. You don’t need to touch them. |

## 4. Edit a file on the GitHub website

Everything can be edited right in your browser:

1. In your repository, click the file you want to change (for example `deckdock.yaml`).
2. Click the pencil icon (**Edit this file**), at the top right of the file’s content.
3. Make your changes in the editor.
4. Click the green **Commit changes…** button, write a short message (for example “Deck name”), leave the option that saves to `main` selected, then confirm with **Commit changes**.

<!-- capture: the pencil icon "Edit this file" and the green "Commit changes…" button on an open file -->

To create a file, use **Add file › Create new file**; to add an image, **Add file › Upload files**.

Every commit runs the workflow, which checks the deck (you will see it in step 9). Until the deck is linked to this site, it publishes nothing: you can experiment as much as you like.

### YAML files

The deck’s files are written in **YAML**, a text format designed to be read by humans. The rules to know:

- each line looks like `key: value`;
- **spaces at the start of a line matter**: they show what belongs under what. Use spaces, never tabs, and keep the same indentation for items at the same level;
- a line starting with `- ` is an item in a list;
- a line starting with `#` is a comment, and is ignored;
- if a text contains `:` or starts with a special character, put it in quotes: `"Question: why?"`.

## 5. Give the deck its identity

Open `deckdock.yaml` and edit it as in step 4:

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
```

- `id` is the deck’s id: lowercase letters, digits and dashes. You will also give it to this site in step 7.
- `editions` lists the languages you publish. Only one language? Write `editions: [en]`, and a plain name: `name: European capitals`.
- `icon` is optional: a single emoji, shown next to the deck in the catalogue.

> **Warning**
> Choose the `id` and the `editions` codes carefully: once the deck is published, they must never change. Changing them would make every learner lose their progress. The name, description and icon can change at any time.

## 6. Write your notes

Open `cards/hello.yaml` to see examples. The template calls notes `cards`: each note is a block that starts with `- id:`.

```yaml
cards:
  - id: capital-france
    type: basic
    fr:
      front: Quelle est la capitale de la France ?
      back: Paris
    en:
      front: What is the capital of France?
      back: Paris
```

- `id` identifies the note, and must be unique across the whole deck. **Never change it once published.**
- `type` sets the kind of note: `basic` (question and answer), `reversed` (both ways), `cloze` (fill in the blanks) or `mcq` (multiple choice). Examples in [The format in detail](/en/guide/format).
- An `fr:` block and an `en:` block give the text of each edition. A note without a block for an edition is left out of it.

To get started, replace the `hello-…` example notes with your own. You can spread your notes over several files in the `cards/` folder, by topic: **Add file › Create new file**, then type for example `cards/europe.yaml` as the name.

For an image: upload the file to `media/` (**Add file › Upload files**), then write `![Description of the image](media/map-of-france.png)` in the note’s text.

## 7. Create the deck on this site

1. **Sign in** with the **Sign in** button at the top of the page: enter your email address and open the link you receive. There is no password; the link works once and expires after 15 minutes.
2. **Choose your handle** in **My decks**. It appears in the address of all your decks and **cannot be changed afterwards**: 3 to 30 characters, lowercase letters, digits and dashes.
3. Click **+ New deck** and enter the deck’s id: exactly the value of `id` in your `deckdock.yaml`. Confirm with **Create the deck**.
4. The site shows the **publish token**, a long string of characters starting with `ddk_`. **Copy it right away**: it is shown only once.

> **Warning**
> The token lets anyone publish in your name: never paste it into a file of the repository, where everyone could see it. It only goes into a *secret*, in the next step. Lost or leaked token? On the deck’s page, **Regenerate the token** creates a new one and disables the old one.

## 8. Link the repository to this site

The workflow needs two things: the token (a **secret**, which GitHub keeps hidden) and this site’s address (a **variable**, which stays visible).

1. In your repository, open the **Settings** tab (at the top, to the right of the other tabs).
2. In the menu on the left, open **Secrets and variables**, then **Actions**.
3. **Secrets** tab: click **New repository secret**. Name: `DECKDOCK_TOKEN`. Secret: the token you copied in step 7. Confirm with **Add secret**.
4. **Variables** tab: click **New repository variable**. Name: `DECKDOCK_HUB_URL`. Value: this site’s address, as shown on your deck’s page in your author space. Confirm with **Add variable**.

<!-- capture: the "Secrets and variables › Actions" page with the "New repository secret" button -->

<!-- capture: the "New repository variable" form filled in with DECKDOCK_HUB_URL -->

Copy the names exactly, in capitals: `DECKDOCK_TOKEN` and `DECKDOCK_HUB_URL`.

## 9. Publish and follow the publication

Adding the secret and the variable doesn’t start anything: publishing happens on the **next commit to `main`**. Make a small change (fix a note, for example) and commit it.

Then open your repository’s **Actions** tab. Every commit starts a run of the **Deck** workflow:

- a yellow dot: running;
- a green tick: all went well;
- a red cross: a step failed (see step 10).

<!-- capture: the Actions tab with a successful run (green tick) and a failed run (red cross) -->

Click a run, then **build**, to see its steps one by one: the tests, building the deck (*Compile the deck*), checking it, then sending it (*Publish to DeckDock hub*), once per edition.

After the first publication:

- the deck is **awaiting approval**: an administrator will review it before it appears in the catalogue;
- you can already **test** it: the deck’s page, in your author space, shows the address of each edition with a button to copy it. Paste it into Anki, under **Tools › DeckDock › Add**.

From then on, every commit to `main` publishes a new version, which reaches learners. Re-running a run that already succeeded creates no duplicate: the site answers that this version is already published.

## 10. Fix a check error

A red cross is nothing serious: nothing was published, and the previous version stays online. To find the cause:

1. open the failed run in the **Actions** tab, then **build**;
2. expand the step marked with a red cross and read its last lines: the message says what is wrong, and often where.

An error in your files looks like this, with the file and the line number:

```text
cards/europe.yaml:12: ...
```

Open that file, go to the line shown (the GitHub editor shows line numbers on the left), fix it, then commit: a new run starts.

The most common causes:

| What you see | What to do |
| --- | --- |
| A YAML error near a line | Check the spaces at the start of the lines, and put texts containing `:` in quotes. |
| An id that is refused | Only lowercase letters, digits and single dashes, with no spaces or accents. |
| A duplicate id | Every note needs a different `id` across the whole deck. |
| A file not found in `media/` | Check the exact spelling of the name, capitals and extension included. |
| A multiple-choice note refused | An `mcq` note has at least two choices, exactly one of them with `correct: true`. |
| `Invalid or revoked publish token` | The `DECKDOCK_TOKEN` secret is wrong or the token was regenerated: copy a new token into the secret. |
| `deck.id … does not match the deck of this token` | The `id` in `deckdock.yaml` differs from the id of the deck created on this site: they must be the same. |
| `This deck awaits approval and already has 3 versions` | A deck awaiting approval receives at most 3 versions: wait for the review, then publish again. |
| `Too many publish requests` | Wait a few minutes, then re-run with **Re-run jobs**. |

An error in the *Publish to DeckDock hub* step comes from this site; the table of possible answers is in [Publish without GitHub](/en/guide/publish-without-github#the-hub-s-answers).

> **Note**
> Changing the structure of a note type that is already published (removing, renaming or reordering its fields) is refused, to protect learners’ progress. With the template’s note types, this doesn’t happen. See [The format in detail](/en/guide/format#what-breaks-compatibility).
