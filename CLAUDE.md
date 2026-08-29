# Canon Vault — agent contract

A personal capture + thinking OS. **Plain markdown files on disk, read and
written directly by a static web app. No server, no database, no cloud.**

Obsidian and your coding agent are first-class clients of the same files. This
file is the contract for agents working in **this repo — the app**. The vault
has its own `CLAUDE.md` and `CONVENTION.md`; they govern file *content*, this
one governs the *code*.

---

## The two repos

| | |
| --- | --- |
| **This repo** | the app: static HTML/JS/CSS. Publishable, and **this is what deploys** — `vercel.json` serves `app/` as static files with no build step. |
| **The vault** | the user's notes — a **separate git repo**, a sibling, never inside this one. |

**Never put real vault content in this repo** — no pages, no screenshots, no
exports, no page titles, not even in a test fixture. This is structural, not a
preference: `backup/` is gitignored, and the migration tooling that reads real
content lives outside the repo entirely. Seed a fictional demo vault instead.

---

## The model, in one line

Four kinds — `note`, `topic`, `canvas`, `inspo` — selected by `kind:` in
frontmatter, not by folder. A project is a folder, not a kind — and the app
treats it as one: the project page opens on its contents grouped by kind, and
has no description, tags or mentions of its own. The things inside it have
those. `metaForPage` gives `projects/X/X.md` the Project pill whatever `kind:`
it carries on disk.

**The file format is defined in [brain/CONVENTION.md](brain/CONVENTION.md)** —
the single authority, and public because a spec that only exists in someone's
private vault cannot be the contract other clients implement.

The app has no build step, so it cannot read that file at runtime; the text is
mirrored into `app/vault/brain-text.js` by `node scripts/sync-convention.mjs`.
**Edit the markdown, never the mirror.** `app/test/convention.test.js` fails on
drift, so the duplicate cannot rot silently.

What the code needs to know:

- Wikilinks resolve **basename → aliases → path, case-insensitive**
  ([app/vault/links.js](app/vault/links.js)). Obsidian never reads a `title:`
  field, so any code that assumes otherwise produces dead links. This is the
  single most important invariant in the codebase. Links inside code fences and
  code spans are masked out before scanning, because Obsidian does not linkify
  them either.
- **A filename is addressing, not decoration** — it follows from the invariant
  above. So a new page takes a name free across the *whole* vault (not just its
  folder), a blank one is `Note <date>` rather than `Untitled`, and the file is
  renamed when the title settles — `renamePlan` in
  [app/vault/data.js](app/vault/data.js), `Vault.rename` in
  [app/vault/vault.js](app/vault/vault.js). A file the user named deliberately
  is never moved, and an inbound link to the old name is kept alive as an alias
  rather than by rewriting somebody else's file.
- `KIND_ORDER` in [app/app.js](app/app.js) is the *by-kind nav*, not the set of
  kinds: it carries `bookmark` and `drawing` as derived facets. Bookmark is
  inclusive (`kind === "note" && url != null` — the note count keeps them,
  since on disk that is what they are); the `drawing` facet is `kind ===
  "canvas" && isExcalidrawPath`. The four real kinds are the ones above.
  **`drawing` is the internal id of the facet the UI labels "Board"** — the id
  is deliberately not renamed, because it is in saved routes (`#kind:drawing`)
  and persisted tabs, and a rename would strand them.
- `note` chrome is chosen from frontmatter, not kind — which is why bookmark,
  snippet and markdown collapsed into one.
- `canvas` is **one kind over two formats with two different owners**, so the
  chrome is chosen from the path: `metaForPage` in [app/app.js](app/app.js)
  labels a `.excalidraw.md` "Board" and a `.canvas` "Canvas". That label is the
  only thing telling a user whether their edits will be kept, so it is decided
  in one place and never re-derived at a call site. **Two things must never
  both be called Board** — "Board" moved from the `.canvas` reader to the
  Excalidraw surface when that reader was deleted, and the `.canvas` form took
  the name of its own format. **`metaForPage` takes the page, not its `kind`**
  — it also resolves the bookmark facet, reading `url` both hoisted (index
  entries) and under `meta` (full pages). Anything showing a kind asks it;
  `KIND_META[p.kind]` at a call site is the bug.
  - **`.canvas` is not a page at all.** Not listed, not opened, not counted —
    the nodes-and-edges reader, its curve math, `SB_EDGE_GEOM` and the stub
    screen were all **deleted**. Two things survive and are not optional:
    `Vault.reservedNames` (a bare `.canvas` still owns its wikilink name, or
    the app writes a second file by that name and makes every `[[Sketches]]`
    ambiguous — in files it did not write), and the redirect in `put()` (a
    write aimed at a `.canvas` lands on the `.md` sibling, because YAML
    serialized over JSON destroys the geometry). `layoutFromCanvas` also
    survives, for the "import the old board" button on an inspo wall.
    A legacy `.md` carrying `kind: canvas` with no scene renders as markdown.
  - **Board** (`.excalidraw.md`) → `renderExcalidrawBody`, the vendored
    Excalidraw editor, dynamically imported so a vault with no boards ever
    loads its ~8MB. `window.EXCALIDRAW_ASSET_PATH` must be an **absolute** URL
    — the bundle feeds it to `new URL(file, base)`, and a relative base throws
    once per text element, so every board renders its shapes and none of its
    words. Derive it from `document.baseURI`; never hardcode an origin.
    Text, element links and embedded images are **regenerated into the
    markdown on every write** (`## Text Elements` / `## Element Links` /
    `## Embedded Files`) so the scene is legible to Obsidian, to the backlink
    graph and to an agent. Never parse those sections back into the scene.
    `appState.collaborators` is a Map and must never be serialized — see
    `cleanScene` in [app/vault/excalidraw.js](app/vault/excalidraw.js).
  - **Inspo is not a canvas.** It shares CSS class names and nothing else: a
    bento wall whose order lives in the markdown body, with no geometry at all.
- **A structural body section is composed below the escape, never through it.**
  `Vault.put` runs `escapeUser` over the body, which backslashes any of
  CONVENTION's five headings in it — that is what keeps a user's typed
  `## Attachments` from forging a section. So the two halves travel separately:
  `Vault.get` hands back `body` (the prose, unescaped) and `sections` (verbatim,
  still escaped), and `put` takes them the same way and appends the second below
  the escape. **Omitting `sections` on a write PRESERVES what is on disk** —
  retitle, re-id and every other writer that has never heard of a tray would
  otherwise be a way to lose one. The tray itself cannot live in frontmatter:
  FIELD_ORDER has no key for it, `serialize()` throws on an unknown one, and it
  emits only scalars and scalar arrays.
- `CONVENTION_VERSION` in `app/vault/scaffold.js` is written to `.canon-vault`
  in every new vault. A breaking format change bumps it and needs a story for
  reading the old form.

---

## Layout

```
app/                 the whole product — no framework, no bundler, no build step
  index.html         carries the ?v= cache-bust — bump with scripts/bump-version.mjs
  boot.js            feature-detects showDirectoryPicker; explainer or app
  app.js             screens and rendering
  styles.css         the design system — light-first, two ramps flip per theme (DESIGN.md)
  vault/             the data layer — everything below is testable in Node
    mdfile.js        the file format contract: frontmatter + body, serialize/parse
    sections.js      the five structural body headings, BELOW the escape
    attachments.js   what `## Attachments` holds: the topic page's tray
    vault.js         the data interface over two backends (File System Access, memory)
    data.js          what the old REST endpoints computed, done locally
    links.js         wikilink resolution
    dashboard.js     the landing screen
    scaffold.js      first run: scaffold an empty folder, adopt a full one
    clip.js          what a web capture becomes: wall item, bookmark, quotation
    brain-text.js    GENERATED mirror of brain/*.md — never edit by hand
    demo-vault.js    GENERATED mirror of demo/ — dynamically imported, never edit
    bridge.js        stands the vault up, exposes window.SB_DATA, loads app.js
  clipper/           the in-app "download the extension" build — NOT the data layer
    zip.js           a STORE-only ZIP writer, ~100 lines, no dependency
    bundle.js        GENERATED mirror of extension/ (base64) — never edit
  vendor/            js dependencies, vendored — markdown-it, Inter, JetBrains Mono
  test/              node --test, no npm install
extension/           the Chrome clipper — MV3, loaded unpacked, NOT deployed
  background.js      menus, shortcuts, and the queue → vault pump
  injected.js        the three functions that run inside a page
  store.js           the capture queue (IndexedDB), the handle, the settings
  writer.js          the handle, its permission, standing the Vault up
  vault/             MIRROR of app/vault — never edit; sync-extension.mjs owns it
brain/               the rules and the agent prompts — the non-code half
  CONVENTION.md      the file format: the single authority
  AGENTS.md          the standing contract, copied into every vault
  SETUP-PROMPT.md    one-shot vault bootstrap for any agent
  RECIPES.md         ongoing agent tasks: ingest, lint, dedupe, merge
demo/                the "Try a demo vault" content — INVENTED, never real
                     it must cover every kind: it is the front door, and a
                     kind missing from it is a kind nobody can see working
                     (boards had no demo file, so a font-loader bug that
                     blanked the text in every board shipped unnoticed)
docs/
  WHY.md             the argument for every constraint, and what this is bad at
  deploy.md          local run + Vercel + any static host
  connect/           obsidian.md, agents.md, sync.md
scripts/
  verify-vault.mjs   the VERIFY check: byte-identical round-trip + invariants
  sync-convention.mjs  regenerates app/vault/brain-text.js from brain/*.md
  sync-demo.mjs        regenerates app/vault/demo-vault.js from demo/
  bump-version.mjs     bumps BOTH cache-bust markers (index.html ?v= and
                       sw.js CACHE_VERSION) by reading them. Never hand-edit
                       either: a sed keyed to the wrong number matches
                       nothing, silently, and every later one misses too.
  sync-extension.mjs   mirrors app/vault/ into extension/vault/ — byte-exact,
                       enforced by app/test/extension.test.js. Run it after
                       ANY change under app/vault/.
  sync-clipper.mjs     mirrors extension/ into app/clipper/bundle.js, so the
                       app can hand over a zip of JUST the extension with no
                       server and no build step. **Runs AFTER sync-extension**
                       — it packs `extension/`, which sync-extension writes
                       into. Reverse the order and you ship a bundle holding
                       the previous data layer.
                       The bundle lives outside `app/vault/` on purpose: it is
                       what sync-extension mirrors FROM, so a bundle inside it
                       would be packed into the next bundle, and the next.
  serve.mjs            dependency-free dev server; see "Running it"
bin/                 macOS capture scripts that write straight into the vault
```

**No build step, and no npm install.** Dependencies are vendored as files.
`app/package.json` exists only so Node treats `app/**/*.js` as ES modules — it
has zero dependencies and must never gain any.

---

## Running it

```sh
node scripts/serve.mjs 8091 app      # preferred
python3 -m http.server 8091 --directory app   # works, with one caveat
```

`serve.mjs` is a dependency-free Node static server. Prefer it: it sends
`cache-control: no-cache` rather than nothing, so the service worker precache
actually populates locally — with a `no-store` (or absent) policy the Cache API
declines to store and offline silently never works in development.

Then open `http://localhost:8091`. `localhost` is a secure context, so the File
System Access API works. There is nothing else to start.

Tests and the vault check:

```sh
node --test 'app/test/**/*.test.js'
node scripts/verify-vault.mjs --vault <path-to-a-vault>
node scripts/sync-convention.mjs           # after editing brain/*.md
node scripts/sync-demo.mjs                 # after editing demo/
node scripts/bump-version.mjs              # before shipping ANY app/ change
node scripts/sync-extension.mjs            # after editing app/vault/*.js
node scripts/sync-clipper.mjs              # after that, and after ANY extension/ edit
node scripts/sync-convention.mjs --check    # what CI runs
node scripts/sync-demo.mjs --check
node scripts/sync-extension.mjs --check
node scripts/sync-clipper.mjs --check
node scripts/bump-version.mjs --check
```

The clipper is loaded unpacked from `extension/` (`chrome://extensions` →
Developer mode → Load unpacked). It is **not** deployed — `vercel.json` serves
`app/` and nothing else.

---

## Deploying

**The app deploys from this repo**, not from the marketing site's repo. `app/`
is served statically — `buildCommand: null`, no framework — so a deploy is a
file copy.

Three headers matter and are set in `vercel.json`:

- `sw.js` as `application/javascript` with `max-age=0`, because a cached service
  worker can never update itself;
- `manifest.json` as `application/manifest+json`, or Chrome will not offer to
  install;
- `vendor/*` immutable for a year — it is versioned by content.

`/(.*) → /index.html` so a cold load of `/#page/<id>` resolves instead of 404ing.

> The marketing site is still a **separate** repo. What changed is only that the
> *app* deploys from here; nothing about the site moves in.

---

## Hard rules

- **No server, no Python, no database.** If a feature seems to need one, it is
  the wrong feature. `fetch()` to a URL appears zero times in `app.js`; keep it
  that way. The clipper is the one place that fetches — the image the user
  clicked on, never an endpoint. No literal URL may appear in `extension/*.js`,
  and `app/test/extension.test.js` enforces it.
- **The clipper writes through the app's data layer, and never scaffolds.**
  `extension/vault/` is a byte-exact mirror of `app/vault/` so a clip gets the
  same serializer, `.history` snapshot and conflict gate as any other write.
  `scaffold.js` is deliberately absent: a folder picked by mistake must not
  quietly become a vault.
- **Chromium only.** `showDirectoryPicker` does not exist in Safari or Firefox.
  Non-Chromium visitors get an explainer, never a blank page.
- **Never write on adoption.** A file with no `id:`/`kind:` is displayed but
  left untouched on disk. Stamping happens on the first edit through the app.
- **One owner per spatial scene.** A `.canvas` board is Obsidian's — the app
  neither renders nor writes it. A `.excalidraw.md` board is the app's — it
  is edited and saved here. Anything spatial the app writes is a board; there
  is no third engine. **Never ship editing a surface cannot save:** a hidden
  toolbar over live handlers is how a stylus stroke came to overwrite a board.
  If a surface cannot write, it must not accept the gesture.
- **No hardcoded paths or vault names.** Every path derives from the folder the
  user picked.
- **No in-app language-model features.** The agent has the whole vault already.
- **Write safety is not optional:** deletes move to `.trash/`, overwrites
  snapshot to `.history/` first, and a page changed on disk refuses to be
  written over. **And it must be visible** — `Vault.untrash()` / the Undo
  toast exist because safety the user cannot see does not reassure anyone. A
  refused save shows "Not saved" with the reason; it must never fail silently.
- **The data layer carries no cache-bust.** `boot.js` passes `?v=` to
  `bridge.js`, which passes it to `app.js` — but bridge's own static imports
  (`vault.js`, `data.js`, `links.js`, …) are bare specifiers a static import
  cannot version, and there is no build step to rewrite them. `sw.js` serves
  `/vault/*.js` **network-first** for that reason. Do not "optimise" it back
  to cache-first: a returning user would keep last deploy's data layer while
  the UI updated around it.

## Defaults & taste

- **Prefer updating a page over creating one.** Duplication is the enemy.
- **Prefer linking to copying.** A wikilink beats a restated paragraph.
- **Cite or omit.** Say when you are synthesising.
- **Dates are absolute.** Convert "last week" to `YYYY-MM-DD`.
- **Verify against the running app**, not against this file — it drifts.
