// A project is a folder that holds pages of every kind. These pin the
// container behaviour: creation files INTO the folder, membership IS the
// folder, and a drawing created here is a file Obsidian's plugin owns.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, MemoryBackend } from "../vault/vault.js";
import { Data } from "../vault/data.js";
import { parseExcalidraw } from "../vault/excalidraw.js";
import { serialize } from "../vault/mdfile.js";

const TS = "2026-07-01T00:00:00+00:00";

async function data(files = {}) {
  const v = new Vault(new MemoryBackend(files));
  await v.buildIndex();
  return new Data(v, { renderMarkdown: (m) => m, now: () => new Date(TS) });
}

test("createPage with project files into the project folder, any kind", async () => {
  const d = await data();
  const note = await d.createPage({ kind: "note", title: "Brief", project: "Rebrand" });
  const topic = await d.createPage({ kind: "topic", title: "Voice", project: "Rebrand" });
  const bm = await d.createPage({ kind: "bookmark", title: "Ref", project: "Rebrand" });
  assert.equal(note.path, "projects/Rebrand/Brief.md");
  assert.equal(topic.path, "projects/Rebrand/Voice.md");
  assert.equal(bm.path, "projects/Rebrand/Ref.md");
  // the file keeps its true kind — the folder is the membership
  assert.equal(topic.kind, "topic");
  assert.equal(bm.kind, "note");
});

test("a drawing created in a project is the plugin's own file format", async () => {
  const d = await data();
  const p = await d.createPage({ kind: "drawing", title: "Wireframe", project: "Rebrand" });
  assert.equal(p.path, "projects/Rebrand/Wireframe.excalidraw.md");
  assert.equal(p.kind, "canvas", "a drawing IS a canvas");
  // The on-disk file must be recognisable to the Obsidian plugin and to us.
  assert.equal(p.frontmatter["excalidraw-plugin"], "parsed");
  assert.ok(p.meta.excalidraw, "the drawing editor gets a scene to mount");
  assert.equal(p.meta.excalidraw.error, null);
  assert.deepEqual(p.meta.excalidraw.scene.elements, []);
});

test("a drawing can be created outside a project too", async () => {
  const d = await data();
  const p = await d.createPage({ kind: "drawing", title: "Sketch" });
  assert.equal(p.path, "canvas/Sketch.excalidraw.md");
});

test("projectMembers is the folder minus its own note", async () => {
  const d = await data({
    "projects/Rebrand/Rebrand.md": serialize({
      id: "01PPPPPPPPPPPPPPPPPPPPPPPP", kind: "note", title: "Rebrand",
      created: TS, updated: TS }, "the folder note"),
  });
  await d.createPage({ kind: "note", title: "Brief", project: "Rebrand" });
  await d.createPage({ kind: "drawing", title: "Wireframe", project: "Rebrand" });
  const { items, count } = d.projectMembers("Rebrand");
  assert.equal(count, 2);
  assert.ok(!items.some((p) => p.path === "projects/Rebrand/Rebrand.md"),
    "the folder note is the container, not a member");
  assert.deepEqual(items.map((p) => p.kind).sort(), ["canvas", "note"]);
});

test("what is inside a project counts links, resolved as links resolve", async () => {
  // The folder note's filename is not its title — a project called Kiln beside
  // an existing `notes/Kiln.md` is filed as `Kiln 2` — so `[[Kiln]]` is a name
  // nothing answers to, and `[[Firing]]` (the alias) and `[[Kiln 2]]` are the
  // two that do. Matching on `title:` had it exactly backwards.
  const d = await data({
    "notes/Kiln.md": serialize({
      id: "01KKKKKKKKKKKKKKKKKKKKKKKK", kind: "note", title: "Kiln kit",
      created: TS, updated: TS }, "the kiln itself, not the project"),
    "projects/Kiln 2/Kiln 2.md": serialize({
      id: "01PPPPPPPPPPPPPPPPPPPPPPPP", kind: "note", title: "Kiln",
      aliases: ["Firing"], created: TS, updated: TS }, "the folder note"),
    "projects/Kiln 2/Firing Log.md": serialize({
      id: "01LLLLLLLLLLLLLLLLLLLLLLLL", kind: "note", title: "Firing Log",
      created: TS, updated: TS }, "cone 6"),
    "notes/Cites Alias.md": serialize({
      id: "01AAAAAAAAAAAAAAAAAAAAAAAA", kind: "note", title: "Cites Alias",
      created: TS, updated: TS }, "for [[Firing]]"),
    "notes/Cites Filename.md": serialize({
      id: "01FFFFFFFFFFFFFFFFFFFFFFFF", kind: "note", title: "Cites Filename",
      created: TS, updated: TS }, "for [[Kiln 2]]"),
    "notes/Cites Title.md": serialize({
      id: "01TTTTTTTTTTTTTTTTTTTTTTTT", kind: "note", title: "Cites Title",
      created: TS, updated: TS }, "for [[Kiln]]"),
  });
  const { items } = await d.projects();
  const kiln = items.find((p) => p.name === "Kiln 2");
  assert.deepEqual(kiln.inside.map((p) => p.title).sort(),
    ["Cites Alias", "Cites Filename", "Firing Log"],
    "folder membership plus the pages that link to the note");
  assert.equal(kiln.memberCount, 3, "the count says what the list shows");
  assert.ok(!kiln.inside.some((p) => p.title === "Cites Title"),
    "[[Kiln]] resolves to notes/Kiln.md, not to this project — a title match "
    + "would have pulled a page about something else inside");
});

test("the vault catalog is not inside every project", async () => {
  // `index` lists the whole vault, so it mentions every project. Counting that
  // as membership put one row inside every project that was equally true of
  // all of them. The log and the plumbing say as little.
  const page = (id, title, body) => serialize(
    { id, kind: "note", title, created: TS, updated: TS }, body);
  const d = await data({
    "index.md": page("01IIIIIIIIIIIIIIIIIIIIIIII", "index", "[[Kiln]] and [[Bindery]]"),
    "log.md": page("01GGGGGGGGGGGGGGGGGGGGGGGG", "log", "worked on [[Kiln]] today"),
    "tags/firing.md": page("01SSSSSSSSSSSSSSSSSSSSSSSS", "firing", "see [[Kiln]]"),
    "CONVENTION.md": page("01CCCCCCCCCCCCCCCCCCCCCCCC", "CONVENTION", "e.g. [[Kiln]]"),
    "raw/clipping.md": page("01RRRRRRRRRRRRRRRRRRRRRRRR", "Clipping", "about [[Kiln]]"),
    "projects/Kiln/Kiln.md": page("01PPPPPPPPPPPPPPPPPPPPPPPP", "Kiln", "the folder note"),
    "projects/Kiln/Firing Log.md": page("01LLLLLLLLLLLLLLLLLLLLLLLL", "Firing Log", "cone 6"),
    // A project citing another project: kept, deliberately. isSystemEntry would
    // drop this row and still leave index.md in — wrong twice.
    "projects/Bindery/Bindery.md": page("01BBBBBBBBBBBBBBBBBBBBBBBB", "Bindery", "fires at [[Kiln]]"),
    "notes/Real Note.md": page("01NNNNNNNNNNNNNNNNNNNNNNNN", "Real Note", "booked [[Kiln]]"),
  });
  const { items } = await d.projects();
  const kiln = items.find((p) => p.name === "Kiln");
  assert.deepEqual(kiln.inside.map((p) => p.title).sort(),
    ["Bindery", "Firing Log", "Real Note"],
    "folder members, a real note, and the project that cites this one");
  assert.equal(kiln.memberCount, 3);
  for (const noise of ["index", "log", "firing", "CONVENTION", "Clipping"]) {
    assert.ok(!kiln.inside.some((p) => p.title === noise),
      `${noise} mentions every project, so it is evidence about none of them`);
  }
  // The catalog names Bindery too, and is inside that one no more than this.
  const bindery = items.find((p) => p.name === "Bindery");
  assert.deepEqual(bindery.inside.map((p) => p.title), [],
    "nothing but the catalog links to Bindery, so nothing is inside it");
});

test("two quick untitled creates do not overwrite each other", async () => {
  const d = await data();
  const a = await d.createPage({ kind: "note", project: "Rebrand" });
  const b = await d.createPage({ kind: "note", project: "Rebrand" });
  assert.notEqual(a.path, b.path);
  assert.equal(d.projectMembers("Rebrand").count, 2);
});

test("the round trip: a project-created drawing parses back byte-safe", async () => {
  const d = await data();
  const p = await d.createPage({ kind: "drawing", title: "W", project: "R" });
  const raw = await d.v.be.readText(p.path);
  const ex = parseExcalidraw(raw);
  assert.equal(ex.error, null);
  assert.equal(ex.compressed, true, "the default write is the plugin's default");
});
