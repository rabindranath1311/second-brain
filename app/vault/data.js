// Task 6.8 / 6.1: everything the app used to fetch from /api/v2, computed
// locally from the vault index.
//
// Two surfaces on purpose:
//
//   * named methods (`pages()`, `counts()`, …) — what call sites migrate to, so
//     6.8's grep for v2Get/v2Post/… reaches zero;
//   * `get()/post()/patch()/del()` path routers — which let the old fetch layer
//     be replaced in one edit, so the app is serverless before all 84 call sites
//     have moved. Remove them once the migration is finished.
//
// Endpoints absent here are gone with their features, each ruled out by the
// spec rather than by convenience: LLM anything — chat, voice, tweet, resume
// (§16); /graph (§16); /mention-tags (ordinary notes now, task 1.6); /import,
// /backup, /extension, /capture (§11, §15); /settings/* beyond local prefs
// (6.17); /links/fetch and /preview/link (§7 — a browser page cannot fetch
// arbitrary URLs, and previews come from the clipper at capture time).

import { computeDashboard } from "./dashboard.js";
import { listImages, filterImages, isImagePath } from "./images.js";
import { isExcalidrawPath, parseExcalidraw, serializeExcalidraw,
         hasExcalidrawData, withBackOfNote } from "./excalidraw.js";
import { clipFrontmatter, urlsFromText, findByUrl, titleFromUrl } from "./clip.js";
import { parse, unescapeUser } from "./mdfile.js";
import { basenameOf, resolveWikilink, linkResolver } from "./links.js";

const DEFAULT_LIMIT = 200;

// ── filenames ───────────────────────────────────────────────────────────────
// CONVENTION rule 3: the filename carries the title, because Obsidian resolves
// `[[Link]]` by filename and never reads `title:`. Everything here exists to
// keep that mapping honest — a name that is unique across the vault, and a file
// that follows its title instead of answering to whatever it was called at
// birth.

/** The extensions that OCCUPY A NAME, longest first so `.excalidraw.md` wins
 * over `.md`.
 *
 * `.canvas` is in this list and is NOT a page — the two are different
 * questions. Obsidian resolves `[[Sketches]]` against every file in the vault,
 * so `Sketches.canvas` owns that name whether or not this app can open it.
 * Drop it from here and the app cheerfully writes `notes/Sketches.md` beside
 * it and makes every `[[Sketches]]` in the vault ambiguous — silently, and in
 * somebody else's files. What the app lists as a page is decided in
 * `vault.js`; this decides what a name costs. */
const PAGE_EXT = /(\.excalidraw\.md|\.md|\.canvas)$/i;

/** The title-derived part of a filename: `canvas/A.excalidraw.md` → `A`. */
export function pageStem(path) {
  return String(path).split("/").pop().replace(PAGE_EXT, "");
}

/**
 * A title as a filename. Leading dots go too: the index ignores dotfiles, so a
 * page named `.env notes` would be written and then never seen again.
 */
export function stemFor(title) {
  return String(title || "")
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
}

/**
 * Every page stem in the vault, lowercased, optionally excluding one path.
 *
 * Wikilinks resolve by filename across the **whole** vault, so a name is taken
 * by a file in any folder. Checking one folder was why an app-made
 * `topics/Untitled.md` could land beside an Obsidian-made `Untitled.canvas`
 * and make `[[Untitled]]` ambiguous the moment both existed.
 */
function takenStems(v, except = null) {
  const out = new Set();
  // Pages, plus the files that are not pages here but still own a name —
  // `.canvas` is not listed anywhere in this app and still answers to
  // `[[Sketches]]` in Obsidian. See `Vault.reservedNames`.
  const paths = [...v.byPath.keys(), ...(v.reservedNames || [])];
  for (const p of paths) {
    if (p === except) continue;
    out.add(pageStem(p).toLowerCase());
  }
  return out;
}

/** `stem`, or the first `stem 2`, `stem 3`, … that no other page holds. */
function freeStem(v, stem, except = null) {
  const taken = takenStems(v, except);
  let out = stem;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${stem} ${n}`;
  return out;
}

/**
 * A free name to offer for a file caught in a collision.
 *
 * In order of preference: its own title (a page called "Reading notes" living
 * in `Untitled.md` wants that name back), then the folder it sits in as a
 * qualifier — `Untitled (inspo)` says which of the two this is, where
 * `Untitled 2` says only that it lost a race — and a numbered stem last.
 */
export function suggestStem(v, path, entry = null) {
  const cur = pageStem(path);
  const low = (x) => String(x).toLowerCase();
  const taken = takenStems(v, path);
  const wanted = [];
  const fromTitle = entry && entry.title ? stemFor(entry.title) : "";
  if (fromTitle && low(fromTitle) !== low(cur)) wanted.push(fromTitle);
  const dir = String(path).split("/").slice(-2, -1)[0];
  if (dir) wanted.push(`${cur} (${dir})`);
  for (const w of wanted) if (w && !taken.has(low(w))) return w;
  return freeStem(v, cur, path);
}

/**
 * A filename nobody chose: this app's defaults, past and present, and the
 * `Untitled` Obsidian still makes. Always eligible to be renamed, however far
 * the title has drifted from it — the title is saved on a timer, so a half-typed
 * one can collide, be refused, and leave the file with a name that no longer
 * matches anything. Without this the next save would read that file as
 * deliberately named and it would keep the default forever, which is the whole
 * complaint.
 */
/* `Drawing` stays in the list after the label became `Board`: files named by
   the old default are still files nobody named, and dropping the word would
   freeze every one of them under a name its owner never chose. `Canvas` is
   here for the same reason in advance. */
const DEFAULT_STEM =
  /^(?:Untitled|(?:Note|Topic|Board|Canvas|Drawing|Wall|Bookmark|Project) \d{4}-\d{2}-\d{2})(?: \d+)?$/i;

/**
 * Where a page belongs once its title changes, or null to leave it where it is.
 *
 * A file whose name still matches its *old* title was named by that title, so
 * it should follow it — without this, a page created before it had a name
 * answers to `[[Note 2026-08-15]]` for the rest of its life, and the pool of
 * default-named files only ever grows. A file the user named deliberately (one
 * whose name and title already differ) is never moved.
 *
 * Inbound links survive as an alias instead of by rewriting other people's
 * files: Obsidian matches basename, then aliases, so `[[Old Name]]` still lands
 * here. That is the same trick CONVENTION rule 3 already uses when a title
 * cannot be spelled as a filename.
 */
export function renamePlan(v, cur, newTitle) {
  const low = (s) => String(s).toLowerCase();
  const oldTitle = String(cur.title || "").trim();
  const next = String(newTitle || "").trim();
  if (!next || next === oldTitle) return null;

  const name = String(cur.path).split("/").pop();
  const oldStem = pageStem(cur.path);
  const derived = low(oldStem) === low(stemFor(oldTitle)) || DEFAULT_STEM.test(oldStem);
  if (!derived) return null;                                     // named deliberately

  const newStem = stemFor(next);
  if (!newStem || low(newStem) === low(oldStem)) return null;
  // Taken elsewhere: stay put rather than pick `Title 2`, which would be a
  // filename the user never asked for. Rule 3's alias already carries the title.
  if (takenStems(v, cur.path).has(low(newStem))) return null;

  const dir = cur.path.slice(0, cur.path.length - name.length);
  /* "Is anything pointing here?" — asked of the body wikilinks AND of the
     structural ones. `parent:` and `children:` never appear in a body, so the
     mentions scan cannot see them; without this a renamed parent left every
     sub-page under it pointing at a name no file answers to any more. */
  const namesOld = (ref) => low(refTarget(ref).replace(PAGE_EXT, "")) === low(oldStem);
  const linked = v.list().some((e) => e.path !== cur.path && (
    (e.mentions || []).some((m) => low(String(m).replace(PAGE_EXT, "").trim()) === low(oldStem))
    || (e.parent && namesOld(e.parent))
    || (e.children || []).some(namesOld)));
  return { to: `${dir}${newStem}${name.slice(oldStem.length)}`, alias: linked ? oldStem : null };
}

/**
 * What a blank page is called. `Untitled` was the same word in every folder and
 * in Obsidian too, so the second one was always a collision; naming a page for
 * its kind and the day makes the default distinct on its own — and the file is
 * renamed the moment a real title is typed.
 */
const DEFAULT_LABEL = {
  note: "Note", topic: "Topic", canvas: "Canvas",
  drawing: "Board", inspo: "Wall", bookmark: "Bookmark",
};

/**
 * Task 2.7 / SPEC §5: how a `note` renders is decided by its FRONTMATTER, not
 * by a subtype. This is the whole reason bookmark, snippet and markdown could
 * collapse into one kind — the distinction was always in the metadata.
 *
 * Returns one of: 'bookmark card' | 'link with source line' | 'pull-quote' | 'article'
 */
export function noteChrome(page = {}) {
  const fm = page.frontmatter || page;
  const url = fm.url ?? page.url;
  const ogImage = fm.og_image || page.og_image;
  const body = String(page.body ?? fm.body ?? "").trim();
  // A present-but-empty url is still a bookmark: it is how a new one is born,
  // and it must open with a url field, not an article editor.
  if (url && ogImage) return "bookmark card";
  if (url != null && url !== undefined) return "link with source line";
  const lines = body.split("\n").filter((l) => l.trim() !== "");
  if (lines.length > 0 && lines.every((l) => l.trimStart().startsWith(">"))) return "pull-quote";
  return "article";
}
const FOLDER_FOR = { note: "notes", topic: "topics", canvas: "canvas", inspo: "inspo" };

// ── structural references ───────────────────────────────────────────────────
/* `parent` and `children` are WIKILINKS on disk, not ids — CONVENTION §Links:
   "Structural references (`parent`, `children`, project membership) are
   wikilinks too, so they show up in Obsidian's Properties panel and its
   graph", and "**Never `[[<ULID>]]`**". The app works in ids, so the seam is
   here: the disk holds a name, these two turn it into an id and back.
   A rename keeps the link alive the same way every other link survives one —
   `renamePlan` leaves the old name in `aliases`, and resolution reads aliases. */

/** The name a structural reference points at: `'[[A Page|x]]'` → `'A Page'`. */
function refTarget(ref) {
  // An unquoted `parent: [[X]]` — the mistake CONVENTION warns about — parses
  // as a one-item flow sequence. Read it rather than write a dead relation.
  const raw = String(Array.isArray(ref) ? ref[0] ?? "" : ref ?? "").trim();
  if (!raw) return "";
  const m = /^!?\[+([^\]]+)\]+$/.exec(raw);
  return (m ? m[1] : raw).split("|")[0].split("#")[0].trim();
}

/** `'[[Some Page]]'` (however it was quoted) → the id it names, or null. */
function refToId(v, ref) {
  const target = refTarget(ref);
  if (!target) return null;
  // A vault written by an older build of this app stored the id. It is not a
  // form we ever write again, but it is a relation somebody has on disk.
  if (v.index.has(target)) return target;
  const hit = resolveWikilink(target, v.list());
  return hit ? hit.id : null;
}

/** An id → the wikilink to write for it. Basename, because that is what
 *  Obsidian resolves first and the one form guaranteed to be on disk. */
function idToRef(v, id) {
  const e = id ? v.index.get(id) : null;
  return e ? `[[${basenameOf(e.path)}]]` : null;
}

/** Sub-pages of `id`: the pages that name it as their parent, plus anything an
 *  explicit `children:` list adds. The child's `parent` is the truth — a
 *  second copy of the same fact on the parent is the pair that goes stale. */
function childIdsOf(v, id, entry) {
  const out = [];
  for (const e of v.list()) {
    if (e.id === id || !e.parent) continue;
    if (refToId(v, e.parent) === id) out.push(e.id);
  }
  for (const ref of (entry && entry.children) || []) {
    const cid = refToId(v, ref);
    if (cid && cid !== id && !out.includes(cid)) out.push(cid);
  }
  return out;
}

/* `note` is the fallback bucket: inferKind sends anything it cannot place
   there, and scaffold stamps the root contract docs `kind: note`. Left
   unfiltered, the Note list fills with plumbing — raw/ sources (which carry
   no frontmatter by convention), tags/ role stubs, projects/ folder notes,
   CONVENTION/AGENTS/CLAUDE — until "your notes" means "everything else".
   Kind-filtered lists and the nav counts exclude these; All pages, search
   and wikilinks keep them, because excluded is not the same as gone. */
/** A title as the tag it would be. One rule, so `createTag` and `orbit` agree. */
export function tagSlug(name) {
  return String(name || "").toLowerCase().replace(/#/g, "").trim()
    .replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, "-")
    .replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

const CONTRACT_DOCS = new Set(["CONVENTION.md", "AGENTS.md", "CLAUDE.md"]);

/** The two root pages CONVENTION gives every vault: the catalog and the log. */
const ROOT_STRUCTURAL = new Set(["index.md", "log.md"]);

/** Never the user's content: the format contract, raw sources, tag stubs. */
export function isPlumbing(e) {
  const p = String((e && e.path) || "");
  return CONTRACT_DOCS.has(p) || p.startsWith("raw/") || p.startsWith("tags/");
}

/** `projects/X/X.md` — the folder note that fronts the Projects screen. */
export function isProjectNote(e) {
  const m = String((e && e.path) || "").match(/^projects\/([^/]+)\/([^/]+)\.md$/);
  return !!m && m[1] === m[2];
}

export function isSystemEntry(e) {
  return isPlumbing(e) || isProjectNote(e);
}

/**
 * JSON Canvas nodes → flat items.
 *
 * The board renderer that consumed this is gone; this parser is not. An inspo
 * wall made under the old canvas model still has a `.canvas` sidecar, and the
 * one-click "import the old board" button on that page is the only way its
 * items ever reach the markdown. Deleting the reader would strand those files
 * with no migration and no renderer — a file you can neither read nor convert.
 *
 * The edge parser and the curve math that lived beside this went with the
 * renderer: they existed only to DRAW a board, and nothing draws one now.
 */
export function layoutFromCanvas(canvasText) {
  let doc;
  try { doc = JSON.parse(canvasText); } catch { return []; }
  return (doc.nodes || []).map((n) => {
    const box = { id: n.id, x: n.x, y: n.y, w: n.width, h: n.height };
    if (n.type === "text") return { ...box, type: "text", text: n.text || "" };
    if (n.type === "link") return { ...box, type: "link", url: n.url || "" };
    // A `file` node points at any file in the vault, not only a picture —
    // Obsidian embeds a note that way as often as an image. Mapping every one
    // to `image` put a broken <img> on the board wherever somebody had pinned
    // a page, which is the most useful node a board has.
    if (n.type === "file") {
      const file = n.file || "";
      return isImagePath(file)
        ? { ...box, type: "image", asset: file }
        : { ...box, type: "file", file, subpath: n.subpath || "" };
    }
    // A group is a labelled frame around other nodes; without the label it
    // renders as an anonymous rectangle and the grouping stops meaning anything.
    if (n.type === "group") return { ...box, type: "group", label: n.label || "" };
    return { ...box, type: n.type };            // anything JSON Canvas adds later
  });
}

/* An Excalidraw image carries its type as a MIME string; a file on disk needs
   an extension. Only the formats the editor itself produces are listed —
   anything else keeps `.png`, which is wrong in the name but never wrong in
   the bytes, and the bytes are what an image viewer actually reads. */
const EXT_FOR_MIME = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
  "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
  "image/avif": ".avif", "image/bmp": ".bmp",
};

/**
 * `data:image/png;base64,iVBO…` → the bytes.
 *
 * Returns null for anything that is not a base64 data URL rather than throwing:
 * a scene can carry an entry we do not understand, and one strange image must
 * not cost the user the save of everything else in the drawing.
 */
export function bytesFromDataURL(url) {
  const m = String(url == null ? "" : url).match(/^data:([^;,]*);base64,([\s\S]*)$/);
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length ? out : null;
  } catch {
    return null;
  }
}


// ── inbound links ───────────────────────────────────────────────────────────

/**
 * Resolve a mention to the page it points at, the way the vault resolves one.
 *
 * A mention is whatever links a page: a wikilink target, or — when the mention
 * picker wrote it — the target's id, the one form that survives a rename. So
 * this is `resolveWikilink`'s basename → aliases → path (CONVENTION rule 3,
 * case-insensitive) with the id table behind it.
 *
 * Deliberately NOT the target's `title:`. Obsidian never reads that field, so
 * matching on it counts links Obsidian draws as broken — a page whose filename
 * was sanitised, or suffixed past a collision — and misses the live ones
 * written to an alias, which is exactly how `renamePlan` keeps a renamed page's
 * inbound links alive.
 *
 * Built once per query, never once per mention: `resolveWikilink` sorts the
 * whole vault on every call, and a backlink scan asks about every mention in it.
 */
function mentionResolver(v) {
  const entries = v.list();
  const byLink = linkResolver(entries);
  const byId = new Map(entries.map((e) => [String(e.id).toLowerCase(), e]));
  return (mention) => {
    const m = String(mention || "").trim();
    if (!m) return null;
    return byLink(m) || byId.get(m.toLowerCase()) || null;
  };
}

/** True when `e` links to the page with this id, in any of the forms above. */
function linksTo(e, id, resolve) {
  return (e.mentions || []).some((m) => {
    const hit = resolve(m);
    return !!hit && hit.id === id;
  });
}

function pageOut(entry, body) {
  return {
    id: entry.id,
    slug: entry.path.split("/").pop().replace(/\.md$/, ""),
    kind: entry.kind,
    title: entry.title,
    // noteChrome reads `page.url` when there is no frontmatter attached, so a
    // page object that drops it can never render as a bookmark — which is
    // exactly the bug that made bookmarks look unimplemented.
    url: entry.url ?? (entry.frontmatter && entry.frontmatter.url) ?? null,
    ...(entry.frontmatter && { frontmatter: entry.frontmatter }),
    created: entry.created || entry.updated || null,
    updated: entry.updated,
    tags: entry.tags || [],
    mentions: entry.mentions || [],
    aliases: entry.aliases || [],
    meta: entry.meta || {},
    path: entry.path,
    excerpt: entry.excerpt || "",
    // Surfaced so a search result can say WHY it matched. A drawing hit is
    // otherwise the one result with nothing to show: the words are in the
    // scene, not in the excerpt the row prints.
    ...(entry.sceneText ? { sceneText: entry.sceneText } : {}),
    // List endpoints return the excerpt here on purpose: SPEC §7 forbids holding
    // full bodies in the index. `page(id)` reads the real body from disk.
    body: body !== undefined ? body : (entry.excerpt || ""),
    // `body` above is the 300-char EXCERPT unless a real one was passed in.
    // Anything caching pages must not mistake one for the other: the excerpt is
    // also whitespace-collapsed, so a `## Thread` heading in it is no longer a
    // heading. Only `page(id)` sets this true.
    bodyIsFull: body !== undefined,
    stamped: entry.stamped !== false,
    unparseable: entry.unparseable || null,
  };
}

/* What a page patch may carry.

   Two lists, because "accepted" and "written" are not the same thing.
   `PATCH_WRITTEN` reaches disk. `PATCH_DERIVED` is what a caller may
   legitimately send and this layer deliberately ignores: `mentions` are
   recomputed from the body's wikilinks on every index build, `kind` belongs
   to the frontmatter and the path, and `slug` is display only. The page
   editor sends all three on every save.

   Everything else is REFUSED rather than dropped. A patch key that nothing
   writes is a feature that silently does nothing, and this app has shipped
   that twice: the project form sent `meta.status` and `start_date`, and the
   About Me screen sent eight structured keys, for as long as either existed.
   Both reported success on every save. A refusal is visible in the UI; a
   quiet drop is visible nowhere. */
const PATCH_WRITTEN = ["title", "tags", "aliases", "url", "status", "body", "meta", "force"];
const PATCH_DERIVED = ["mentions", "kind", "slug"];

export class Data {
  constructor(vault, opts = {}) {
    this.v = vault;
    this.renderMarkdown = opts.renderMarkdown || ((md) => md);
    this.now = opts.now || (() => new Date());
  }

  pages({ q = "", kind = "", tag = "", mention = "", limit = DEFAULT_LIMIT } = {}) {
    let items = this.v.list();
    // A kind list answers "show me my Xs" — system entries are nobody's Xs.
    if (kind) items = items.filter((e) => !isSystemEntry(e));
    // `bookmark` is a view, not a storage kind: a note with a url. The file
    // still says `kind: note`, so Obsidian and the convention see nothing new.
    if (kind === "bookmark") items = items.filter((e) => e.kind === "note" && e.url != null);
    /* Board and Canvas are one stored kind over two file formats with two
       different owners, and the nav lists them as two facets. Unlike the
       bookmark facet they are DISJOINT — the nav row says "Board", and a
       drawing counted under it is the label lying. */
    else if (kind === "drawing") items = items.filter((e) => e.kind === "canvas" && isExcalidrawPath(e.path));
    else if (kind === "canvas") items = items.filter((e) => e.kind === "canvas" && !isExcalidrawPath(e.path));
    else if (kind) items = items.filter((e) => e.kind === kind);
    if (tag) items = items.filter((e) => (e.tags || []).includes(tag));
    if (mention) {
      // Asked for by id (the project screen) or by name (a link target).
      const resolve = mentionResolver(this.v);
      const target = this.v.index.get(mention) || resolve(mention);
      if (target) {
        items = items.filter((e) => linksTo(e, target.id, resolve));
      } else {
        // Nothing in the vault answers to it — an asset, or a dead link. The
        // literal string is then the only honest thing to match on.
        const needle = String(mention).toLowerCase();
        items = items.filter((e) => (e.mentions || []).some((m) => m.toLowerCase() === needle));
      }
    }
    if (q) {
      const n = q.toLowerCase();
      items = items.filter((e) =>
        (e.title || "").toLowerCase().includes(n) ||
        (e.tags || []).some((t) => t.toLowerCase().includes(n)) ||
        (e.aliases || []).some((a) => a.toLowerCase().includes(n)) ||
        (e.excerpt || "").toLowerCase().includes(n) ||
        // The words inside a drawing. They live in the `.md` already — the
        // plugin writes them there for exactly this — but nothing read them,
        // so a drawing was findable by its title and by nothing it said.
        (e.sceneText || "").toLowerCase().includes(n));
    }
    const sorted = items.sort((a, b) =>
      String(b.updated || "").localeCompare(String(a.updated || "")));
    const sliced = sorted.slice(0, Math.max(0, limit));
    const rows = sliced.map((e) => pageOut(e));
    /* The tree-aware list indents a page under its parent, and read it from
       `meta.parent` — which nothing on a list row has ever carried, so every
       list has been flat whatever the files said. Only the rows that claim a
       parent pay for a resolve; `resolveWikilink` walks the vault, and doing
       that once per row would be a full scan per page listed. */
    sliced.forEach((e, i) => {
      if (!e.parent) return;
      const pid = refToId(this.v, e.parent);
      if (pid) rows[i].meta = { ...rows[i].meta, parent: pid };
    });
    return { items: rows, count: rows.length };
  }

  /** Task 6.5's second action: stream bodies from disk so memory stays flat. */
  async searchFullText(q, { limit = 50 } = {}) {
    const n = String(q).toLowerCase();
    if (!n) return { items: [], count: 0 };
    const hits = [];
    for (const e of this.v.list()) {
      if (hits.length >= limit) break;
      const p = await this.v.get(e.id);
      if (p && String(p.body || "").toLowerCase().includes(n)) hits.push(pageOut(e));
    }
    return { items: hits, count: hits.length };
  }

  async page(id) {
    const p = await this.v.get(id);
    if (!p) return null;
    const out = pageOut(p, p.body ?? "");
    // Nodes, but no edges: nothing draws a board any more. The flat item list
    // survives for one caller only — the "import the old board" button on an
    // inspo wall that still has a `.canvas` sidecar.
    if (p.canvas != null) out.meta = { ...out.meta, layout: layoutFromCanvas(p.canvas) };
    if (isExcalidrawPath(p.path)) {
      // Parse from `raw`, not `body`: the plugin block lives after the
      // frontmatter and the view needs both halves — the scene to draw, and the
      // user's prose to show underneath it.
      const ex = parseExcalidraw(p.raw ?? "");
      out.meta = { ...out.meta, excalidraw: ex };
      out.body = ex.backOfNote;
      out.bodyIsFull = true;
    }
    // Bookmark chrome reads meta.url / meta.links / meta.og; they live in the
    // frontmatter (the clipper writes og_* keys) and must be surfaced or the
    // editor opens empty however much the file carries.
    const fm = p.frontmatter || {};
    if (fm.url != null) {
      const og = fm.og_image ? {
        url: fm.url, image: fm.og_image,
        title: fm.og_title || null, description: fm.og_description || null,
        site_name: fm.og_site_name || null,
      } : null;
      const links = Array.isArray(fm.links) && fm.links.length
        ? fm.links.map((u, i) => ({ url: u, og: i === 0 ? og : null }))
        : [{ url: fm.url, og }];
      out.meta = { ...out.meta, url: fm.url, og, links };
    }
    /* The sub-page relation. The app reads `meta.parent` / `meta.children` as
       ids and the file holds wikilinks, so the translation happens here — the
       same shape the breadcrumb and the PARENT card have always asked for and
       never once been given: nothing wrote these keys and nothing read them
       back, so `page.meta.parent` was undefined on every page in the vault and
       both were dead markup. */
    const parentId = refToId(this.v, p.parent ?? fm.parent);
    const children = childIdsOf(this.v, p.id, p);
    if (parentId || children.length) {
      out.meta = { ...out.meta,
        ...(parentId ? { parent: parentId } : {}),
        ...(children.length ? { children } : {}) };
    }
    return out;
  }

  batch(ids) {
    const wanted = (Array.isArray(ids) ? ids : String(ids).split(","))
      .map((s) => s.trim()).filter(Boolean);
    const items = wanted.map((id) => this.v.index.get(id)).filter(Boolean).map((e) => pageOut(e));
    return { items, count: items.length };
  }

  counts() {
    const counts = {};
    for (const e of this.v.list()) {
      // The nav count must match the list it opens, so the same system-entry
      // exclusion applies here — a row saying "Note 94" over a list of 31 is
      // the sidebar lying.
      if (isSystemEntry(e)) continue;
      // Board / Canvas split disjointly (see the pages() filter above);
      // bookmark stays inclusive — on disk a bookmark IS a note.
      const k = e.kind === "canvas" && isExcalidrawPath(e.path) ? "drawing" : e.kind;
      counts[k] = (counts[k] || 0) + 1;
      if (e.kind === "note" && e.url != null) counts.bookmark = (counts.bookmark || 0) + 1;
    }
    return { counts };
  }

  tags() {
    const n = new Map();
    for (const e of this.v.list()) for (const t of e.tags || []) n.set(t, (n.get(t) || 0) + 1);
    // CONVENTION: a subject lives as a page in `tags/`. It is a tag before
    // anything carries it, so it shows at zero rather than nowhere — without
    // this, a tag made on the Tags screen would vanish from the one screen
    // that made it.
    const have = new Set([...n.keys()].map((t) => t.toLowerCase()));
    for (const e of this.v.list()) {
      const p = String(e.path || "");
      if (!p.startsWith("tags/") || p.slice(5).includes("/")) continue;
      const name = pageStem(p).toLowerCase();
      if (name && !have.has(name)) { n.set(name, 0); have.add(name); }
    }
    return {
      tags: [...n.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count })),
    };
  }

  /**
   * A tag created before anything carries it. CONVENTION's shape for that is
   * the subject page — `tags/<name>.md`, lowercase basename, standard
   * frontmatter, empty body; emptiness is the design. A taken name is refused
   * rather than suffixed: a filename is addressing, and "economy 2" is not a
   * tag anyone meant.
   */
  async createTag(name) {
    const tag = tagSlug(name);
    if (!tag) return { ok: false, reason: "empty", message: "a tag needs a name" };
    if (this.tags().tags.some((t) => t.tag.toLowerCase() === tag)) {
      return { ok: false, reason: "exists", message: `#${tag} already exists` };
    }
    if (takenStems(this.v).has(tag)) {
      return { ok: false, reason: "name-taken",
               message: `a page named "${tag}" already exists — tags share the vault's one namespace` };
    }
    const r = await this.v.put({
      path: `tags/${tag}.md`, kind: "note", title: tag,
      frontmatter: { kind: "note", title: tag },
      body: "",
    });
    if (!r.ok) return r;
    await this.v.buildIndex();
    return { ok: true, tag };
  }

  suggestMentions(q = "", limit = 8) {
    const needle = String(q).toLowerCase();
    const scored = [];
    for (const e of this.v.list()) {
      for (const h of [e.title, ...(e.aliases || [])].filter(Boolean)) {
        const hl = h.toLowerCase();
        if (!needle || hl.includes(needle)) {
          scored.push({ e, label: h, rank: !needle ? 2 : hl.startsWith(needle) ? 0 : 1 });
          break;
        }
      }
    }
    scored.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
    return {
      items: scored.slice(0, limit).map((s) => ({
        id: s.e.id, title: s.label, kind: s.e.kind, path: s.e.path,
      })),
    };
  }

  /** Task 9.2: every image in the vault, resolved to its containing page. */
  async images(filter = {}) {
    const files = await this.v.be.listAll();
    const all = listImages(files, this.v.list());
    return { items: filterImages(all, filter), count: all.length };
  }

  dashboard() {
    return computeDashboard(this.v.list(), this.now());
  }

  /* `context/about-me.md` — the file every agent reads before it writes in
     your voice. Its content is its BODY. Prose is the only shape the
     convention leaves for it: the frontmatter key list is closed, YAML there
     cannot hold a nested object or a list of dicts, and the five structural
     body headings are spoken for.

     `path: null` is the answer for a vault adopted without the file, and it
     is load-bearing rather than cosmetic — the screen reads it to decide
     whether to offer an editor at all, because a surface that cannot write
     must not accept the gesture. */
  async aboutMe() {
    const e = [...this.v.index.values()].find((x) => x.path === "context/about-me.md");
    if (!e) return { body: "", updated: null, path: null };
    const p = await this.v.get(e.id);
    return { body: p.body, updated: p.updated, path: e.path };
  }

  /** Task 6.11: an upload becomes a file in attachments/, not a POST.
   *  Returns the shape the old /assets endpoint did, so call sites are unchanged. */
  async writeAsset(file) {
    const raw = file.name || "asset";
    const dot = raw.lastIndexOf(".");
    const stem = (dot > 0 ? raw.slice(0, dot) : raw).replace(/[/\\:*?"<>|]/g, "-");
    const ext = dot > 0 ? raw.slice(dot) : "";
    let name = `${stem}${ext}`;
    let n = 2;
    while (await this.v.be.exists(`attachments/${name}`)) name = `${stem}-${n++}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await this.v.writeBlob(`attachments/${name}`, bytes);
    if (!r.ok) return r;
    return { path: `attachments/${name}`, name, url: `attachments/${name}`, bytes: bytes.length };
  }

  /**
   * Inline drawing images → real files in `attachments/`.
   *
   * An image dropped into the editor lands in `scene.files` as a `dataURL`: a
   * megabyte of base64 sealed inside the compressed blob, with no name, no
   * path, and no way for Obsidian or an agent to know it is there. Written out
   * as an ordinary attachment it becomes a file like any other — openable,
   * linkable, greppable — and `serializeExcalidraw` can name it in the
   * plugin's own `## Embedded Files` index.
   *
   * Takes the mapping already known from the file (so an image is written once,
   * not once per save) and returns it extended. The dataURL is deliberately
   * LEFT in the scene: the editor renders from it, and dropping it would mean
   * a drawing that cannot paint its own images until something reloads them
   * from the vault. That copy is the price of the file being readable, and it
   * is a follow-up to load from the attachment instead.
   */
  async adoptDrawingImages(scene, stem, known) {
    const paths = known instanceof Map ? new Map(known) : new Map(
      (Array.isArray(known) ? known : []).map((e) => [e.key, e.value]));
    const files = (scene && scene.files) || {};
    for (const [id, f] of Object.entries(files)) {
      if (!id || paths.has(id)) continue;
      const bytes = bytesFromDataURL(f && f.dataURL);
      if (!bytes) continue;
      const ext = EXT_FOR_MIME[String((f && f.mimeType) || "").toLowerCase()] || ".png";
      // The drawing's own name, so an attachment folder stays readable: the
      // fileId is a 40-character hash and says nothing to anyone.
      const base = `${String(stem || "drawing").replace(/[/\\:*?"<>|]/g, " ").trim() || "drawing"}${ext}`;
      const r = await this.writeAsset({
        name: base,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
      if (r && r.path) paths.set(id, r.path);
    }
    return paths;
  }

  /**
   * Paste → bookmarks. The whole point is that one gesture is the whole
   * gesture: no picker, no blank page, no title to invent.
   *
   * Takes arbitrary text — a bare link, a column of them, a markdown list, a
   * paragraph with links in it — and saves every link it finds that is not
   * already saved.
   *
   * Dedupe is by CANONICAL url (tracking params stripped), because the same
   * article arrives with a different `?utm_source=` every time and two cards
   * for one page is exactly the duplication the vault is meant to prevent.
   * A duplicate is REPORTED, not silently dropped: the caller shows what
   * already existed so the paste does not look like it failed.
   *
   * Titles come from the URL alone. Nothing here fetches the page — the app
   * makes no network requests at all, by contract; the clipper is what gets
   * a real title and an `og_image`, because it runs inside the page.
   */
  async addBookmarks(text, { tags = [], project = null } = {}) {
    const urls = urlsFromText(text);
    const added = [];
    const duplicates = [];
    for (const url of urls) {
      const existing = findByUrl(this.v, url);
      if (existing) { duplicates.push(pageOut(existing)); continue; }
      const p = await this.createPage({
        kind: "bookmark", url, title: titleFromUrl(url),
        tags, ...(project && { project }),
      });
      // A refusal (a name collision the freeStem walk could not resolve, a
      // read-only folder) must not abort the rest of the paste — twelve links
      // where one fails should still save eleven.
      if (p && p.id) added.push(p);
    }
    return { added, duplicates, found: urls.length };
  }

  /** Pages that link to this one. Computed from the index, not stored. */
  backlinks(id) {
    if (!this.v.index.has(id)) return { items: [], count: 0 };
    const resolve = mentionResolver(this.v);
    const items = this.v.list()
      .filter((e) => e.id !== id && linksTo(e, id, resolve))
      .map((e) => pageOut(e));
    return { items, count: items.length };
  }

  /**
   * A topic's orbit: everything that says its name.
   *
   * A project OWNS its pages — they are files in its folder. A topic ATTRACTS
   * them, and owns nothing. That is the whole difference between the two, and
   * it is why "put these notes in a topic" never moves a file: a page lives in
   * one project and can orbit any number of topics.
   *
   * Two ways a page says the name, and both count because both are how the
   * vault already works: a `[[wikilink]]` (a mention) and the matching tag.
   * Deliberately NOT "every tag this topic carries" — a topic tagged #current
   * would then swallow everything else tagged #current, and the orbit would
   * stop meaning anything.
   *
   * Derived live from the index on every call. Nothing is stored, so the file
   * on disk stays a plain topic page and Obsidian sees no new syntax.
   */
  orbit(id) {
    const target = this.v.index.get(id);
    if (!target) return { items: [], count: 0, tag: null };
    // The link half resolves; the tag half is the topic's own name, slugged.
    const resolve = mentionResolver(this.v);
    const tag = tagSlug(target.title || "");
    const seen = new Map();
    for (const e of this.v.list()) {
      // isPlumbing, not isSystemEntry: a PROJECT that cites this topic is the
      // most interesting thing in the orbit — it is the difference between
      // owning and attracting, made visible. Only true plumbing is dropped…
      if (e.id === id || isPlumbing(e)) continue;
      // …plus the catalog and the log. `index` links to every page in the
      // vault by definition, so its presence proves nothing about this idea,
      // and an orbit is only worth reading if every row is evidence.
      if (ROOT_STRUCTURAL.has(e.path)) continue;
      const mentioned = linksTo(e, id, resolve);
      const tagged = tag && (e.tags || []).some((t) => tagSlug(t) === tag);
      if (!mentioned && !tagged) continue;
      // `via` is what lets the UI say WHY a page is in the orbit — a link you
      // wrote reads differently from a tag you sprinkled.
      seen.set(e.id, { ...pageOut(e), via: mentioned && tagged ? "both" : (mentioned ? "link" : "tag") });
    }
    const items = [...seen.values()].sort((a, b) =>
      String(b.updated || "").localeCompare(String(a.updated || "")));
    return { items, count: items.length, tag };
  }

  /** Markdown → HTML, locally (S9). */
  renderHtml(md) {
    return { html: this.renderMarkdown(md || "") };
  }

  /* About me is prose, so a patch here carries a body.

     It used to carry `identity`, `taste`, `communication`, `state`,
     `experience`, `skills`, `education` and `highlights` as well.
     `updatePage` had nowhere to put any of them and dropped all eight, and
     the screen reported a successful save every time. It now refuses what it
     cannot write, so a patch like that fails loudly instead. */
  async updateAboutMe(patch = {}) {
    const e = [...this.v.index.values()].find((x) => x.path === "context/about-me.md");
    if (!e) return { ok: false, reason: "no-about-me" };
    return this.updatePage(e.id, patch);
  }

  async exportPage(id) {
    const p = await this.v.get(id);
    return p ? { markdown: p.raw ?? "", filename: p.path.split("/").pop() } : null;
  }

  async createPage(body = {}) {
    let kind = body.kind || "note";
    // Held before the remapping below, because the *asked-for* kind is what
    // names a blank page — a bookmark stored as a note is still "Bookmark".
    const requested = kind;
    let extraFm = {};
    if (kind === "bookmark") {
      // Stored as the convention says: a note whose frontmatter carries `url`.
      // The key is written even when empty so the page opens with bookmark
      // chrome (a url field to fill in) instead of an article editor.
      kind = "note";
      extraFm = { url: body.url || "" };
    }
    const isDrawing = kind === "drawing";
    if (isDrawing) {
      // A drawing is a canvas in the plugin's own file format. The marker key
      // is what makes Obsidian's Excalidraw plugin open it as a drawing.
      kind = "canvas";
      extraFm = { "excalidraw-plugin": "parsed" };
    }
    // A project is a folder: pass `project` and the page files into it instead
    // of the kind's home folder — this is what lets one project hold notes,
    // bookmarks, boards, drawings and walls together.
    const projectStem = body.project
      ? String(body.project).replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()
      : null;
    // An unknown kind used to fall through to `notes/` while still writing the
    // bogus `kind:` into the file — the Projects screen did exactly that and
    // produced `notes/Test Project.md` with `kind: project`, which CONVENTION's
    // four-kind vocabulary does not admit. Refuse instead of mis-filing.
    const folder = projectStem ? `projects/${projectStem}` : FOLDER_FOR[kind];
    if (!folder) {
      return { ok: false, reason: "unknown-kind",
               message: `no such kind: ${kind} (expected ${Object.keys(FOLDER_FOR).join(", ")})` };
    }
    const fallback = `${DEFAULT_LABEL[requested] || "Note"} ${this.v.now().slice(0, 10)}`;
    const title = String(body.title || "").trim() || fallback;
    const stem = stemFor(title) || fallback;
    // CONVENTION rule 3: when the filename cannot equal the title, the true
    // title must go in `aliases` or inbound links stop resolving. Obsidian
    // matches basename then aliases and never reads `title:`, so without this
    // `[[Slash/Colon: "Quote"]]` — the obvious way to link the page — is dead.
    const aliases = [...new Set([...(body.aliases || []), ...(stem === title ? [] : [title])])];
    const ext = isDrawing ? ".excalidraw.md" : ".md";
    // Two quick blank creates must not share a name — put() would treat the
    // second as an edit of the first and overwrite it — and a name taken in
    // *another* folder is taken all the same, because that is how `[[Link]]`
    // resolves.
    const finalStem = freeStem(this.v, stem);
    // What the clipper knows and the app does not: `og_*`, `source`, `captured`,
    // `author`. Filtered to the convention's own optional keys — serialize()
    // throws on anything else, so an unfiltered passthrough would turn a stray
    // field from a web page into a refused write.
    const clipFm = clipFrontmatter(body.frontmatter || {});
    /* A sub-page is born knowing its parent, or it is not a sub-page. This
       used to arrive as `body.meta.parent` and go nowhere at all — createPage
       builds its frontmatter from a fixed list and never read `meta` — so
       every "Add sub-page" wrote an ordinary unattached page. */
    const parentRef = idToRef(this.v, body.parent
      ?? (body.meta && body.meta.parent) ?? null);
    // A new drawing's body is the plugin block with a blank scene — the
    // frontmatter half is the vault's to write, so it is stripped off here.
    const pageBody = isDrawing
      ? serializeExcalidraw(null).replace(/^---\n[\s\S]*?\n---\n/, "")
      : (body.body || "");
    const r = await this.v.put({
      path: `${folder}/${finalStem}${ext}`,
      kind, title,
      frontmatter: { kind, title, tags: body.tags || [],
                     ...(aliases.length && { aliases }), ...extraFm, ...clipFm,
                     ...(parentRef ? { parent: parentRef } : {}) },
      body: pageBody,
    });
    if (!r.ok) return r;
    await this.v.buildIndex();
    return this.page(r.id);
  }

  /**
   * The pages inside `projects/<name>/`, minus the folder note itself.
   * Folder membership IS project membership — that is what a project is.
   */
  projectMembers(name) {
    const prefix = `projects/${name}/`;
    const notePath = `${prefix}${name}.md`;
    const items = this.v.list()
      .filter((e) => e.path.startsWith(prefix) && e.path !== notePath)
      .map((e) => pageOut(e))
      .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
    return { items, count: items.length };
  }

  async updatePage(id, patch = {}) {
    // Checked before anything is read: a key with no home on disk is a bug in
    // the caller, not a fact about this page. Reported the way every other
    // refusal is, so the editor's "Not saved" strip can name it.
    const unwritable = Object.keys(patch).filter(
      (k) => !PATCH_WRITTEN.includes(k) && !PATCH_DERIVED.includes(k));
    if (unwritable.length) {
      return {
        ok: false, reason: "unwritable-fields", fields: unwritable,
        message: `nothing in the vault format holds: ${unwritable.join(", ")}`,
      };
    }
    const cur = await this.v.get(id);
    if (!cur) return { ok: false, reason: "unknown-id" };
    const fm = { ...(cur.frontmatter || {}) };
    for (const k of ["title", "tags", "aliases", "url", "status"]) {
      if (k in patch) fm[k] = patch[k];
    }
    // The editor sends the whole page.meta on every save; the url and the link
    // list are the parts that persist, into frontmatter Obsidian can read.
    // (og_* keys are the clipper's — the app surfaces them but never writes
    // them.) Dropping patch.meta silently was why a bookmark edited in the app
    // reverted on reload.
    if (patch.meta && typeof patch.meta === "object") {
      if ("url" in patch.meta && !("url" in patch)) fm.url = patch.meta.url ?? "";
      if (Array.isArray(patch.meta.links)) {
        const urls = patch.meta.links.map((l) => l && l.url).filter(Boolean);
        if (urls.length > 1) fm.links = urls;
        else delete fm.links;
        if (!("url" in patch)) fm.url = urls[0] ?? fm.url ?? "";
      }
      /* The sub-page relation, written as the wikilink CONVENTION asks for.
         `children` is deliberately NOT written: the child names its parent and
         the parent's list is derived from that one fact, so there is no second
         copy to fall out of step with the first. */
      if ("parent" in patch.meta) {
        const ref = idToRef(this.v, patch.meta.parent);
        if (ref) fm.parent = ref; else delete fm.parent;
      }
    }
    // Decided before the write, so the alias that keeps inbound links alive
    // goes to disk in the same save as the new title.
    const plan = "title" in patch ? renamePlan(this.v, cur, fm.title) : null;
    if (plan?.alias) {
      const had = Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : [];
      fm.aliases = [...new Set([...had, plan.alias])];
    }
    /* A board's body, as `page(id)` reports it, is the BACK OF THE NOTE — the
       prose above the drawing, not the file. So every editor on that screen
       except the board itself is holding half a file and does not know it, and
       the ordinary save path wrote that half over the whole: touch a tag or a
       link chip on a board and the `## Drawing` block went with it. The scene
       is spliced back rather than re-serialized, so a save that never touched
       an element does not rewrite the compressed payload either. */
    let nextBody = "body" in patch ? patch.body : cur.body;
    if ("body" in patch && isExcalidrawPath(cur.path)
        && !hasExcalidrawData(patch.body) && hasExcalidrawData(cur.body)) {
      nextBody = withBackOfNote(cur.body, patch.body);
    }
    const r = await this.v.put({
      id, path: cur.path, frontmatter: fm,
      body: nextBody,
      force: patch.force,
    });
    if (!r.ok) return r;
    // Move only after the write is safely on disk — the conflict gate has to
    // judge the file where it found it. Keyed by the id the index holds now,
    // not `r.id`: put() stamps a fresh one onto a file adopted without it, and
    // the index does not learn it until the rebuild below.
    if (plan) await this.v.rename(id, plan.to);
    await this.v.buildIndex();
    return this.page(r.id ?? id);
  }

  /**
   * SPEC: **`project` is not a kind.** A project is a folder under `projects/`
   * holding a folder note `<name>/<name>.md` plus its member pages. The screen
   * used to ask for `kind: "project"`, which nothing can ever be, so it always
   * reported an empty vault however many projects were on disk.
   */
  async projects() {
    const all = this.v.list();
    // One lookup for the whole sweep — a resolver per project would sort the
    // vault once per folder.
    const resolve = mentionResolver(this.v);
    const byFolder = new Map();
    for (const e of all) {
      const m = /^projects\/([^/]+)\//.exec(e.path);
      if (!m) continue;
      if (!byFolder.has(m[1])) byFolder.set(m[1], []);
      byFolder.get(m[1]).push(e);
    }
    const items = [];
    for (const [name, members] of byFolder) {
      const note = members.find((e) => e.path === `projects/${name}/${name}.md`);
      const rest = members.filter((e) => e !== note);
      /* What is "inside" a project is folder membership PLUS the pages that
         mention it — that is the rule the project page renders, and a card
         that counts only the folder said "0 pages inside" above a page
         showing two of them. Both were true; only one of them was the answer
         to the question the label asks. */
      const seen = new Set(rest.map((e) => e.id));
      /* …but a mention is membership only when it is EVIDENCE. `index` links to
         every page in the vault by definition, so it mentions every project and
         was listed inside all of them — a row equally true of every project,
         and therefore saying nothing about this one. Same for the log, and for
         plumbing.

         This is isPlumbing + ROOT_STRUCTURAL, the pair `orbit` uses, and NOT
         isSystemEntry, which looks like the obvious call and is the wrong one
         twice over: it does not cover index.md at all (it is isPlumbing plus
         isProjectNote, and the catalog is neither), so it would leave this bug
         exactly where it was — and it drops project notes, when one project
         citing another is the most interesting row here, for the same reason
         it is in an orbit. */
      const mentioners = note
        ? all.filter((e) => e.id !== note.id && !seen.has(e.id)
            && !isPlumbing(e) && !ROOT_STRUCTURAL.has(e.path)
            && linksTo(e, note.id, resolve))
        : [];
      // One definition of "inside", used by the count, the card's preview and
      // its composition alike: folder members plus the pages that mention the
      // project. `members` alone was folder-only, so a card could say "Empty"
      // one line above "2 pages inside".
      const inside = [...rest, ...mentioners];
      items.push({
        id: note ? note.id : `project:${name}`,
        name,
        title: note ? note.title : name,
        path: `projects/${name}`,
        notePath: note ? note.path : null,
        excerpt: note ? note.excerpt || "" : "",
        updated: members.map((e) => e.updated).filter(Boolean).sort().pop() || null,
        memberCount: inside.length,
        members: rest.map((e) => pageOut(e)),
        inside: inside.map((e) => pageOut(e)),
      });
    }
    items.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return { items, count: items.length };
  }

  /** Create `projects/<Title>/<Title>.md` — the folder note that makes it a project. */
  async createProject(title) {
    const fallback = `Project ${this.v.now().slice(0, 10)}`;
    const t = String(title || "").trim() || fallback;
    /* `freeStem`, like every other create. Without it this was the one path in
       the app that could still mint a duplicate name: a project called
       Research beside an existing `notes/Research.md` wrote
       `projects/Research/Research.md` and made `[[Research]]` ambiguous — the
       exact warning the resolve dialog now has to clean up after. */
    const stem = freeStem(this.v, stemFor(t) || fallback);
    const aliases = stem === t ? [] : [t];
    const r = await this.v.put({
      path: `projects/${stem}/${stem}.md`,
      kind: "note", title: t,
      frontmatter: { kind: "note", title: t, ...(aliases.length && { aliases }) },
      body: "",
    });
    if (!r.ok) return r;
    await this.v.buildIndex();
    return this.page(r.id);
  }

  /* ── the vault's own problems, and how to fix each one ──────────────────
     `vault.warnings` has always been able to say a thing is wrong. Nothing
     could act on it: "duplicate filename Untitled" named two files and left
     the user to go and rename one in Finder, in an app whose whole promise is
     that it is the thing that reads and writes these files. So the strings got
     a structured twin (`vault.problems`), and everything below turns one into
     a fix that runs here. */

  /** Every problem, each file annotated with what a fix would need. */
  vaultProblems() {
    const v = this.v;
    const describe = (path) => {
      const e = v.byPath.get(path);
      return {
        path,
        id: e ? e.id : null,
        title: e ? e.title : pageStem(path),
        kind: e ? e.kind : null,
        stem: pageStem(path),
        suggest: suggestStem(v, path, e),
        /* A `.canvas` is Obsidian's file and this app neither opens nor writes
           it, so it is named as the other half of the collision and never
           offered as the one to rename. Renaming it here would also strand the
           board in whatever Obsidian canvas links to it. */
        fixable: !!e && !path.endsWith(".canvas"),
      };
    };
    return v.problems.map((p) => ({ ...p, files: (p.paths || []).map(describe) }));
  }

  /**
   * Rename one file to settle a name collision.
   *
   * Deliberately WITHOUT the alias that `renamePlan` would add. That alias
   * keeps inbound `[[Old Name]]` alive, which is right when a page moves and
   * exactly wrong here: the old name is contested, and an alias claiming it
   * would rebuild the ambiguity this rename exists to remove.
   */
  async renameFile(path, stem) {
    const e = this.v.byPath.get(path);
    if (!e) return { ok: false, reason: "unknown-path", message: `no such file: ${path}` };
    const clean = stemFor(stem);
    if (!clean) {
      return { ok: false, reason: "bad-name",
               message: "That cannot be a filename — try it without / \\ : * ? \" < > |" };
    }
    if (clean.toLowerCase() !== pageStem(path).toLowerCase()
        && takenStems(this.v, path).has(clean.toLowerCase())) {
      return { ok: false, reason: "name-taken", message: `[[${clean}]] is taken too.` };
    }
    const name = String(path).split("/").pop();
    const oldStem = pageStem(path);
    const dir = path.slice(0, path.length - name.length);
    const r = await this.v.rename(e.id, `${dir}${clean}${name.slice(oldStem.length)}`);
    if (r.ok) await this.v.buildIndex();
    return r;
  }

  /**
   * Give a file a new id, to settle two files claiming one.
   *
   * Read straight off disk rather than through `get()`: the *losing* half of a
   * duplicate id is not in the index under that id — `index.get(id)` hands back
   * the other file — so reading by id would rewrite the wrong one.
   */
  async newIdFor(path) {
    const e = this.v.byPath.get(path);
    if (!e) return { ok: false, reason: "unknown-path", message: `no such file: ${path}` };
    let fm, body;
    try {
      const [f, b] = parse(await this.v.be.readText(path));
      fm = f; body = unescapeUser(b);
    } catch (err) {
      return { ok: false, reason: "unreadable", message: String((err && err.message) || err) };
    }
    const r = await this.v.put({ path, frontmatter: { ...fm, id: this.v.newId() }, body });
    if (r.ok) await this.v.buildIndex();
    return r;
  }

  /** Retitle a page — the fix for two pages sharing one title. */
  async retitle(path, title) {
    const e = this.v.byPath.get(path);
    if (!e) return { ok: false, reason: "unknown-path", message: `no such file: ${path}` };
    const next = String(title || "").trim();
    if (!next) return { ok: false, reason: "bad-title", message: "A title cannot be blank." };
    const page = await this.v.get(e.id);
    if (!page) return { ok: false, reason: "unknown-path" };
    const r = await this.v.put({
      path, id: page.id, kind: page.kind,
      frontmatter: { ...(page.frontmatter || {}), title: next },
      body: page.body || "",
    });
    if (r.ok) await this.v.buildIndex();
    return r;
  }

  async deletePage(id) {
    // Capture where the file lived BEFORE the move — del() reports where it
    // went, but a restore also needs to know where to put it back.
    const e = this.v.index.get(id);
    const path = e ? e.path : null;
    /* Only a board has a `.canvas` sidecar. This used to derive one for every
       page, so the receipt for a plain note claimed a companion file that
       cannot exist. untrash() guards on `trashedCanvas` — which del() sets
       only when it really moved one — so nothing acted on it; a receipt that
       describes files that were never there is still the wrong receipt. */
    const canvasPath = (e && e.kind === "canvas" && path && path.endsWith(".md"))
      ? path.replace(/\.md$/, ".canvas")
      : null;
    const r = await this.v.del(id);
    await this.v.buildIndex();
    return (r && r.ok) ? { ...r, path, canvasPath } : r;
  }

  /* Snapshots of a page, newest first, from `.history/`. */
  async pageHistory(id) { return this.v.history(id); }
  async readSnapshot(path) { return this.v.readHistory(path); }

  /* Put back what deletePage() just trashed. Takes its return value. */
  async restorePage(receipt) {
    const r = await this.v.untrash(receipt || {});
    await this.v.buildIndex();
    return r;
  }

  // ── path routers (transitional; see the header) ───────────────────────
  async get(path) {
    const [base, qs = ""] = String(path).replace(/^\/+/, "").split("?");
    const q = new URLSearchParams(qs);
    const num = (k, d) => (q.get(k) ? parseInt(q.get(k), 10) : d);
    if (base === "counts") return this.counts();
    if (base === "tags") return this.tags();
    if (base === "dashboard") return this.dashboard();
    if (base === "about-me") return this.aboutMe();
    if (base === "mentions/suggest") return this.suggestMentions(q.get("q") || "", num("limit", 8));
    if (base === "pages/batch") return this.batch(q.get("ids") || "");
    if (base === "pages") {
      return this.pages({
        q: q.get("q") || "", kind: q.get("kind") || "", tag: q.get("tag") || "",
        mention: q.get("mention") || "", limit: num("limit", DEFAULT_LIMIT),
      });
    }
    if (base.startsWith("pages/")) return this.page(base.slice(6));
    // These two look like /export/<id> but are not. Matching them as an id
    // would return null and read as "no such page" instead of "feature gone".
    if (base === "export/resume") {
      throw new Error("no local implementation for GET /export/resume — resume "
        + "export was an LLM feature, deleted per SPEC §16");
    }
    if (base === "export/all") {
      throw new Error("no local implementation for GET /export/all — the vault "
        + "is already a folder of markdown; copy it");
    }
    if (base.startsWith("export/")) return this.exportPage(base.slice(7));
    throw new Error(`no local implementation for GET /${base} — see data.js header`);
  }

  async post(path, body) {
    const base = String(path).replace(/^\/+/, "").split("?")[0];
    if (base === "pages") return this.createPage(body);
    if (base === "render/markdown") return { html: this.renderMarkdown((body && body.md) || "") };
    throw new Error(`no local implementation for POST /${base} — see data.js header`);
  }

  async patch(path, body) {
    const base = String(path).replace(/^\/+/, "").split("?")[0];
    if (base.startsWith("pages/")) return this.updatePage(base.slice(6), body);
    throw new Error(`no local implementation for PATCH /${base} — see data.js header`);
  }

  async del(path) {
    const base = String(path).replace(/^\/+/, "").split("?")[0];
    if (base.startsWith("pages/")) return this.deletePage(base.slice(6));
    throw new Error(`no local implementation for DELETE /${base} — see data.js header`);
  }
}
