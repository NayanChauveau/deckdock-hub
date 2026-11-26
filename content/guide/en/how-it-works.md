# How it works

DeckDock lets you share an Anki deck that keeps itself up to date for everyone who studies it: fix one note or add ten, and every learner gets the new version without losing their progress.

## What is a DeckDock deck?

For the learner, it is an ordinary Anki deck: notes, reviews, statistics. The difference lies in how it is written and delivered.

- **The content is written in text files**, a bit like a list: a question, an answer, a few tags. You don’t need Anki to write it.
- **These files live in a GitHub repository**, an online folder that keeps the history of every change.
- **Every change triggers an automatic check** that tests the files, builds the deck and sends it to this site.

A deck can come in several **editions**: usually one per language (`fr`, `en`…). Each edition has its own address and its own versions.

> **Note**
> In Anki, a *note* is what you write (a question and its answer); Anki turns it into one or more *cards* to review. This site counts notes.

## Why a repository rather than an .apkg file?

An `.apkg` file is a frozen snapshot: if you fix a mistake, you have to send the file to everyone again, and each of them has to import it again. With a repository:

- **updates reach learners on their own**, with nothing to re-import;
- **the history is complete**: you can see what changed and when, and go back if needed;
- **others can suggest fixes**, which you accept or not (on GitHub, this is called a *pull request*);
- **there is nothing to install**: everything happens in your browser, on the GitHub website.

## What learners get

The learner installs the [DeckDock add-on](https://github.com/NayanChauveau/deckdock/tree/main/addon) in Anki once (a one-click install page is coming soon). Then:

1. they find your deck in this site’s catalogue and copy the address of the edition they want;
2. in Anki, they open **Tools › DeckDock**, click **Add** and paste the address;
3. the deck is installed; whenever you publish a new version, the add-on offers it and applies it.

Their reviews carry over from one version to the next: a corrected note is still the same note for Anki, with its history. This is why a few things (the deck’s id, the edition codes, the notes’ ids) must never change once the deck is published. The details are in [The format in detail](/en/guide/format).

## Review by an administrator

To keep the catalogue trustworthy, **the first version of a new deck is reviewed by an administrator** before it appears in the catalogue.

- In the meantime, the deck is already online: you can test it in Anki with its address, shown in your author space. It just isn’t listed yet.
- Once approved, the deck appears in the catalogue with its own page (description, editions, a preview of a few notes).
- **Later versions are published straight away**, with no further review.

An administrator can also hide a deck, with a reason shown on its page. To take one of your decks off the site, write to the hub’s administrator: their details are in the legal notice.

## Two ways to publish

- **[Publish with GitHub, step by step](/en/guide/publish-with-github)**: the recommended way, even if you have never written code. You start from a ready-made template and do everything on the GitHub website.
- **[Publish without GitHub](/en/guide/publish-without-github)**: for people who already build their deck with their own tools and want to send it with a command or a plain HTTP request.
