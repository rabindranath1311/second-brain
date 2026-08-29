// Task 6.8: the endpoints that survive, computed from the vault with no server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, MemoryBackend } from "../vault/vault.js";
import {
  Data, layoutFromCanvas,
} from "../vault/data.js";
import { serialize } from "../vault/mdfile.js";

const TS = (d) => `2026-07-${String(d).padStart(2, "0")}T12:00:00+00:00`;
const md = (fm, body = "") => serialize(fm, body);
const P = (id, over = {}) => ({
  id, kind: "note", title: `Page ${id.slice(-2)}`,
  created: TS(1), updated: TS(20), ...over,
});

async function fixture() {
  const files = {
    "notes/Alpha.md": md(P("01AAAAAAAAAAAAAAAAAAAAAAAA", { title: "Alpha", tags: ["cartography", "lanterns"], updated: TS(28) }), "Alpha body mentions [[Beta]] and #inline"),
    "notes/Beta.md": md(P("01BBBBBBBBBBBBBBBBBBBBBBBB", { title: "Beta", tags: ["cartography"], updated: TS(27) }), "Beta body. " + "filler ".repeat(80) + " needle_xyz sits well past the excerpt."),
    "topics/Gamma.md": md(P("01CCCCCCCCCCCCCCCCCCCCCCCC", { title: "Gamma", kind: "topic", tags: ["bookbinding"], aliases: ["Gee"], updated: TS(26) }), "Gamma body"),
    "canvas/Delta.md": md(P("01DDDDDDDDDDDDDDDDDDDDDDDD", { title: "Delta", kind: "canvas", updated: TS(25) }), "![[Delta.canvas]]"),
    "canvas/Delta.canvas": '{"nodes":[],"edges":[]}',
    "inspo/Epsilon.md": md(P("01EEEEEEEEEEEEEEEEEEEEEEEE", { title: "Epsilon", kind: "inspo", updated: TS(24) }), "Epsilon"),
    "context/about-me.md": md(P("context-about-me", { title: "About me", updated: TS(23) }), "## Taste\n\nrestrained"),
  };
  const v = new Vault(new MemoryBackend(files), { now: () => TS(30) });
  await v.buildIndex();
  return new Data(v, { now: () => new Date(TS(30)), renderMarkdown: (m) => `<p>${m}</p>` });
}

test("6.18 counts match list() per kind", async () => {
  const d = await fixture();
  assert.deepEqual((await d.counts()).counts, { note: 3, topic: 1, canvas: 1, inspo: 1 });
});

test("kind lists and counts exclude system entries; All pages keeps them", async () => {
  const files = {
    "notes/Alpha.md": md(P("01AAAAAAAAAAAAAAAAAAAAAAAA", { title: "Alpha" }), "a real note"),
    // The fallback bucket's usual suspects: a raw source (no frontmatter, per
    // CONVENTION), a tag stub, the scaffolded contract docs, and a project's
    // folder note. All of them index as `note`.
    "raw/clipped-article.md": "# Clipped\n\nno frontmatter at all",
    "tags/bookbinding.md": md(P("tag-bookbinding", { title: "bookbinding" }), ""),
    "CONVENTION.md": md(P("convention", { title: "CONVENTION" }), "the format"),
    "AGENTS.md": md(P("agents", { title: "AGENTS" }), "the contract"),
    "CLAUDE.md": md(P("claude-pointer", { title: "CLAUDE" }), "see AGENTS"),
    "projects/Kiln/Kiln.md": md(P("project-kiln", { title: "Kiln" }), "the folder note"),
    // …but a page merely INSIDE a project is the user's, and stays listed.
    "projects/Kiln/Firing Log.md": md(P("01FFFFFFFFFFFFFFFFFFFFFFFF", { title: "Firing Log" }), "cone 6"),
  };
  const v = new Vault(new MemoryBackend(files), { now: () => TS(30) });
  await v.buildIndex();
  const d = new Data(v, { now: () => new Date(TS(30)) });
  const noteTitles = (await d.pages({ kind: "note" })).items.map((p) => p.title).sort();
  assert.deepEqual(noteTitles, ["Alpha", "Firing Log"],
    "the Note list is the user's notes, not the vault's plumbing");
  assert.equal((await d.counts()).counts.note, 2,
    "the nav count matches the list it opens");
  const all = (await d.pages({})).items;
  assert.ok(all.some((p) => p.path === "raw/clipped-article.md"),
    "excluded from the kind list is not the same as gone — All pages keeps it");
  assert.ok(all.some((p) => p.path === "CONVENTION.md"));
});

test("orbit() gathers what says a topic's name, by link and by tag", async () => {
  const files = {
    "topics/Quire Structures.md": md(P("01QQQQQQQQQQQQQQQQQQQQQQQQ", { title: "Quire Structures", kind: "topic" }), "the fold is the unit"),
    "notes/Linked.md": md(P("01LLLLLLLLLLLLLLLLLLLLLLLL", { title: "Linked", updated: TS(28) }), "see [[Quire Structures]]"),
    "notes/Tagged.md": md(P("01TTTTTTTTTTTTTTTTTTTTTTTT", { title: "Tagged", tags: ["quire-structures"], updated: TS(27) }), "no link, just the tag"),
    "notes/Both.md": md(P("01OOOOOOOOOOOOOOOOOOOOOOOO", { title: "Both", tags: ["quire-structures"], updated: TS(26) }), "[[Quire Structures]] and tagged"),
    "notes/Unrelated.md": md(P("01UUUUUUUUUUUUUUUUUUUUUUUU", { title: "Unrelated", tags: ["bookbinding"] }), "about something else"),
    // A topic tagged #current must not swallow everything else tagged
    // #current — the orbit is the topic's OWN name, not every tag it carries.
    "notes/AlsoCurrent.md": md(P("01CCCCCCCCCCCCCCCCCCCCCCCC", { title: "Also Current", tags: ["current"] }), "unrelated but shares a tag"),
  };
  const v = new Vault(new MemoryBackend(files), { now: () => TS(30) });
  await v.buildIndex();
  const d = new Data(v, { now: () => new Date(TS(30)) });
  const { items, tag } = d.orbit("01QQQQQQQQQQQQQQQQQQQQQQQQ");
  assert.equal(tag, "quire-structures");
  assert.deepEqual(items.map((p) => [p.title, p.via]), [
    ["Linked", "link"], ["Tagged", "tag"], ["Both", "both"],
  ], "newest first, and each says why it is here");
  // The topic itself is never in its own orbit.
  assert.ok(!items.some((p) => p.id === "01QQQQQQQQQQQQQQQQQQQQQQQQ"));
});

/* ── what links here ───────────────────────────────────────────────────────
   backlinks(), orbit() and a project's mentioners all ask one question, and
   it is answered the way Obsidian answers it: basename → aliases → path,
   case-insensitive. A `title:` field is not a link target — Obsidian never
   reads one — so matching on it invents backlinks the vault draws as broken
   and misses every link written to an alias, which is how a renamed page
   keeps its inbound links (see renamePlan). */

// A page whose filename is NOT its title: rule 3's collision suffix. The live
// targets are `Quire Structures 2` (the filename) and `Quires` (the alias).
// `Quire Structures` — the title — is a target nothing in the vault answers to.
const QS = "01QQQQQQQQQQQQQQQQQQQQQQQQ";
const LINK_FILES = {
  "notes/Quire Structures 2.md": md(P(QS, { title: "Quire Structures", aliases: ["Quires"], updated: TS(29) }), "the fold is the unit"),
  "notes/By Filename.md": md(P("01F1F1F1F1F1F1F1F1F1F1F1F1", { title: "By Filename", updated: TS(28) }), "see [[Quire Structures 2]]"),
  "notes/By Alias.md": md(P("01A1A1A1A1A1A1A1A1A1A1A1A1", { title: "By Alias", updated: TS(27) }), "see [[Quires]]"),
  "notes/By Path.md": md(P("01P1P1P1P1P1P1P1P1P1P1P1P1", { title: "By Path", updated: TS(26) }), "see [[notes/Quire Structures 2.md]]"),
  // What the mention picker writes: the id, the one form a rename cannot break.
  "notes/By Id.md": md(P("01D1D1D1D1D1D1D1D1D1D1D1D1", { title: "By Id", updated: TS(25) }), `see [[${QS}]]`),
  "notes/By Title.md": md(P("01T1T1T1T1T1T1T1T1T1T1T1T1", { title: "By Title", updated: TS(24) }), "see [[Quire Structures]]"),
  "notes/Unrelated.md": md(P("01U1U1U1U1U1U1U1U1U1U1U1U1", { title: "Unrelated", updated: TS(23) }), "nothing links out of here"),
};

async function linkFixture(extra = {}) {
  const v = new Vault(new MemoryBackend({ ...LINK_FILES, ...extra }), { now: () => TS(30) });
  await v.buildIndex();
  return new Data(v, { now: () => new Date(TS(30)) });
}

test("backlinks resolve by filename, alias, path and id — never by title:", async () => {
  const d = await linkFixture();
  const { items, count } = d.backlinks(QS);
  assert.deepEqual(items.map((p) => p.title).sort(),
    ["By Alias", "By Filename", "By Id", "By Path"]);
  assert.equal(count, 4);
  assert.ok(!items.some((p) => p.title === "By Title"),
    "[[Quire Structures]] names no file and no alias — Obsidian draws it broken, "
    + "so counting it would claim a link the vault does not have");
  assert.ok(!items.some((p) => p.id === QS), "a page is not its own backlink");
});

test("backlinks of an unknown id are empty, not everything", async () => {
  const d = await linkFixture();
  assert.deepEqual(d.backlinks("01ZZZZZZZZZZZZZZZZZZZZZZZZ"), { items: [], count: 0 });
});

test("orbit() resolves its link half the same way, and keeps its tag half", async () => {
  const d = await linkFixture({
    // The topic's tag is its own name slugged, and has nothing to do with links.
    "notes/Tagged.md": md(P("01G1G1G1G1G1G1G1G1G1G1G1G1", { title: "Tagged", tags: ["quire-structures"], updated: TS(22) }), "no link, just the tag"),
  });
  const { items, tag } = d.orbit(QS);
  assert.equal(tag, "quire-structures", "the tag half still comes from the title");
  assert.deepEqual(items.map((p) => [p.title, p.via]), [
    ["By Filename", "link"], ["By Alias", "link"], ["By Path", "link"],
    ["By Id", "link"], ["Tagged", "tag"],
  ], "newest first, and each says why it is here");
  assert.ok(!items.some((p) => p.title === "By Title"),
    "a dead link is not an orbit — the page says a name no file answers to");
});

test("the mention filter takes an id or a link target, and resolves both", async () => {
  const d = await linkFixture();
  const byId = await d.pages({ mention: QS });
  assert.deepEqual(byId.items.map((p) => p.title).sort(),
    ["By Alias", "By Filename", "By Id", "By Path"]);
  // Named instead of identified: the alias and the filename are the same page,
  // so they answer with the same set.
  for (const name of ["Quires", "quire structures 2", "notes/Quire Structures 2.md"]) {
    assert.deepEqual((await d.pages({ mention: name })).items.map((p) => p.title).sort(),
      byId.items.map((p) => p.title).sort(), `mention=${name}`);
  }
  assert.deepEqual((await d.pages({ mention: "Quire Structures" })).items.map((p) => p.title),
    ["By Title"], "a target no page answers to falls back to the literal string, "
    + "which is what an asset embed is");
});

test("addBookmarks: one paste, many links, no duplicates", async () => {
  const d = await fixture();
  const r = await d.addBookmarks(
    "https://a.test/one\nhttps://b.test/two-thing\nnot a link at all");
  assert.equal(r.found, 2);
  assert.equal(r.added.length, 2);
  assert.deepEqual(r.duplicates, []);
  // Stored the way CONVENTION says a bookmark is stored: a note carrying url.
  const saved = d.v.list().find((e) => e.url === "https://a.test/one");
  assert.equal(saved.kind, "note", "a bookmark is a note with a url on disk");
  assert.ok(saved.path.startsWith("notes/"));
  // Titled from the url, because nothing here may fetch the page.
  assert.equal(r.added[1].title, "two thing — b.test");
  // It shows up under the bookmark facet, which is the list the box sits on.
  assert.equal((await d.pages({ kind: "bookmark" })).count, 2);

  // The same links again — reported, not saved twice, tracking params and all.
  const again = await d.addBookmarks("https://a.test/one?utm_source=x https://c.test/new");
  assert.equal(again.added.length, 1);
  assert.equal(again.duplicates.length, 1);
  assert.equal(again.duplicates[0].title, "one — a.test");
  assert.equal((await d.pages({ kind: "bookmark" })).count, 3);
});

test("addBookmarks: nothing to save is not an error", async () => {
  const d = await fixture();
  const r = await d.addBookmarks("just some prose");
  assert.deepEqual(r, { added: [], duplicates: [], found: 0 });
  const tagged = await d.addBookmarks("https://x.test/a", { tags: ["reading"] });
  assert.deepEqual(tagged.added[0].tags, ["reading"]);
});

test("6.18 tags aggregate client-side, inline tags included", async () => {
  const d = await fixture();
  const tags = (await d.tags()).tags;
  assert.deepEqual(tags.find((t) => t.tag === "cartography"), { tag: "cartography", count: 2 });
  assert.ok(tags.some((t) => t.tag === "inline"), "inline #tags must be aggregated too");
});

test("createTag writes a subject page in tags/, and tags() surfaces it at zero", async () => {
  const d = await fixture();
  const r = await d.createTag("  Letterpress Grids ");
  assert.equal(r.ok, true);
  assert.equal(r.tag, "letterpress-grids", "lowercase hyphenated basename, per CONVENTION");
  const entry = d.v.list().find((e) => e.path === "tags/letterpress-grids.md");
  assert.ok(entry, "the tag is a file the other clients can see");
  const tags = (await d.tags()).tags;
  assert.deepEqual(tags.find((t) => t.tag === "letterpress-grids"),
    { tag: "letterpress-grids", count: 0 },
    "unused subject shows at zero rather than nowhere");
  // A tag already in use aggregates normally and cannot be created twice…
  assert.equal((await d.createTag("cartography")).ok, false);
  // …and a name any page holds is refused, not suffixed: filenames are addressing.
  const clash = await d.createTag("Alpha");
  assert.equal(clash.ok, false);
  assert.equal(clash.reason, "name-taken");
});

test("6.18 mention-suggest works offline and ranks prefixes first", async () => {
  const d = await fixture();
  const items = (await d.suggestMentions("be")).items;
  assert.ok(items.length >= 1, "typing [[ must offer at least one suggestion offline");
  assert.equal(items[0].title, "Beta");
  // aliases are suggestable
  assert.ok((await d.suggestMentions("gee")).items.some((i) => i.title === "Gee"));
});

test("pages() filters by kind, tag and query, newest first", async () => {
  const d = await fixture();
  assert.equal((await d.pages({ kind: "topic" })).count, 1);
  assert.equal((await d.pages({ tag: "cartography" })).count, 2);
  assert.equal((await d.pages({ q: "gam" })).items[0].title, "Gamma");
  const all = await d.pages({});
  assert.deepEqual(all.items.map((i) => i.title),
    ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "About me"]);
  assert.equal((await d.pages({ limit: 2 })).count, 2);
});

test("6.5 full-text search finds a string only present beyond the excerpt", async () => {
  const d = await fixture();
  const quick = await d.pages({ q: "needle_xyz" });
  assert.equal(quick.count, 0, "the index excerpt must not contain it");
  const deep = await d.searchFullText("needle_xyz");
  assert.equal(deep.count, 1);
  assert.equal(deep.items[0].title, "Beta");
});

test("list results carry the excerpt, not full bodies (§7)", async () => {
  const d = await fixture();
  const beta = (await d.pages({ q: "beta" })).items[0];
  assert.ok(beta.body.length <= 300);
  const full = await d.page("01BBBBBBBBBBBBBBBBBBBBBBBB");
  assert.ok(full.body.length > 300, "page(id) must return the real body");
});

test("pages?mention= resolves via the target's title", async () => {
  const d = await fixture();
  const r = await d.pages({ mention: "01BBBBBBBBBBBBBBBBBBBBBBBB" });
  assert.deepEqual(r.items.map((i) => i.title), ["Alpha"]);
});

test("batch returns only the ids asked for", async () => {
  const d = await fixture();
  const r = await d.batch("01AAAAAAAAAAAAAAAAAAAAAAAA,01CCCCCCCCCCCCCCCCCCCCCCCC,nope");
  assert.deepEqual(r.items.map((i) => i.title), ["Alpha", "Gamma"]);
});

test("create, update and delete round-trip through the vault", async () => {
  const d = await fixture();
  const made = await d.createPage({ kind: "note", title: "Zeta", body: "new", tags: ["fresh"] });
  assert.equal(made.title, "Zeta");
  assert.equal(made.path, "notes/Zeta.md");
  const edited = await d.updatePage(made.id, { body: "changed", title: "Zeta II" });
  assert.equal(edited.title, "Zeta II");
  // The file follows the title, so `[[Zeta II]]` resolves and the old name is
  // freed rather than kept forever.
  assert.equal(edited.path, "notes/Zeta II.md");
  assert.equal(await d.v.be.exists("notes/Zeta.md"), false);
  assert.equal((await d.page(made.id)).body, "changed");
  const gone = await d.deletePage(made.id);
  assert.ok(gone.ok);
  assert.equal(await d.page(made.id), null);
  assert.ok(await d.v.be.exists(".trash/notes/Zeta II.md"));
});

test("about-me reads context/about-me.md", async () => {
  const d = await fixture();
  assert.match((await d.aboutMe()).body, /restrained/);
});

test("dashboard runs off the index", async () => {
  const d = await fixture();
  const dash = await d.dashboard();
  assert.equal(dash.stats.pages_total, 6);
  assert.ok(dash.obsessions.some((o) => o.title === "cartography"));
});

test("6.8 the path routers cover every surviving endpoint", async () => {
  const d = await fixture();
  const ok = [
    "counts", "tags", "dashboard", "about-me", "mentions/suggest?q=a",
    "pages", "pages?limit=2", "pages?kind=topic", "pages?tag=cartography",
    "pages?q=alpha", "pages?mention=01BBBBBBBBBBBBBBBBBBBBBBBB",
    "pages/batch?ids=01AAAAAAAAAAAAAAAAAAAAAAAA",
    "pages/01AAAAAAAAAAAAAAAAAAAAAAAA",
    "export/01AAAAAAAAAAAAAAAAAAAAAAAA",
  ];
  for (const p of ok) assert.ok(await d.get(p) !== undefined, p);
  assert.match((await d.post("render/markdown", { md: "hi" })).html, /<p>hi<\/p>/);
});

test("6.8 removed endpoints fail loudly instead of silently returning nothing", async () => {
  const d = await fixture();
  for (const p of ["graph?mode=x", "settings", "voice/profile", "export/resume", "export/all"]) {
    await assert.rejects(() => d.get(p), /no local implementation/, p);
  }
  for (const p of ["chat/page", "links/fetch", "import/notion", "backup/run"]) {
    await assert.rejects(() => d.post(p, {}), /no local implementation/, p);
  }
});

test("6.3 a changed-on-disk edit returns a conflict, and force keeps both versions", async () => {
  const d = await fixture();
  const id = "01AAAAAAAAAAAAAAAAAAAAAAAA";
  // Obsidian edits the file behind our back
  await d.v.be.writeText("notes/Alpha.md",
    md(P(id, { title: "Alpha", updated: TS(30) }), "edited in obsidian"));
  const refused = await d.updatePage(id, { body: "mine" });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "conflict");
  assert.match(await d.v.be.readText("notes/Alpha.md"), /obsidian/, "their work must survive");

  const forced = await d.updatePage(id, { body: "mine", force: true });
  assert.ok(forced && forced.ok !== false, "force must succeed");
  assert.match(await d.v.be.readText("notes/Alpha.md"), /mine/);
  const copies = [...d.v.be.files.keys()].filter((p) => p.includes("(conflict"));
  assert.equal(copies.length, 1, `disk version must be preserved: ${copies}`);
  assert.match(await d.v.be.readText(copies[0]), /obsidian/);
});

test("6.2 an app edit is visible to any other reader of the file", async () => {
  const d = await fixture();
  const id = "01CCCCCCCCCCCCCCCCCCCCCCCC";
  await d.updatePage(id, { body: "written through put()" });
  // read the raw bytes the way Obsidian would
  const raw = await d.v.be.readText("topics/Gamma.md");
  assert.match(raw, /written through put\(\)/);
  assert.match(raw, /^---\nid: 01CCCCCCCCCCCCCCCCCCCCCCCC$/m, "frontmatter intact");
  assert.equal((await d.v.be.listDir(`.history/${id}`)).length, 1, "history snapshot taken");
});

test("list results are marked as carrying an excerpt, not a full body", async () => {
  const d = await fixture();
  const listed = (await d.pages({ q: "beta" })).items[0];
  assert.equal(listed.bodyIsFull, false, "a list result must declare its body is partial");
  const full = await d.page("01BBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(full.bodyIsFull, true);
  assert.ok(full.body.length > listed.body.length,
    "and the full body must actually be longer than the excerpt");
});

test("a body longer than the excerpt keeps its section headings", async () => {
  // The excerpt is whitespace-collapsed, so a '## Thread' inside it stops being
  // a heading. This is what made long threads vanish from the page view.
  const long = "Intro paragraph.\n\n" + "filler ".repeat(60) + "\n\n## Thread\n\n**user** 2026-01-01\nhi";
  const be = new MemoryBackend({
    "topics/T.md": md(P("01TTTTTTTTTTTTTTTTTTTTTTTT", { kind: "topic", title: "T" }), long),
  });
  const v = new Vault(be, { now: () => TS(30) });
  await v.buildIndex();
  const d = new Data(v);
  const listed = (await d.pages({})).items[0];
  const full = await d.page("01TTTTTTTTTTTTTTTTTTTTTTTT");
  assert.ok(!/^## Thread$/m.test(listed.body), "the excerpt cannot carry the heading");
  assert.match(full.body, /^## Thread$/m, "the full body must");
});

// ── Boards must reach the view ───────────────────────────────────────────
// Found in a browser: a canvas page's `.canvas` sibling was attached only for
// the *bare* case, so an ordinary two-file board rendered empty. SPEC §10 asks
// for read-only boards, which is not the same as no boards.
test("layoutFromCanvas inverts the migration's node mapping", () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: "n1", type: "text", text: "foil vs twin-tip", x: 0, y: 0, width: 240, height: 120 },
      { id: "n2", type: "link", url: "https://example.com/k", x: 300, y: 0, width: 300, height: 160 },
      { id: "n3", type: "file", file: "attachments/kite.png", x: 0, y: 200, width: 200, height: 200 },
    ],
    edges: [],
  });
  const l = layoutFromCanvas(canvas);
  assert.deepEqual(l.map((i) => i.type), ["text", "link", "image"]);
  assert.equal(l[0].text, "foil vs twin-tip");
  assert.equal(l[1].url, "https://example.com/k");
  assert.equal(l[2].asset, "attachments/kite.png");
  assert.deepEqual(
    l.map((i) => [i.x, i.y, i.w, i.h]),
    [[0, 0, 240, 120], [300, 0, 300, 160], [0, 200, 200, 200]]);
});

test("a malformed .canvas yields an empty board, never a crash", () => {
  assert.deepEqual(layoutFromCanvas("{not json"), []);
  assert.deepEqual(layoutFromCanvas("{}"), []);
});

test("a group keeps its label, and an unknown node type keeps its name", () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: "g1", type: "group", label: "Rigging", x: -40, y: -40, width: 400, height: 300 },
      { id: "g2", type: "group", x: 0, y: 0, width: 100, height: 100 },
      { id: "x1", type: "portal", x: 0, y: 0, width: 100, height: 100 },
    ],
    edges: [],
  });
  const l = layoutFromCanvas(canvas);
  // Without the label a group is an anonymous rectangle drawn over its members.
  assert.equal(l[0].label, "Rigging");
  assert.equal(l[1].label, "", "a group with no label must still be a group");
  assert.deepEqual(l.map((i) => i.type), ["group", "group", "portal"]);
  // Negative coordinates are ordinary in JSON Canvas and must survive intact.
  assert.deepEqual([l[0].x, l[0].y], [-40, -40]);
});

// ── The board renderer is gone ───────────────────────────────────────────
// One kind, one editor: a .canvas is Obsidian's and the app links out to it
// rather than drawing it. The node list survives for the inspo migration; the
// edges do not, because nothing draws them and a half-kept renderer is how a
// stylus stroke once wrote over somebody's board.
test("a board no longer carries edges, because nothing draws them", async () => {
  const be = new MemoryBackend({
    "canvas/Wired.md":
      "---\nid: 01EEEEEEEEEEEEEEEEEEEEEEEE\nkind: canvas\ntitle: Wired\n"
      + "created: 2026-07-01T00:00:00+00:00\nupdated: 2026-07-01T00:00:00+00:00\n---\n\n![[Wired.canvas]]\n",
    "canvas/Wired.canvas": JSON.stringify({
      nodes: [{ id: "n1", type: "text", text: "a", x: 0, y: 0, width: 200, height: 100 }],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
    }),
  });
  const v = new Vault(be); await v.buildIndex();
  const d = new Data(v, { renderMarkdown: (m) => m });
  const p = await d.page("01EEEEEEEEEEEEEEEEEEEEEEEE");
  assert.equal(p.meta.edges, undefined, "edges are parsed for nobody");
  assert.equal(p.meta.layout.length, 1, "the nodes stay: the inspo import reads them");
});

test("a two-file canvas page carries its board into meta.layout", async () => {
  const be = new MemoryBackend({
    "canvas/Board.md":
      "---\nid: 01DDDDDDDDDDDDDDDDDDDDDDDD\nkind: canvas\ntitle: Board\n"
      + "created: 2026-07-01T00:00:00+00:00\nupdated: 2026-07-01T00:00:00+00:00\n---\n\n![[Board.canvas]]\n",
    "canvas/Board.canvas": JSON.stringify({
      nodes: [{ id: "n1", type: "text", text: "hello", x: 1, y: 2, width: 3, height: 4 }], edges: [],
    }),
  });
  const v = new Vault(be); await v.buildIndex();
  const d = new Data(v, { renderMarkdown: (m) => m });
  const p = await d.page("01DDDDDDDDDDDDDDDDDDDDDDDD");
  assert.ok(Array.isArray(p.meta.layout), "the board never reached the view");
  assert.equal(p.meta.layout.length, 1);
  assert.equal(p.meta.layout[0].text, "hello");
});

// ── Projects are folders, not a kind ─────────────────────────────────────
// The screen asked for `kind: "project"`, which nothing can ever be, so it
// reported an empty vault however many projects were on disk — and its "+ new
// project" button wrote notes/<Title>.md carrying `kind: project`.
function projectVault() {
  const pg = (id, title) =>
    `---\nid: ${id}\nkind: note\ntitle: ${title}\n`
    + `created: 2026-07-01T00:00:00+00:00\nupdated: 2026-07-02T00:00:00+00:00\n---\n\nBody of ${title}.\n`;
  return new MemoryBackend({
    "notes/Loose.md": pg("01LLLLLLLLLLLLLLLLLLLLLLLL", "Loose"),
    "projects/Kite Build/Kite Build.md": pg("01PPPPPPPPPPPPPPPPPPPPPPPP", "Kite Build"),
    "projects/Kite Build/Spars.md": pg("01QQQQQQQQQQQQQQQQQQQQQQQQ", "Spars"),
    "projects/Kite Build/Lines.md": pg("01RRRRRRRRRRRRRRRRRRRRRRRR", "Lines"),
  });
}

test("projects are derived from folders under projects/", async () => {
  const v = new Vault(projectVault()); await v.buildIndex();
  const d = new Data(v, { renderMarkdown: (m) => m });
  const { items, count } = await d.projects();
  assert.equal(count, 1);
  assert.equal(items[0].title, "Kite Build");
  assert.equal(items[0].id, "01PPPPPPPPPPPPPPPPPPPPPPPP", "the folder note supplies the id");
  assert.equal(items[0].memberCount, 2, "the folder note is not its own member");
  assert.deepEqual(items[0].members.map((m) => m.title).sort(), ["Lines", "Spars"]);
});

test("creating a project writes projects/<Title>/<Title>.md", async () => {
  const be = projectVault();
  const v = new Vault(be); await v.buildIndex();
  const d = new Data(v, { renderMarkdown: (m) => m });
  const p = await d.createProject("Second Kite");
  assert.equal(p.path, "projects/Second Kite/Second Kite.md");
  assert.equal(p.kind, "note", "project is a folder, not a kind");
  assert.equal((await d.projects()).count, 2);
});

test("createPage refuses a kind that does not exist", async () => {
  const v = new Vault(projectVault()); await v.buildIndex();
  const d = new Data(v, { renderMarkdown: (m) => m });
  const r = await d.createPage({ kind: "project", title: "Nope", body: "" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-kind");
  assert.equal(await v.be.exists("notes/Nope.md"), false, "must not mis-file it into notes/");
});

// ── Sub-pages ───────────────────────────────────────────────────────────────
// `parent` and `children` are wikilinks on disk (CONVENTION §Links) and ids in
// the app, so this is the seam. Before this existed, createPage never read the
// parent it was handed and page() never surfaced one, so `meta.parent` was
// undefined on every page in the vault and the breadcrumb was dead markup.

test("a sub-page is born carrying its parent, as a quoted wikilink", async () => {
  const d = await fixture();
  const child = await d.createPage({ kind: "topic", title: "Coptic Stitch",
                                     parent: "01CCCCCCCCCCCCCCCCCCCCCCCC" });
  const raw = await d.v.be.readText(child.path);
  assert.match(raw, /^parent: "\[\[Gamma\]\]"$/m,
    "the title, quoted — an unquoted [[X]] is a YAML sequence, an id is Obsidian-dead");
});

test("page() reports parent and children as ids, both directions", async () => {
  const d = await fixture();
  const child = await d.createPage({ kind: "topic", title: "Coptic Stitch",
                                     parent: "01CCCCCCCCCCCCCCCCCCCCCCCC" });
  assert.equal((await d.page(child.id)).meta.parent, "01CCCCCCCCCCCCCCCCCCCCCCCC");
  assert.deepEqual((await d.page("01CCCCCCCCCCCCCCCCCCCCCCCC")).meta.children, [child.id]);
});

test("the parent's list is derived, so it is never a second copy to go stale", async () => {
  const d = await fixture();
  const child = await d.createPage({ kind: "topic", title: "Coptic Stitch",
                                     parent: "01CCCCCCCCCCCCCCCCCCCCCCCC" });
  const parentRaw = await d.v.be.readText("topics/Gamma.md");
  assert.doesNotMatch(parentRaw, /^children:/m, "nothing is written on the parent");
  assert.deepEqual((await d.page("01CCCCCCCCCCCCCCCCCCCCCCCC")).meta.children, [child.id]);
});

test("a hand-written parent: from Obsidian is read the same way", async () => {
  const d = await fixture();
  await d.v.be.writeText("notes/Hand.md", md(P("01FFFFFFFFFFFFFFFFFFFFFFFF",
    { title: "Hand", parent: "[[Gamma]]" }), "written by hand"));
  await d.v.buildIndex();
  assert.equal((await d.page("01FFFFFFFFFFFFFFFFFFFFFFFF")).meta.parent,
    "01CCCCCCCCCCCCCCCCCCCCCCCC");
  // …and by alias, which is how a renamed parent keeps its children.
  await d.v.be.writeText("notes/Hand2.md", md(P("01GGGGGGGGGGGGGGGGGGGGGGGG",
    { title: "Hand2", parent: "[[Gee]]" }), "by alias"));
  await d.v.buildIndex();
  assert.equal((await d.page("01GGGGGGGGGGGGGGGGGGGGGGGG")).meta.parent,
    "01CCCCCCCCCCCCCCCCCCCCCCCC");
});

test("renaming a parent leaves the alias that keeps its sub-pages attached", async () => {
  const d = await fixture();
  const child = await d.createPage({ kind: "topic", title: "Coptic Stitch",
                                     parent: "01CCCCCCCCCCCCCCCCCCCCCCCC" });
  await d.updatePage("01CCCCCCCCCCCCCCCCCCCCCCCC", { title: "Gamma Rays" });
  await d.v.buildIndex();
  assert.equal(d.v.index.get("01CCCCCCCCCCCCCCCCCCCCCCCC").path, "topics/Gamma Rays.md");
  assert.equal((await d.page(child.id)).meta.parent, "01CCCCCCCCCCCCCCCCCCCCCCCC",
    "a `parent:` is an inbound link the mentions scan cannot see");
});

test("a parent can be detached, and the key goes with it", async () => {
  const d = await fixture();
  const child = await d.createPage({ kind: "topic", title: "Coptic Stitch",
                                     parent: "01CCCCCCCCCCCCCCCCCCCCCCCC" });
  await d.updatePage(child.id, { meta: { parent: null } });
  assert.equal((await d.page(child.id)).meta.parent, undefined);
  assert.doesNotMatch(await d.v.be.readText(child.path), /^parent:/m);
});

test("a list row carries its parent, which is what indents the tree", async () => {
  const d = await fixture();
  const child = await d.createPage({ kind: "topic", title: "Coptic Stitch",
                                     parent: "01CCCCCCCCCCCCCCCCCCCCCCCC" });
  const row = d.pages({ kind: "topic" }).items.find((p) => p.id === child.id);
  assert.equal(row.meta.parent, "01CCCCCCCCCCCCCCCCCCCCCCCC");
});

// ── A board is not its back-of-note ─────────────────────────────────────────
// `page(id)` hands the app a board's BACK OF THE NOTE as the page body, so the
// shared header and chips row — which save `body` like every other kind — were
// writing half a file over the whole one. Editing a board's title, or adding a
// tag to it, silently deleted the drawing.

test("an ordinary save on a board keeps the drawing, byte for byte", async () => {
  const d = await fixture();
  const board = await d.createPage({ kind: "drawing", title: "Sketch" });
  const before = await d.v.be.readText(board.path);
  assert.match(before, /# Excalidraw Data/);
  await d.updatePage(board.id, { title: "Sketch renamed", body: board.body, tags: ["x"] });
  const after = await d.v.be.readText(d.v.index.get(board.id).path);
  assert.match(after, /# Excalidraw Data/, "the scene survived a title edit");
  assert.equal(after.split("# Excalidraw Data")[1], before.split("# Excalidraw Data")[1],
    "and was not re-serialized either — an edit that touched no element rewrites nothing");
});

test("the back of the note is still writable, above the drawing", async () => {
  const d = await fixture();
  const board = await d.createPage({ kind: "drawing", title: "Sketch" });
  await d.updatePage(board.id, { body: "Why this board exists." });
  const after = await d.v.be.readText(board.path);
  assert.match(after, /Why this board exists\./);
  assert.match(after, /# Excalidraw Data/);
  assert.equal((await d.page(board.id)).body, "Why this board exists.");
});
