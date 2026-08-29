# The vault convention

Plain markdown files on disk. Three equal clients read and write them — the app,
Obsidian, and your coding agent — and **none of them may store anything the
others cannot read.** If Obsidian renders it as garbage, it is wrong. That
rejects designs; it is not a preference.

## Layout

```
CONVENTION.md    this file — the rules, visible while you work
AGENTS.md        what an agent may do here
CLAUDE.md        a pointer to AGENTS.md
index.md         the catalog — every page, one line each
log.md           append-only history of what happened when
context/         who you are — read before writing in your voice
notes/           anything read as prose
topics/          living hubs
tags/            subjects — near-empty pages you link instead of #tagging
canvas/          spatial boards (.excalidraw.md)
inspo/           visual reference — embeds and captions, ordinary markdown
projects/        a folder per project
raw/             immutable sources the vault cites but never edits
attachments/     images and binaries
.trash/          deleted pages, recoverable
.history/        pre-overwrite snapshots
```

## Frontmatter

```yaml
---
id: 01J2XKQ8V3N4P5R6S7T8W9Y0ZA
kind: note
title: Quiet Industrial Dashboards
created: 2026-05-24T18:34:25+00:00
updated: 2026-07-29T16:40:00+00:00
tags: [design, dashboards]
aliases: [Quiet Dashboards]
---
```

`id`, `kind`, `title`, `created`, `updated` are **required**. `id` is a ULID and
never changes — it is the page's identity, which is why filenames are free to.

Optional, by content rather than by kind: `url`, `og_title`, `og_description`,
`og_image`, `og_site_name`, `author`, `captured`, `source`, `status`,
`start_date`, `parent`, `children`.

**Timestamps keep the `+00:00` form, unquoted.** Obsidian renders them as dates
that way. Do not let a YAML library rewrite them to `Z` or to a date object.

**Wikilinks in frontmatter must be quoted.** `parent: [[X]]` is a nested flow
sequence in YAML, not a link. Write `parent: "[[X]]"`.

## The four kinds

| `kind` | Folder | Files |
| --- | --- | --- |
| `note` | `notes/` | one `.md` — anything read as prose |
| `topic` | `topics/` | one `.md` — a hub with attachments, thread, children |
| `canvas` | `canvas/` | a board (`.excalidraw.md`) or a canvas file (`.md` + `.canvas` sidecar) |
| `inspo` | `inspo/` | one `.md` — a reference wall, items in the body |

`kind` is authoritative; the folder is not. **A project is not a kind** — it is a
folder under `projects/` holding a folder note (`<project>/<project>.md`) plus
its member pages.

How a `note` renders is decided by its frontmatter, not by a subtype: `url` +
`og_image` → bookmark card; `url` alone → link with a source line; a body that is
a single blockquote → pull-quote; otherwise an article.

## Filenames

**`<folder>/<Title>.md` — the filename IS the title**, sanitised only for the
characters the filesystem rejects (`/ \ : * ? " < > |`).

This matters more than it looks. Obsidian resolves `[[Wikilinks]]` against the
**filename basename and `aliases`** — it never reads a `title:` field. A
kebab-slug filename with `[[Title]]` links would leave every link in the vault
unresolved.

Resolution order: **filename basename → `aliases` → relative path**,
case-insensitive.

> **Any page whose filename cannot equal its title** — because it was sanitised,
> or suffixed after a collision — **must carry the true title in `aliases`.**
> Otherwise inbound links stop resolving.

macOS is case-insensitive, so `Design.md` and `design.md` are one file. On
collision, append a 4-char id suffix: `design-k3f9.md`.

## Links

Exactly one form:

```markdown
[[Quiet Industrial Dashboards]]
[[Quiet Industrial Dashboards|the dashboard piece]]
![[reference-01.png]]
![[mood-board.canvas]]
```

**Never `[[<ULID>]]`.** Obsidian looks for a file named `<ULID>.md`, finds
nothing, and the link is an orphan. This is the single most common way a
generated vault ends up Obsidian-dead: the exporter knows the id, so it writes
the id. Write the title.

Structural references (`parent`, `children`, project membership) are wikilinks
too, so they show up in Obsidian's Properties panel and its graph.

## Tags

Two mechanisms, two jobs. Do not mix them.

**Subjects are tag pages.** A subject lives as a page in `tags/` — lowercase
basename, standard frontmatter, empty body: `tags/economy.md`. Filing a page
under a subject means *linking* it: write `[[economy]]` where the subject comes
up. The backlinks of the tag page are the collection — Obsidian's graph and
backlink pane and the app's BACKLINKS card all show it with no extra machinery.
An empty tag page is not a stub to fill; **emptiness is the design.** If a
subject accumulates prose of its own it has outgrown its tag page — that is
what `topics/` is for. A tag is not a kind: tag pages are `kind: note`, and the
`tags/` folder marks the role, exactly as `projects/` does for projects.

**Native tags are workflow, never subject matter.** Frontmatter
(`tags: [draft, current]`) or inline (`#stub`) mark state — status, lifecycle,
review marks. They filter and colour; they are not structure. If a native tag
names what a page is *about*, it should have been a tag-page link.

Adopting an existing vault that tagged subjects in frontmatter? Convert each to
a tag-page link when the page is next touched — not in a bulk pass. A migration
that rewrites every file at once is a migration whose mistakes you cannot see.

## The index and the log

Two root pages keep the vault navigable as it grows.

**[[index]] is the catalog** — every page, one line each, grouped by folder.
It is how a fresh agent session finds anything without grepping blind.
**Update it whenever a page is added, retitled or trashed.** A page missing
from the index is invisible to the wiki loop.

**[[log]] is append-only history** — one entry per ingest, filed answer, lint
pass or structural change, with a fixed prefix so unix tools can parse it:

```
## [2026-08-01] ingest | Article title
```

`grep "^## \[" log.md | tail -5` is the last five events. Never rewrite an old
entry.

## Raw sources

`raw/` is the source layer: clipped articles, transcripts, exports — material
the vault cites but did not write. **Read-only by convention:** once a file
lands there, nothing edits it. Raw files carry no frontmatter; every client
treats them as displayable but not writable, and pages distill them — never
absorb them wholesale. The page cites `raw/`; `raw/` never links back.

## Body sections

Structured content is ordinary markdown so Obsidian renders it:

```markdown
## Attachments
### Some article (web)
Source: https://example.com

## Thread
**user** 2026-07-28T11:02:00+00:00
Pull the type references together.

**assistant** 2026-07-28T11:02:40+00:00
…
```

The five structural headings are `## Thread`, `## Attachments`, `## Links`,
`## Mentions`, `## Board contents`.

**Escaping.** When *user content* would begin with one of those five headings —
or with `**user** ` / `**assistant** ` — prefix the line with a backslash so it
cannot forge a section boundary. Only those lines. Your own `## Design notes`
is ordinary prose and is left alone.

That backslash is the whole difference between structure and prose, so it
decides where a client may compose one: **a section is written below the
escape, never through it.** Escape the prose, then append the sections — a
client that builds `## Attachments` into the body and escapes the result has
just written `\## Attachments` and unmade the section it meant to create.
Sections sort in the order listed above, and they come after the prose: once
one starts, the rest of the body is structure.

**An attachment**, inside `## Attachments`, is one `###` block:

```markdown
### Some article (link)
Source: https://example.com

why it matters
```

The parenthesis is the source label — `text`, `markdown`, `link`, or which
assistant a conversation was exported from. `Source:` is the URL, and only on
the line directly beneath the heading; one blank line down it is the
attachment's own first sentence. A URL is http(s) or it is dropped, as
everywhere else. Everything after the blank line is the material, escaped
**strictly** — `###` included, because a pasted conversation is full of them
and one of them would otherwise start the next attachment.

## Canvas

`kind: canvas` means a **board**: a single `canvas/sketch.excalidraw.md`, no
sidecar, in the format the Obsidian Excalidraw plugin writes. Its frontmatter
carries `excalidraw-plugin: parsed`, which is the marker that makes the plugin
open it as a drawing rather than as a note; the scene itself lives in a
`## Drawing` block inside a `%%` comment, so Obsidian renders the file as an
ordinary note when the plugin is not installed. A vault of boards therefore
still opens with no plugin — you see the notes, not the pictures.

> **On `.canvas`.** JSON Canvas files are Obsidian's, and they remain perfectly
> legal in a vault — Obsidian creates and edits them, and nothing here touches
> them. They are simply **not pages of this convention**: not a kind, not
> listed, not opened. There was a second form (`board.md` + a `board.canvas`
> sidecar, embedded with `![[board.canvas]]`) and a client that rendered it
> read-only; both are gone. One kind, one format, one editor.
>
> A conforming client must still **know a `.canvas` exists**, because Obsidian
> resolves `[[Sketches]]` against every file in the vault: `Sketches.canvas`
> owns that name, so no page may be created with it. Ignore that and you make
> every `[[Sketches]]` in the vault ambiguous, silently, in files you did not
> write. A client must also never serialize frontmatter over one — a `.canvas`
> holds JSON, and a YAML header written into it destroys the geometry.
>
> A legacy `.md` still carrying `kind: canvas` with no scene is markdown. Render
> it as markdown; leave its `![[…canvas]]` line alone.

A board has no `kind:` field of its own to read when the plugin authored it, so
the extension is authoritative there.

### A board describes itself in markdown

The scene is base64 inside the `## Drawing` block, which no other client can
read. So a board carries three **derived index sections**, regenerated from
the scene on every write and never parsed back into it:

| section | one entry per | written as |
| --- | --- | --- |
| `## Text Elements` | text element | `the words ^elementId` |
| `## Element Links` | shape carrying a link | `elementId: [[Some Note]]` |
| `## Embedded Files` | image in the scene | `fileId: [[attachments/pic.png]]` |

This is what makes a board legible to everything that is not a drawing
editor. The words are searchable; a link drawn on a shape is an ordinary
wikilink, so it resolves in Obsidian and counts as a mention in the graph; and
an image is a real file in `attachments/`, not a megabyte of base64 with no
name. An agent reading the file learns what the picture says, what it points
at, and what it shows, without decoding anything.

The scene is authoritative and these are its index — never the reverse. A
client regenerates all three from the scene it is about to write, and drops an
entry whose element is gone. An image with no vault file is left out rather
than named speculatively: a broken wikilink is worse than none.

### One owner per scene

| form | written by | in this app |
| --- | --- | --- |
| board — `.excalidraw.md` | this app, and Obsidian | edited and saved here |
| `.canvas` | Obsidian, alone | not a page — left exactly as found |

**A board is edited here.** It is the one spatial thing this app owns, so
freehand work has exactly one home rather than a choice of two half-editors.

**A `.canvas` is Obsidian's, alone.** A second editor for JSON Canvas would be
a worse one, and two editors writing the same geometry is how boards get
corrupted. This app once rendered them read-only and handed off; that is gone,
because a read-only renderer is a second spatial engine to maintain and
"read-only" was a promise it had already broken once — the editing half sat
behind a flag that hid the toolbar and left the handlers live, so a stylus
stroke wrote a YAML header over somebody's board.

A client must not offer editing it cannot save. Showing a disabled pen, or a
control that quietly discards what it captures, is worse than showing nothing —
the user has no way to tell which of their work survived. If a surface cannot
write, it must not accept the gesture at all.

## Inspo

An inspo page is a **reference wall, not a canvas** — a single `.md` with no
sidecar. Items live in the body as ordinary markdown, so Obsidian renders the
same page as images with captions:

```markdown
## Group name          ← a section heading starts a group

![[attachments/a.svg]] ← the image, as a vault embed
Neon gradient hero     ← caption: any plain line
#ui #gradient          ← tags: a line of #tokens
https://example.com/x  ← source: a bare URL line

![[attachments/b.svg]] ← a blank line separates items
```

An item needs an image **or** a link; a bare link is a legitimate reference.
Items before the first heading are ungrouped.

**Only items survive an in-app edit.** Freeform prose on an inspo page is not
part of the model and is dropped when the app rewrites the page — keep prose on
a `note` and link to it.

## What is never indexed

`.git/`, `.obsidian/`, `.trash/`, `.history/`, and any dot-prefixed directory.

`.obsidian/` **is** worth committing — the vault's own config should travel with
it, so a clone opens with the same settings. `.trash/` and `.history/` are
**not**: they are recovery scratch space, they churn on every write, and
committing them would bury real history under thousands of snapshots.
`.DS_Store` is ignored because macOS writes it everywhere.

`.canon-vault` at the root records which version of this convention the vault
was built against:

```json
{ "convention": 1 }
```

Clients read it to know how to interpret the files. It is the one thing that
makes a future format change safe, so do not delete it.

## Write safety

- **Deletes** move to `.trash/<original-path>`. Never a hard delete — the File
  System Access API has no OS trash and no undo.
- **Overwrites** copy the current file to `.history/<id>/<ISO-timestamp>.md`
  first, pruned to the last 10 per page.
- **Conflicts**: re-read `updated` from disk before writing. If it changed,
  refuse and offer reload-or-overwrite; on overwrite, save the disk version to
  `<name> (conflict <YYYY-MM-DD>).md` first.

Neither side's work is ever silently lost. None of this depends on git.

## Validating

Run this against the vault before trusting a bulk edit. It checks that every
file survives parse → serialize **byte for byte**, that required frontmatter is
present, and that no ULID wikilink or malformed canvas has crept in:

```sh
curl -sO https://raw.githubusercontent.com/rabindranath1311/canon-vault/main/scripts/verify-vault.mjs
node verify-vault.mjs --vault .
```

If you have the app's repo checked out, `node scripts/verify-vault.mjs --vault
<path>` does the same thing. It needs Node and nothing else — no install step.
It exits non-zero on any failure and prints one line per problem.
