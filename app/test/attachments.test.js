// The topic page's "Reference material" tray, and the seam it needed.
//
// The tray mutated `page.meta.attachments` and called save, `updatePage` mapped
// only `meta.url` / `meta.links` / `meta.parent` into frontmatter, and the rest
// was dropped on the floor while the UI painted "Saved". It could not have gone
// into frontmatter either: FIELD_ORDER has no key for it, `serialize()` throws
// on an unknown one, and an attachment is a nested object with a body of prose
// in it. CONVENTION already says where structured content goes — a body
// section — and `escapeUser` is why writing one takes a deliberate seam
// rather than a string concatenation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, MemoryBackend } from "../vault/vault.js";
import { Data } from "../vault/data.js";
import { serialize, parse, escapeUser, unescapeUser, roundtripOk } from "../vault/mdfile.js";
import {
  splitSections, joinBody, parseSections, getSection, setSection,
} from "../vault/sections.js";
import {
  serializeAttachments, parseAttachments, readAttachments, writeAttachments, typeFor,
} from "../vault/attachments.js";

const TS = (d) => `2026-07-${String(d).padStart(2, "0")}T12:00:00+00:00`;
const md = (fm, body = "") => serialize(fm, body);
const TOPIC = (over = {}) => ({
  id: "01TTTTTTTTTTTTTTTTTTTTTTTT", kind: "topic", title: "Kerning",
  created: TS(1), updated: TS(20), ...over,
});

async function topicVault(body = "The description.", files = {}) {
  const v = new Vault(new MemoryBackend({ "topics/Kerning.md": md(TOPIC(), body), ...files }),
                      { now: () => TS(30) });
  await v.buildIndex();
  return [v, new Data(v, { now: () => new Date(TS(30)) })];
}

const ATT = [
  { type: "text", title: "Ransom note", source: "text", body: "cut, paste, photocopy" },
  { type: "link", title: "Tracking on the web", source: "link",
    body: "the table halfway down", meta: { url: "https://example.com/kerning" } },
];

// ── the section seam ────────────────────────────────────────────────────────

test("splitSections keys off the UNESCAPED heading, which is what the escape is for", () => {
  // The same six words, one written by the app and one typed by a user. On
  // disk they differ by a backslash, and that backslash is the entire
  // difference between structure and prose.
  const body = joinBody(escapeUser("I keep notes under\n\n## Attachments\n\nin Obsidian."),
                        "## Attachments\n\n### A (text)\n\nreal");
  const { prose, sections } = splitSections(body);
  assert.ok(prose.includes("\\## Attachments"), "the user's heading stays escaped, and stays prose");
  assert.equal(unescapeUser(prose), "I keep notes under\n\n## Attachments\n\nin Obsidian.");
  assert.equal(getSection(sections, "Attachments"), "### A (text)\n\nreal");
});

test("joinBody inverts splitSections exactly", () => {
  const body = "Prose.\n\n## Thread\n\n**user** 2026-01-01\nhi\n\n## Attachments\n\n### A (text)\n\nx";
  const { prose, sections } = splitSections(body);
  assert.equal(joinBody(prose, sections), body);
  assert.deepEqual(parseSections(sections).map((s) => s.name), ["Thread", "Attachments"]);
});

test("setSection inserts in CONVENTION's order and removes on empty", () => {
  const withMentions = "## Mentions\n\n[[Kerning]]";
  const both = setSection(withMentions, "Attachments", "### A (text)\n\nx");
  assert.deepEqual(parseSections(both).map((s) => s.name), ["Attachments", "Mentions"],
    "Attachments sorts above Mentions, as CONVENTION lists them");
  assert.equal(setSection(both, "Attachments", ""), withMentions,
    "emptying the tray leaves no heading behind");
});

// ── the entry grammar ───────────────────────────────────────────────────────

test("an attachment round-trips through the markdown, verbatim", () => {
  const text = serializeAttachments(ATT);
  assert.match(text, /^### Ransom note \(text\)$/m);
  assert.match(text, /^Source: https:\/\/example\.com\/kerning$/m);
  const back = parseAttachments(text);
  assert.deepEqual(back.map((a) => [a.type, a.title, a.source, a.body]),
                   ATT.map((a) => [a.type, a.title, a.source, a.body]));
  assert.equal(back[1].url, "https://example.com/kerning");
  assert.equal(serializeAttachments(back), text, "and re-serializing changes nothing");
});

test("a pasted body cannot forge the boundary between two attachments", () => {
  // A conversation export is full of `###`, and `## Attachments` is six
  // characters anyone can type. Strict escaping is what keeps a paste from
  // splitting itself into three attachments on the next read.
  const forged = "User: what about\n### Kerning\n## Attachments\n**user** 2026-01-01\ndone";
  const text = serializeAttachments([
    { type: "chat", title: "A chat", source: "claude", body: forged },
    { type: "text", title: "After", source: "text", body: "still here" },
  ]);
  const back = parseAttachments(text);
  assert.equal(back.length, 2, "two attachments, not five");
  assert.equal(back[0].body, forged, "and the paste comes back exactly as pasted");
  assert.equal(back[1].title, "After");
});

test("a body that begins 'Source:' is text, not a URL", () => {
  const text = serializeAttachments([
    { type: "text", title: "Note", source: "text", body: "Source: the studio archive" },
  ]);
  const [a] = parseAttachments(text);
  assert.equal(a.url, undefined, "the blank line under the heading is the separator");
  assert.equal(a.body, "Source: the studio archive");
});

test("only http(s) reaches disk — the clipper's rule, for the same reason", () => {
  const text = serializeAttachments([
    { type: "link", title: "Bad", source: "link", body: "note", meta: { url: "javascript:alert(1)" } },
  ]);
  assert.ok(!text.includes("javascript:"), "a link the app would render must not be a script");
  assert.equal(parseAttachments(text)[0].type, "text");
});

test("the type is derived from the label, and an unknown label is plain text", () => {
  // CONVENTION's own example heading is `### Some article (web)`. It must read
  // as something, and text is the preview that can render any string.
  assert.equal(typeFor("web", null), "text");
  assert.equal(typeFor("web", "https://example.com"), "link");
  assert.equal(typeFor("chatgpt", null), "chat");
  assert.equal(typeFor("markdown", null), "markdown");
  const [a] = parseAttachments("### Some article (web)\nSource: https://example.com\n\nbody");
  assert.equal(a.type, "link");
  assert.equal(a.title, "Some article");
});

test("a title with its own parentheses survives the label", () => {
  const text = serializeAttachments([
    { type: "text", title: "Kerning (draft)", source: "text", body: "x" },
  ]);
  assert.equal(parseAttachments(text)[0].title, "Kerning (draft)");
});

test("an attachment with neither a body nor a URL is not written", () => {
  assert.equal(serializeAttachments([{ type: "text", title: "Empty", source: "text", body: "" }]), "");
});

// ── through the data layer, to disk and back ────────────────────────────────

test("the tray reaches disk as ## Attachments, and comes back", async () => {
  const [v, d] = await topicVault();
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  const r = await d.updatePage(id, { body: "The description.", meta: { attachments: ATT } });
  assert.notEqual(r.ok, false, r.message);

  const text = await v.be.readText("topics/Kerning.md");
  assert.match(text, /^## Attachments$/m, "the heading is real, not escaped");
  assert.ok(!text.includes("\\## Attachments"));
  assert.ok(!text.includes("attachments:"), "and nothing was smuggled into frontmatter");
  assert.ok(roundtripOk(text)[0], "the file still round-trips byte for byte");

  const back = await d.page(id);
  assert.equal(back.body, "The description.", "the prose is the prose");
  assert.deepEqual(back.meta.attachments.map((a) => a.title),
                   ["Ransom note", "Tracking on the web"]);
  assert.equal(back.meta.attachments[1].meta.url, "https://example.com/kerning");
});

test("saving the page the editor read back changes nothing", async () => {
  // The editor sends `page.meta` on every keystroke's worth of debounce. If a
  // read → write cycle were not a fixed point, the tray would grow a backslash
  // or an extra blank line on every save.
  const [v, d] = await topicVault();
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  await d.updatePage(id, { body: "The description.", meta: { attachments: ATT } });
  const once = await v.be.readText("topics/Kerning.md");
  const p = await d.page(id);
  await d.updatePage(id, { body: p.body, meta: p.meta });
  assert.equal(await v.be.readText("topics/Kerning.md"), once);
});

test("removing the last attachment removes the section", async () => {
  const [v, d] = await topicVault();
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  await d.updatePage(id, { meta: { attachments: ATT } });
  await d.updatePage(id, { meta: { attachments: [] } });
  const text = await v.be.readText("topics/Kerning.md");
  assert.ok(!/## Attachments/.test(text), "an emptied tray leaves no heading behind");
  assert.equal((await d.page(id)).meta.attachments, undefined);
});

test("a save that knows nothing about attachments leaves them alone", async () => {
  // Every other writer in the data layer — retitle, re-id, a save from a screen
  // with no tray — passes a body and no meta. A default of "drop the sections"
  // would make each of them a way to lose the material.
  const [v, d] = await topicVault();
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  await d.updatePage(id, { meta: { attachments: ATT } });

  await d.updatePage(id, { body: "A longer description." });
  assert.match(await v.be.readText("topics/Kerning.md"), /^### Ransom note \(text\)$/m);

  await d.retitle("topics/Kerning.md", "Kerning and tracking");
  const renamed = v.index.get(id).path;
  assert.match(await v.be.readText(renamed), /^### Ransom note \(text\)$/m);

  await d.newIdFor(renamed);
  assert.match(await v.be.readText(renamed), /^### Ransom note \(text\)$/m);
  assert.equal(readAttachments(splitSections(parse(await v.be.readText(renamed))[1]).sections).length, 2);
});

test("a real ## Thread is no longer unmade by the next save", async () => {
  // The bug the seam fixes beyond the tray: `put()` escaped the whole body, so
  // a page carrying a genuine structural section had its heading backslashed
  // the first time anything touched the page.
  const [v, d] = await topicVault("Prose.\n\n## Thread\n\n**user** 2026-01-01\nhi");
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  await d.updatePage(id, { title: "Kerning", body: "Prose." });
  const text = await v.be.readText("topics/Kerning.md");
  assert.match(text, /^## Thread$/m);
  assert.ok(!text.includes("\\## Thread"), "the section survives the save that used to unmake it");
  assert.match((await d.page(id)).sections, /^## Thread$/m);
});

test("restoring a version brings its reference material back with it", async () => {
  const [v, d] = await topicVault();
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  await d.updatePage(id, { body: "The description.", meta: { attachments: ATT } });
  await d.updatePage(id, { body: "Rewritten.", meta: { attachments: [] } });

  const snaps = await d.pageHistory(id);
  const snap = await d.readSnapshot(snaps.find((s) => s.path.endsWith(".md")).path);
  assert.equal(snap.ok, true);
  assert.ok(!snap.body.includes("## Attachments"), "the prose is the prose here too");
  assert.deepEqual(snap.attachments.map((a) => a.title), ["Ransom note", "Tracking on the web"]);
});

test("the tray is searchable — material you cannot find is material you filed and lost", async () => {
  const [, d] = await topicVault();
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  await d.updatePage(id, { meta: { attachments: ATT } });
  const hits = await d.searchFullText("photocopy");
  assert.deepEqual(hits.items.map((p) => p.id), [id]);
});

test("the excerpt is the prose, not what was filed under it", async () => {
  const [v, d] = await topicVault("");
  const id = "01TTTTTTTTTTTTTTTTTTTTTTTT";
  await d.updatePage(id, { body: "", meta: { attachments: ATT } });
  await v.buildIndex();
  assert.equal(v.index.get(id).excerpt, "");
});

test("a board is one blob, and the seam does not reach into it", async () => {
  // A `.excalidraw.md` is the plugin's format end to end: the `%%` block, the
  // regenerated `## Text Elements` index, and the back-of-note above them. The
  // editor re-serializes the whole thing and saves it as `body`, so lifting a
  // section out of the middle would hand the board's own text back twice.
  const board = [
    "Notes above the drawing.",
    "",
    "## Board contents",
    "",
    "- the sewing order",
    "",
    "## Text Elements",
    "",
    "fold ^abc",
  ].join("\n");
  const files = {
    "canvas/Sewing Order.excalidraw.md": md({
      id: "01BBBBBBBBBBBBBBBBBBBBBBBB", kind: "canvas", title: "Sewing Order",
      created: TS(1), updated: TS(20), "excalidraw-plugin": "parsed",
    }, board),
  };
  const v = new Vault(new MemoryBackend(files), { now: () => TS(30) });
  await v.buildIndex();
  const p = await v.get("01BBBBBBBBBBBBBBBBBBBBBBBB");
  assert.equal(p.sections, "", "a board hands back no sections of its own");
  assert.match(p.body, /^## Board contents$/m, "they stay inside its body");

  const d = new Data(v, { now: () => new Date(TS(30)) });
  await d.updatePage(p.id, { body: p.body });
  const text = await v.be.readText("canvas/Sewing Order.excalidraw.md");
  assert.equal((text.match(/## Board contents/g) || []).length, 1,
    "and a save writes the board's text exactly once");
});

test("writeAttachments leaves a foreign section exactly where it was", () => {
  const sections = "## Thread\n\n**user** 2026-01-01\nhi";
  const next = writeAttachments(sections, ATT);
  assert.deepEqual(parseSections(next).map((s) => s.name), ["Thread", "Attachments"]);
  assert.equal(getSection(next, "Thread"), "**user** 2026-01-01\nhi");
});
