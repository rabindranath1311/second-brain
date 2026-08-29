// Bookmarks are a VIEW over notes-with-url, not a storage kind — the file says
// `kind: note` and Obsidian sees nothing new. These pin the seams that made
// bookmarks look unimplemented: pageOut dropped `url`, so chrome could never
// fire; and updatePage dropped `patch.meta`, so a url edited in the app
// reverted on reload.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, MemoryBackend } from "../vault/vault.js";
import { Data, noteChrome } from "../vault/data.js";
import { serialize } from "../vault/mdfile.js";

const TS = "2026-07-01T00:00:00+00:00";
const note = (id, fm = {}, body = "") => serialize({
  id, kind: "note", title: fm.title || "Note", created: TS, updated: TS, ...fm,
}, body);

const VAULT = () => new MemoryBackend({
  "notes/Article.md": note("01AAAAAAAAAAAAAAAAAAAAAAAA", { title: "Article" }, "prose"),
  "notes/Saved.md": note("01BBBBBBBBBBBBBBBBBBBBBBBB",
    { title: "Saved", url: "https://example.com/a" }, "why I saved it"),
  "notes/Card.md": note("01CCCCCCCCCCCCCCCCCCCCCCCC",
    { title: "Card", url: "https://example.com/b", og_image: "https://img.example/x.png" }),
  "topics/T.md": serialize({ id: "01DDDDDDDDDDDDDDDDDDDDDDDD", kind: "topic",
    title: "T", created: TS, updated: TS }, ""),
});

async function data() {
  const v = new Vault(VAULT()); await v.buildIndex();
  return new Data(v, { renderMarkdown: (m) => m });
}

test("kind=bookmark lists exactly the notes with a url", async () => {
  const d = await data();
  const { items } = d.pages({ kind: "bookmark" });
  assert.deepEqual(items.map((p) => p.title).sort(), ["Card", "Saved"]);
  // and they are still notes on disk
  assert.ok(items.every((p) => p.kind === "note"));
});

test("kind=note still includes bookmarks — that is what they are", async () => {
  const d = await data();
  const { items } = d.pages({ kind: "note" });
  assert.equal(items.length, 3);
});

test("counts gains a bookmark tally without shrinking note", async () => {
  const d = await data();
  const { counts } = d.counts();
  assert.equal(counts.bookmark, 2);
  assert.equal(counts.note, 3);
});

test("a full page carries url + meta the bookmark editor reads", async () => {
  const d = await data();
  const p = await d.page("01CCCCCCCCCCCCCCCCCCCCCCCC");
  assert.equal(p.url, "https://example.com/b");
  assert.equal(p.meta.url, "https://example.com/b");
  assert.equal(p.meta.og.image, "https://img.example/x.png");
  assert.equal(p.meta.links.length, 1);
  assert.equal(noteChrome(p), "bookmark card");
});

test("a url-less note renders as an article, unchanged", async () => {
  const d = await data();
  const p = await d.page("01AAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(noteChrome(p), "article");
  assert.equal(p.meta.url, undefined);
});

test("createPage('bookmark') writes kind: note with a url key", async () => {
  const d = await data();
  const p = await d.createPage({ kind: "bookmark", title: "Fresh", url: "" });
  assert.equal(p.kind, "note");
  assert.ok(p.path.startsWith("notes/"));
  // The empty url key is what makes a new bookmark open with a url field.
  assert.equal(noteChrome(p), "link with source line");
});

test("editing the url through page.meta persists to frontmatter", async () => {
  const d = await data();
  const before = await d.page("01BBBBBBBBBBBBBBBBBBBBBBBB");
  const meta = { ...before.meta, url: "https://example.com/moved",
    links: [{ url: "https://example.com/moved", og: null }] };
  await d.updatePage("01BBBBBBBBBBBBBBBBBBBBBBBB", { meta });
  const after = await d.page("01BBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(after.url, "https://example.com/moved");
  assert.equal(after.frontmatter.url, "https://example.com/moved");
});

test("multi-link bookmarks round-trip through fm.links", async () => {
  const d = await data();
  const meta = { links: [
    { url: "https://example.com/1", og: null },
    { url: "https://example.com/2", og: null },
  ] };
  await d.updatePage("01BBBBBBBBBBBBBBBBBBBBBBBB", { meta });
  const p = await d.page("01BBBBBBBBBBBBBBBBBBBBBBBB");
  assert.deepEqual(p.meta.links.map((l) => l.url),
    ["https://example.com/1", "https://example.com/2"]);
  assert.equal(p.frontmatter.url, "https://example.com/1",
    "links[0] mirrors into url so older readers still work");
});

// ── the link list, written and read back ────────────────────────────────────
//
// `updatePage`'s `patch.meta.links` branch and `page()`'s `fm.url != null`
// block are one contract read from two ends, and they used to disagree twice.
//
//   1. Deleting every link wrote `url: ""` — correct: mdfile keeps that key
//      because its presence is what says "bookmark in progress". But the read
//      side gated on `fm.url != null`, and `"" != null`, so it handed back one
//      link whose url was the empty string. The user deleted every link and
//      got a blank editor row and "Links · 1" — and it healed itself into
//      permanence, because the next save filtered the blank out and wrote
//      `url: ""` again.
//   2. The clipper writes one og flat and unkeyed, beside `url`. The read side
//      reattached it to `links[0]` positionally, with no check that links[0]
//      was the address it had been captured from — so deleting the first of
//      two links, or retyping it, left the survivor showing a stranger's
//      image, title and site name as its own preview.
//
// Both are checked through the real Data/Vault/MemoryBackend stack, because
// both only appear on the round trip.

const OG = {
  og_image: "https://img.example/one.png",
  og_title: "One",
  og_description: "the first page",
  og_site_name: "Example",
};

const CARD_VAULT = () => new MemoryBackend({
  "notes/Two.md": note("01EEEEEEEEEEEEEEEEEEEEEEEE", {
    title: "Two", url: "https://example.com/1",
    links: ["https://example.com/1", "https://example.com/2"], ...OG,
  }, "two links, one og"),
});

async function cardData() {
  const v = new Vault(CARD_VAULT()); await v.buildIndex();
  return new Data(v, { renderMarkdown: (m) => m });
}
const TWO = "01EEEEEEEEEEEEEEEEEEEEEEEE";
const save = (d, id, links) => d.updatePage(id, { meta: { links } });

test("deleting every link leaves NO link — not one blank row", async () => {
  const d = await data();
  const id = "01BBBBBBBBBBBBBBBBBBBBBBBB";
  await save(d, id, []);
  const p = await d.page(id);
  assert.deepEqual(p.meta.links, [], "an empty list reads back empty");
  assert.equal(p.meta.url, "", "…and the page stays a bookmark in progress");
  assert.equal(p.frontmatter.url, "", "which on disk is the empty url key");
  assert.ok(!("links" in p.frontmatter), "with no links key beside it");
  assert.equal(noteChrome(p), "link with source line");
});

test("the phantom row does not come back on the next save", async () => {
  const d = await data();
  const id = "01BBBBBBBBBBBBBBBBBBBBBBBB";
  await save(d, id, []);
  // What the editor sends after a reload: whatever page() just handed it.
  const reloaded = await d.page(id);
  await save(d, id, reloaded.meta.links);
  const again = await d.page(id);
  assert.deepEqual(again.meta.links, []);
  assert.equal(again.frontmatter.url, "");
});

test("an empty link list clears the url even when meta.url is not sent", async () => {
  const d = await data();
  const id = "01BBBBBBBBBBBBBBBBBBBBBBBB";
  // The list is authoritative whenever it is present. Falling back to the url
  // the page already had left the deleted address on disk to be read back.
  await save(d, id, []);
  assert.equal((await d.page(id)).frontmatter.url, "");
});

test("a note with `url: \"\"` is still a bookmark to the list and the count", async () => {
  // The whole app agrees a present-but-empty url is a bookmark in progress —
  // `noteChrome` says so, and both the facet filter and the count ask
  // `url != null` rather than for a truthy one. The index hoisted it with
  // `||`, so the one page that needs the distinction dropped out of the
  // Bookmark list and count while still opening with bookmark chrome.
  const v = new Vault(new MemoryBackend({
    "notes/Blank.md": note("01HHHHHHHHHHHHHHHHHHHHHHHH", { title: "Blank", url: "" }),
    "notes/Real.md": note("01JJJJJJJJJJJJJJJJJJJJJJJJ",
      { title: "Real", url: "https://example.com/r" }),
  }));
  await v.buildIndex();
  const d = new Data(v, { renderMarkdown: (m) => m });
  assert.deepEqual(d.pages({ kind: "bookmark" }).items.map((p) => p.title).sort(),
    ["Blank", "Real"]);
  assert.equal(d.counts().counts.bookmark, 2);
  assert.equal(v.index.get("01HHHHHHHHHHHHHHHHHHHHHHHH").url, "",
    "the key is present and empty — that IS the fact, so it survives the hoist");
});

test("deleting every link keeps the page in the Bookmark list", async () => {
  const d = await data();
  const id = "01BBBBBBBBBBBBBBBBBBBBBBBB";
  await save(d, id, []);
  assert.ok(d.pages({ kind: "bookmark" }).items.some((p) => p.id === id),
    "the page must not silently leave the list the user is looking at");
  assert.equal(d.counts().counts.bookmark, 2);
});

test("links can be added back after deleting them all", async () => {
  const d = await data();
  const id = "01BBBBBBBBBBBBBBBBBBBBBBBB";
  await save(d, id, []);
  await save(d, id, [{ url: "https://example.com/new", og: null }]);
  const p = await d.page(id);
  assert.deepEqual(p.meta.links.map((l) => l.url), ["https://example.com/new"]);
  assert.equal(p.frontmatter.url, "https://example.com/new");
});

test("the og goes to the url it was captured from, not to links[0]", async () => {
  const d = await cardData();
  const p = await d.page(TWO);
  assert.equal(p.meta.links[0].og.image, "https://img.example/one.png");
  assert.equal(p.meta.links[1].og, null);
});

test("a hand-written file whose links[0] is not `url` still attributes by value", async () => {
  // Nothing in the format promises links[0] === url; only the app's own writes
  // keep them in step. Matching by position trusts a promise nobody made.
  const v = new Vault(new MemoryBackend({
    "notes/Odd.md": note("01FFFFFFFFFFFFFFFFFFFFFFFF", {
      title: "Odd", url: "https://example.com/2",
      links: ["https://example.com/1", "https://example.com/2"], ...OG,
    }),
  }));
  await v.buildIndex();
  const p = await new Data(v, { renderMarkdown: (m) => m }).page("01FFFFFFFFFFFFFFFFFFFFFFFF");
  assert.equal(p.meta.links[0].og, null);
  assert.equal(p.meta.links[1].og.image, "https://img.example/one.png");
});

test("deleting the og'd link does not hand its card to the survivor", async () => {
  const d = await cardData();
  await save(d, TWO, [{ url: "https://example.com/2", og: null }]);
  const p = await d.page(TWO);
  assert.deepEqual(p.meta.links.map((l) => l.url), ["https://example.com/2"]);
  assert.equal(p.meta.links[0].og, null, "the survivor gets no preview of its own");
  assert.equal(p.meta.og, null);
  // …and the stale payload is off the disk, so Obsidian and the next agent to
  // read the file are not told this page looks like the one that was deleted.
  for (const k of ["og_image", "og_title", "og_description", "og_site_name"]) {
    assert.ok(!(k in p.frontmatter), `${k} describes an address no longer here`);
  }
  assert.equal(noteChrome(p), "link with source line");
});

test("retyping the og'd url in place drops the og with it", async () => {
  const d = await cardData();
  await save(d, TWO, [
    { url: "https://example.com/moved", og: null },
    { url: "https://example.com/2", og: null },
  ]);
  const p = await d.page(TWO);
  assert.equal(p.frontmatter.url, "https://example.com/moved");
  assert.ok(!("og_image" in p.frontmatter));
  assert.ok(p.meta.links.every((l) => l.og === null));
});

test("deleting a link that is NOT the og'd one keeps the og", async () => {
  const d = await cardData();
  await save(d, TWO, [{ url: "https://example.com/1", og: null }]);
  const p = await d.page(TWO);
  assert.equal(p.frontmatter.og_image, "https://img.example/one.png",
    "the url it describes is still here — clearing it would be data loss");
  assert.equal(p.meta.links[0].og.title, "One");
  assert.equal(noteChrome(p), "bookmark card");
});

test("deleting every link takes the og with it", async () => {
  const d = await cardData();
  await save(d, TWO, []);
  const p = await d.page(TWO);
  assert.deepEqual(p.meta.links, []);
  assert.equal(p.meta.og, null, "a card for a link that is gone is not a card");
  assert.ok(!("og_image" in p.frontmatter));
});

test("a url edited through patch.url clears the og too", async () => {
  // The og_* keys must not outlive their url whichever door the change came
  // through — `patch.url` and `patch.meta.links` are the same fact.
  const d = await cardData();
  await d.updatePage(TWO, { url: "https://example.com/elsewhere" });
  const p = await d.page(TWO);
  assert.ok(!("og_image" in p.frontmatter));
});

test("a save that does not touch the url leaves the og alone", async () => {
  const d = await cardData();
  await d.updatePage(TWO, { body: "new prose" });
  const p = await d.page(TWO);
  assert.equal(p.frontmatter.og_image, "https://img.example/one.png");
  assert.equal(p.meta.links[0].og.site_name, "Example");
});

test("an og stranded on `url: \"\"` renders as nothing, not as a card", async () => {
  // Reachable only from a file some other tool wrote. The empty url owns no
  // preview, and `noteChrome` already refuses to call it a card.
  const v = new Vault(new MemoryBackend({
    "notes/Stranded.md": note("01GGGGGGGGGGGGGGGGGGGGGGGG", { title: "Stranded", url: "", ...OG }),
  }));
  await v.buildIndex();
  const p = await new Data(v, { renderMarkdown: (m) => m }).page("01GGGGGGGGGGGGGGGGGGGGGGGG");
  assert.deepEqual(p.meta.links, []);
  assert.equal(p.meta.og, null);
  assert.equal(noteChrome(p), "link with source line");
});

test("the editor's ordinary save — meta resent unchanged — keeps the og", async () => {
  /* The editor sends the whole `page.meta` on EVERY save, so the url-changed
     test above has to be exact: a rule that cleared the og whenever
     `meta.links` arrived would strip the card off a clipped bookmark the
     first time its owner typed a sentence underneath it. */
  const d = await cardData();
  const before = await d.page(TWO);
  await d.updatePage(TWO, { body: "why I saved it", meta: before.meta });
  const p = await d.page(TWO);
  assert.equal(p.frontmatter.og_image, "https://img.example/one.png");
  assert.deepEqual(p.meta.links.map((l) => l.url),
    ["https://example.com/1", "https://example.com/2"]);
  assert.equal(p.meta.links[0].og.description, "the first page");
  assert.equal(p.meta.links[1].og, null);
  assert.equal(p.body, "why I saved it");
});

test("a blank row in flight is not what gets written", async () => {
  // "Add link" pushes `{url: "", og: null}` and focuses it; an autosave can
  // land before anything is typed. The empty row is not a link and must not
  // become one, nor unseat the url the page already has.
  const d = await cardData();
  await d.updatePage(TWO, { meta: { links: [
    { url: "https://example.com/1", og: null },
    { url: "https://example.com/2", og: null },
    { url: "", og: null },
  ] } });
  const p = await d.page(TWO);
  assert.deepEqual(p.meta.links.map((l) => l.url),
    ["https://example.com/1", "https://example.com/2"]);
  assert.equal(p.frontmatter.og_image, "https://img.example/one.png");
});
