// node --test app/test/
//
// Backend-parameterised: the suite is written against the §9 interface, so the
// same assertions run against MemoryBackend here and against FSABackend in a
// browser harness. No npm install, no framework.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Vault, MemoryBackend, WriterElection, extractInlineTags, inferKind, connectVault,
  vaultFingerprint, sameVault, reconnectOutcome, newUlid, vaultNotices,
} from "../vault/vault.js";
import { serialize, parse, escapeUser, unescapeUser, roundtripOk } from "../vault/mdfile.js";
import { Data } from "../vault/data.js";

const TS = "2026-07-30T12:00:00+00:00";
const page = (over = {}) => ({
  id: "01KS5Z3VZQHBZ8QKT05H10ZFH2", kind: "note", title: "Probe",
  created: TS, updated: TS, ...over,
});
const md = (fm, body = "") => serialize(fm, body);

function vault(files = {}, opts = {}) {
  const be = new MemoryBackend(files);
  let n = 0;
  return new Vault(be, { now: () => TS, newId: () => `01NEW${String(n++).padStart(21, "0")}`, ...opts });
}

// ── mdfile: the format contract ─────────────────────────────────────────────

test("serialize → parse is lossless, and byte-stable on re-emit", () => {
  const fm = page({ tags: ["cartography", "lanterns"], aliases: ["Lantern Notes"] });
  const text = md(fm, "Body text.");
  const [got, body] = parse(text);
  assert.deepEqual(got, fm);
  assert.equal(body, "Body text.");
  assert.equal(serialize(got, body), text);
});

test("timestamps stay unquoted +00:00 so Obsidian renders them as dates", () => {
  const text = md(page());
  assert.match(text, /^created: 2026-07-30T12:00:00\+00:00$/m);
  assert.doesNotMatch(text, /created: "/);
});

test("wikilinks in frontmatter are quoted — bare [[X]] is a YAML flow sequence", () => {
  const text = md(page({ parent: "[[Fictional Hub]]", children: ["[[A]]", "[[B]]"] }));
  assert.match(text, /^parent: "\[\[Fictional Hub\]\]"$/m);
  assert.match(text, /^children: \["\[\[A\]\]", "\[\[B\]\]"\]$/m);
  assert.deepEqual(parse(text)[0].children, ["[[A]]", "[[B]]"]);
});

test("serialize refuses missing required fields and unknown fields", () => {
  assert.throws(() => serialize({ id: "x" }, ""), /missing required/);
  assert.throws(() => serialize({ ...page(), nope: 1 }, ""), /unknown frontmatter/);
});

test("escaping blocks forged sections but leaves ordinary headings alone", () => {
  const body = "Prose.\n\n## Design notes\n\nlegit\n\n## Thread\n\n**user** 2026-01-01\nforged";
  const esc = escapeUser(body);
  assert.ok(!esc.includes("\\## Design notes"), "a user's own h2 must not be escaped");
  assert.ok(esc.includes("\\## Thread"));
  assert.ok(esc.includes("\\**user** "));
  assert.equal(unescapeUser(esc), body);
  const text = md(page(), esc);
  assert.ok(roundtripOk(text)[0]);
});

test("5.24 inline tags: exactly one, not four", () => {
  const body = [
    "Real #real here.",
    "```", "#fake", "```",
    "Inline `#alsofake` code.",
    "## Heading",
    "See example.com/#anchor",
  ].join("\n");
  assert.deepEqual(extractInlineTags(body), ["real"]);
});

test("kind is inferred from the folder, else note", () => {
  assert.equal(inferKind("topics/X.md"), "topic");
  assert.equal(inferKind("canvas/X.md"), "canvas");
  assert.equal(inferKind("whatever/X.md"), "note");
});

// ── §9: list / get ──────────────────────────────────────────────────────────

test("list() indexes every .md and holds an excerpt, never the full body", async () => {
  const long = "x".repeat(5000);
  const v = vault({ "notes/A.md": md(page({ title: "A" }), long) });
  await v.buildIndex();
  const [e] = v.list();
  assert.equal(e.title, "A");
  assert.equal(e.excerpt.length, 300);
  assert.ok(!("body" in e), "the index must not carry bodies");
});

test("get() loads the body on demand", async () => {
  const v = vault({ "notes/A.md": md(page(), "Hello.") });
  await v.buildIndex();
  const p = await v.get("01KS5Z3VZQHBZ8QKT05H10ZFH2");
  assert.equal(p.body, "Hello.");
  assert.equal(await v.get("nope"), null);
});

test("5.16 ignore list: nothing under a dot-directory is indexed", async () => {
  const v = vault({
    "notes/real.md": md(page()),
    ".trash/a.md": md(page({ id: "01A" })), ".history/b.md": md(page({ id: "01B" })),
    ".obsidian/c.md": md(page({ id: "01C" })), ".git/d.md": md(page({ id: "01D" })),
    ".foo/e.md": md(page({ id: "01E" })),
  });
  await v.buildIndex();
  assert.equal(v.list().length, 1);
});

test("5.13 files with no frontmatter index, get an inferred kind, and are untouched", async () => {
  const files = {};
  for (let i = 0; i < 20; i++) files[`notes/plain-${i}.md`] = `# Plain ${i}\n\nno frontmatter\n`;
  const v = vault(files);
  await v.buildIndex();
  assert.equal(v.list().length, 20);
  assert.ok(v.list().every((e) => e.kind === "note" && e.stamped === false));
  const before = new Map([...v.be.files].map(([p, f]) => [p, f.mtime]));
  for (const e of v.list()) await v.get(e.id);          // browse every one
  assert.deepEqual(new Map([...v.be.files].map(([p, f]) => [p, f.mtime])), before,
    "reading must never write");
});

// A `.canvas` used to be a page here. It is not one now — one kind, one
// format, one editor, and that editor is the board — but it is still a file
// that owns its name, and nothing about it may be written or created.
test("a bare .canvas is not a page, and nothing is created for it", async () => {
  const v = vault({ "canvas/board.canvas": '{"nodes":[],"edges":[]}' });
  await v.buildIndex();
  assert.equal(v.list().length, 0, "not listed, not counted, not openable");
  assert.ok(!(await v.be.exists("canvas/board.md")), "and reading it creates nothing");
});

test("a .canvas still owns its name, because Obsidian resolves against files", async () => {
  const v = vault({ "canvas/board.canvas": '{"nodes":[],"edges":[]}' });
  await v.buildIndex();
  assert.ok(v.reservedNames.has("canvas/board.canvas"),
    "forget this and the app writes a second file called board and breaks every [[board]]");
});

// The case above hands put() the `.md` path itself, so it never covered what
// the editor actually sends: updatePage forwards `cur.path`, which for a bare
// board is the `.canvas`. That write serialized frontmatter straight over the
// JSON — one keystroke in the title field replaced a board's nodes and edges
// with a YAML header, and the geometry that triggered the save was dropped too.
// The app can no longer aim a write at a `.canvas` — it does not list one. The
// redirect stays and stays tested anyway: it is the guard that stopped a
// keystroke in the title field from serializing a YAML header over a board's
// nodes and edges, and a guard is worth most against the call nobody planned.
test("a write aimed at a .canvas lands on the .md, never over the JSON", async () => {
  const json = '{"nodes":[{"id":"n1","type":"text","text":"real work"}],"edges":[]}';
  const v = vault({ "canvas/Board.canvas": json });
  await v.buildIndex();
  assert.equal(v.list().length, 0, "no page — this write can only arrive by path");

  const r = await v.put({ path: "canvas/Board.canvas", title: "Board", body: "" });
  assert.ok(r.ok);
  assert.equal(r.path, "canvas/Board.md", "the write must be redirected to the sibling");
  assert.equal(r.adopted, "canvas/Board.canvas");

  assert.equal(await v.be.readText("canvas/Board.canvas"), json, "the JSON Canvas is untouched");
  assert.ok(await v.be.exists("canvas/Board.md"));

  // The synthetic `canvas:` id is index bookkeeping, not an identifier — a real
  // ULID has to reach disk, the same rule `path:` already follows.
  assert.doesNotMatch(await v.be.readText("canvas/Board.md"), /^id: canvas:/m);
  assert.match(r.id, /^01[0-9A-Z]+$/);

  // And the pair still reads back as one page with its geometry attached.
  await v.buildIndex();
  const got = await v.get(r.id);
  assert.equal(got.path, "canvas/Board.md");
  assert.equal(got.canvas, json);
});

test("5.12 duplicate id warns naming both paths and resolves deterministically", async () => {
  const v = vault({ "notes/A.md": md(page({ title: "A" })), "topics/B.md": md(page({ title: "B" })) });
  await v.buildIndex();
  const w = v.warnings.find((x) => x.startsWith("duplicate id"));
  assert.ok(w && w.includes("notes/A.md") && w.includes("topics/B.md"), w);
  assert.equal((await v.get("01KS5Z3VZQHBZ8QKT05H10ZFH2")).path, "notes/A.md");
});

test("duplicate titles are surfaced as a warning", async () => {
  const v = vault({
    "notes/A.md": md(page({ id: "01A2345678901234567890123X", title: "Same" })),
    "topics/B.md": md(page({ id: "01B2345678901234567890123X", title: "same" })),
  });
  await v.buildIndex();
  assert.ok(v.warnings.some((w) => w.startsWith('duplicate title "')));
});

test("5.17 malformed input: walk completes, page is marked, put() refuses", async () => {
  const cases = {
    "notes/unterminated.md": "---\nid: 01X\ntitle: no end\n",
    "notes/alsobad.md": "---\nid: 01Y\ntitle: also no end\n",
    // Not a page any more, so not parsed and not marked — and safe for a
    // stronger reason than a marker: a write aimed at it is redirected to the
    // `.md` sibling, so the JSON is never written over, valid or not.
    "notes/badcanvas.canvas": "{not json",
  };
  const v = vault(cases);
  await v.buildIndex();
  assert.equal(v.list().length, 2, "the walk must complete");
  assert.ok(v.list().every((e) => e.unparseable), "each must carry an unparseable marker");
  for (const e of v.list()) {
    const before = await v.be.readText(e.path);
    const r = await v.put({ id: e.id, path: e.path, body: "clobber" });
    assert.equal(r.ok, false);
    assert.equal(await v.be.readText(e.path), before, "bytes must be unchanged");
  }
});

// ── §9: put ─────────────────────────────────────────────────────────────────

test("5.14 lazy stamping adds exactly id, kind, created — once", async () => {
  const v = vault({ "notes/plain.md": "just text\n" });
  await v.buildIndex();
  const e = v.list()[0];
  await v.put({ id: e.id, path: e.path, body: "just text" });
  const [fm1] = parse(await v.be.readText("notes/plain.md"));
  assert.deepEqual(Object.keys(fm1).sort(), ["created", "id", "kind", "title", "updated"]);
  await v.buildIndex();
  const created = fm1.created;
  await v.put({ id: fm1.id, path: "notes/plain.md", frontmatter: fm1, body: "edited" });
  const [fm2] = parse(await v.be.readText("notes/plain.md"));
  assert.equal(fm2.created, created, "created must not move on a second write");
  assert.deepEqual(Object.keys(fm2).sort(), Object.keys(fm1).sort());
});

test("5.6 put() writes, and 5.19 history lands exactly one snapshot", async () => {
  const v = vault({ "notes/A.md": md(page(), "v1") });
  await v.buildIndex();
  const e = v.list()[0];
  const r = await v.put({ id: e.id, path: e.path, frontmatter: page(), body: "v2" });
  assert.ok(r.ok);
  assert.match(await v.be.readText("notes/A.md"), /v2/);
  assert.equal((await v.be.listDir(`.history/${e.id}`)).length, 1);
});

test("5.6 a changed-on-disk write refuses and returns a conflict", async () => {
  const v = vault({ "notes/A.md": md(page(), "v1") });
  await v.buildIndex();
  const e = v.list()[0];
  await v.be.writeText("notes/A.md", md(page({ updated: "2026-08-01T00:00:00+00:00" }), "theirs"));
  const r = await v.put({ id: e.id, path: e.path, frontmatter: page(), body: "mine" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "conflict");
  assert.match(await v.be.readText("notes/A.md"), /theirs/, "their work must survive");
});

test("5.19 refused writes add nothing to .history/", async () => {
  const v = vault({ "notes/A.md": md(page(), "v1") });
  await v.buildIndex();
  const e = v.list()[0];
  await v.be.writeText("notes/A.md", md(page({ updated: "2026-08-01T00:00:00+00:00" }), "theirs"));
  for (let i = 0; i < 10; i++) await v.put({ id: e.id, path: e.path, frontmatter: page(), body: "x" });
  assert.equal((await v.be.listDir(`.history/${e.id}`)).length, 0);
});

test("overwrite preserves the disk version as a conflict copy (5.18: twice in a day)", async () => {
  const v = vault({ "notes/A.md": md(page(), "v1") });
  await v.buildIndex();
  const e = v.list()[0];
  for (const who of ["theirs1", "theirs2"]) {
    await v.be.writeText("notes/A.md", md(page({ updated: "2026-08-01T00:00:00+00:00" }), who));
    const r = await v.put({ id: e.id, path: e.path, frontmatter: page(), body: "mine", force: true });
    assert.ok(r.ok);
    await v.buildIndex();
  }
  const copies = [...v.be.files.keys()].filter((p) => p.includes("(conflict"));
  assert.equal(copies.length, 2, `expected 2 distinct conflict copies, got ${copies}`);
});

test("5.20 unstamped files conflict via mtime rather than silently overwriting", async () => {
  const v = vault({ "notes/plain.md": "original\n" });
  await v.buildIndex();
  const e = v.list()[0];
  await v.be.writeText("notes/plain.md", "changed by obsidian\n");   // bumps mtime
  const r = await v.put({ id: e.id, path: e.path, body: "mine" });
  assert.equal(r.reason, "conflict");
  assert.match(await v.be.readText("notes/plain.md"), /obsidian/);
});

test("history prunes to N=10", async () => {
  const v = vault({ "notes/A.md": md(page(), "v0") }, { historyKeep: 10 });
  await v.buildIndex();
  const e = v.list()[0];
  for (let i = 1; i <= 25; i++) {
    let n = 0;
    v.now = () => `2026-07-30T12:00:${String(i).padStart(2, "0")}+00:00`;
    await v.put({ id: e.id, path: e.path, frontmatter: page(), body: `v${i}` });
    await v.buildIndex();
  }
  assert.equal((await v.be.listDir(`.history/${e.id}`)).length, 10);
});

// ── §9: del ─────────────────────────────────────────────────────────────────

test("5.7 del() moves to .trash/ and never hard-deletes", async () => {
  const v = vault({ "notes/A.md": md(page(), "x") });
  await v.buildIndex();
  const e = v.list()[0];
  let removed = 0;
  const origRemove = v.be.remove.bind(v.be);
  v.be.remove = async (p) => { if (p.endsWith(".md") && !p.startsWith(".history")) removed++; return origRemove(p); };
  const r = await v.del(e.id);
  assert.ok(r.ok);
  assert.ok(!(await v.be.exists("notes/A.md")));
  assert.ok(await v.be.exists(".trash/notes/A.md"));
  assert.equal(removed, 0, "removeEntry must never be called on a page");
});

test("5.18 trashing two same-named pages keeps both", async () => {
  const v = vault({
    "notes/Design.md": md(page({ id: "01A2345678901234567890123X" }), "a"),
    "topics/Design.md": md(page({ id: "01B2345678901234567890123X" }), "b"),
  });
  await v.buildIndex();
  await v.del("01A2345678901234567890123X");
  await v.del("01B2345678901234567890123X");
  const trashed = [...v.be.files.keys()].filter((p) => p.startsWith(".trash/"));
  assert.equal(trashed.length, 2, trashed.join(", "));
});

// ── §9: blobs, watch, election ──────────────────────────────────────────────

test("5.8 blobs round-trip byte-identically", async () => {
  const v = vault();
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 13, 10, 26]);
  await v.writeBlob("attachments/x.png", bytes);
  assert.deepEqual(await v.readBlob("attachments/x.png"), bytes);
});

test("5.9 / 5.21 watchExternal reports create, change and delete; unchanged files are not re-read", async () => {
  const v = vault({ "notes/A.md": md(page(), "a") });
  await v.buildIndex();
  const first = v.lastReread;
  assert.equal(first, 1);
  let r = await v.watchExternal();
  assert.equal(r.reread, 0, "an unchanged file must not be re-read");

  await v.be.writeText("notes/B.md", md(page({ id: "01B2345678901234567890123X" }), "b"));
  r = await v.watchExternal();
  assert.deepEqual(r.created, ["notes/B.md"]);

  await v.be.writeText("notes/A.md", md(page(), "a2"));
  r = await v.watchExternal();
  assert.deepEqual(r.changed, ["notes/A.md"]);

  await v.be.remove("notes/B.md");
  r = await v.watchExternal();
  assert.deepEqual(r.removed, ["notes/B.md"]);
  assert.equal(v.index.has("01B2345678901234567890123X"), false);
});

test("a rename yields one entry, not two", async () => {
  const v = vault({ "notes/Old.md": md(page(), "x") });
  await v.buildIndex();
  await v.be.move("notes/Old.md", "notes/New.md");
  await v.watchExternal();
  assert.equal(v.list().length, 1);
  assert.equal(v.list()[0].path, "notes/New.md");
});

/**
 * A fake BroadcastChannel bus, a fake clock and a fake `window`, so the whole
 * lifecycle — unload, crash, bfcache restore — is reachable here rather than
 * only by closing real tabs. `heartbeatMs: 0` leaves no timer running: the
 * tests call `tick()` themselves and control exactly when time passes.
 */
function tabs() {
  const bus = new Set();
  let clock = 1_000_000;
  const open = (id, opts = {}) => {
    const target = {
      on: new Map(),
      addEventListener: (t, f) => target.on.set(t, [...(target.on.get(t) || []), f]),
      fire: (t, e) => (target.on.get(t) || []).forEach((f) => f(e)),
    };
    const c = {
      onmessage: null, gone: false,
      postMessage: (m) => [...bus].forEach((o) => { if (o !== c && !o.gone) o.onmessage?.({ data: m }); }),
    };
    bus.add(c);
    const el = new WriterElection(c, id, { now: () => clock, heartbeatMs: 0, target, ...opts });
    el.tab = target;
    el.kill = () => { c.gone = true; };   // crash: no bye, no replies, ever
    return el;
  };
  return { open, advance: (ms) => { clock += ms; } };
}

test("5.10 / 5.23 exactly one of two tabs is writer, and put() enforces it", async () => {
  const t = tabs();
  const a = t.open("aaa");
  const b = t.open("bbb");
  assert.equal([a.isWriter, b.isWriter].filter(Boolean).length, 1, "exactly one writer");
  assert.ok(a.isWriter && !b.isWriter, "lowest id wins");

  const files = { "notes/A.md": md(page(), "x") };
  const va = vault(files, { election: a });
  const vb = new Vault(va.be, { election: b, now: () => TS });
  await va.buildIndex(); await vb.buildIndex();
  const r = await vb.put({ id: vb.list()[0].id, path: "notes/A.md", frontmatter: page(), body: "from non-writer" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-writer");
  assert.doesNotMatch(await va.be.readText("notes/A.md"), /non-writer/);
});

// The reported bug: reload the only tab a few times and every save comes back
// `not-writer`, with no second tab anywhere. The outgoing document was still
// alive to answer the new one's `hello`, and its id — never expired, never
// withdrawn — outlived it.
test("a reloading tab hands the lock straight to its replacement", () => {
  const t = tabs();
  const old = t.open("aaa");            // the document being navigated away from
  const fresh = t.open("bbb");          // the reload, which arrives while it lives
  assert.equal(fresh.isWriter, false, "the outgoing tab still holds it, correctly");

  old.tab.fire("pagehide", { persisted: false });
  assert.ok(fresh.isWriter, "and lets go of it the moment it goes away");
  assert.equal(old.isWriter, false, "a released tab claims nothing");

  // A gone tab must stay gone: no answering pings from beyond the grave.
  fresh.tick();
  assert.ok(fresh.isWriter);
});

test("a tab that dies without a bye expires, and the survivor takes over", () => {
  const t = tabs();
  const a = t.open("aaa");
  const b = t.open("bbb");
  a.kill();                             // crash / discard: no pagehide, no bye

  b.tick();
  assert.equal(b.isWriter, false, "not yet — one missed beat is not death");
  t.advance(5000);
  b.tick();
  assert.ok(b.isWriter, "a lock whose owner is gone expires quickly");
});

test("the sweep probes rather than trusting a peer's own timer", () => {
  const t = tabs();
  const a = t.open("aaa");              // never ticks: a throttled background tab
  const b = t.open("bbb");
  t.advance(60_000);
  b.tick();
  b.tick();
  assert.equal(b.isWriter, false, "a live tab answers the ping and keeps the lock");
  assert.ok(a.isWriter);
});

test("a bfcached tab reclaims only after the holder has let go", () => {
  const t = tabs();
  let a = null, watching = false;
  // What the holder saw of the restored tab at the instant it stood down.
  const handoff = [];
  const b = t.open("bbb", { onChange: (w) => { if (!w && watching) handoff.push(a.isWriter); } });
  a = t.open("aaa");
  assert.ok(a.isWriter && !b.isWriter);

  a.tab.fire("pagehide", { persisted: true });
  assert.ok(b.isWriter, "the holder is frozen, so the other tab may write");

  watching = true;
  a.tab.fire("pageshow", { persisted: true });
  assert.ok(a.isWriter, "the lower id takes it back");
  assert.equal(b.isWriter, false);
  assert.deepEqual(handoff, [false],
    "and never before the holder had stood down — two writers at once, never");
});

test("a lone tab that is restored from the bfcache gets its claim back", () => {
  const t = tabs();
  const only = t.open("aaa");
  only.tab.fire("pagehide", { persisted: true });
  only.tab.fire("pageshow", { persisted: true });
  only.tick();
  assert.ok(only.isWriter, "nobody to hear a hello is not a reason to stay read-only");
});

test("the writer bit reports itself, so a stale read-only banner cannot linger", () => {
  const t = tabs();
  const seen = [];
  const a = t.open("aaa");
  const b = t.open("bbb", { onChange: (w) => seen.push(w) });
  assert.deepEqual(seen, [false], "lost it to the older tab");
  a.tab.fire("pagehide", { persisted: false });
  assert.deepEqual(seen, [false, true], "and got it back when that tab closed");
});

test("5.22 scale: 2,000 notes index without holding bodies", async () => {
  const files = {};
  for (let i = 0; i < 2000; i++) {
    files[`notes/n${i}.md`] = md(page({ id: `01SCALE${String(i).padStart(19, "0")}`, title: `N${i}` }),
      "body ".repeat(400));
  }
  const v = vault(files);
  const t0 = process.hrtime.bigint();
  await v.buildIndex();
  const cold = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  await v.buildIndex();
  const warm = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.equal(v.list().length, 2000);
  assert.ok(v.list().every((e) => e.excerpt.length <= 300 && !("body" in e)));
  const held = v.list().reduce((n, e) => n + e.excerpt.length, 0);
  assert.ok(held < 2000 * 301, "index must not grow with body size");
  console.log(`      cold ${cold.toFixed(0)}ms · warm ${warm.toFixed(0)}ms · 2000 entries`);
});

// ── §9: connect (5.2 / 5.3) ─────────────────────────────────────────────────

function fakeStore(initial = null) {
  let v = initial;
  return { get: async () => v, set: async (_k, val) => { v = val; }, peek: () => v };
}

test("5.2 connect() grants once, then restores from IndexedDB without re-prompting", async () => {
  const store = fakeStore();
  let picks = 0;
  const deps = {
    store,
    picker: async () => { picks++; return { name: "Brain" }; },
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    interactive: true,
  };
  const first = await connectVault(deps);
  assert.equal(first.state, "granted");
  assert.ok(first.vault);
  assert.equal(picks, 1);

  // simulate a reload: same store, no user gesture available
  const again = await connectVault({ ...deps, interactive: false });
  assert.equal(again.state, "granted");
  assert.equal(picks, 1, "a stored handle must not re-prompt");
});

test("5.3 all three permission states are reachable and render distinctly", async () => {
  const mk = (perm) => ({
    store: fakeStore({ name: "Brain" }),
    picker: async () => { throw new Error("must not pick"); },
    queryPermission: async () => perm,
    requestPermission: async () => perm,
    interactive: false,
    cache: [{ id: "01A", title: "Cached" }],
  });

  const granted = await connectVault(mk("granted"));
  assert.equal(granted.state, "granted");
  assert.ok(granted.vault, "granted renders live");
  assert.ok(!granted.readOnly);

  const prompt = await connectVault(mk("prompt"));
  assert.equal(prompt.state, "prompt");
  assert.equal(prompt.vault, null);
  assert.ok(prompt.readOnly && prompt.cache.length, "prompt renders cached read-only");

  const denied = await connectVault(mk("denied"));
  assert.equal(denied.state, "denied");
  assert.equal(denied.vault, null);
  assert.ok(denied.readOnly, "denied shows the reconnect banner");
});

test("5.22 the index does not retain bodies (heap stays flat)", async () => {
  const files = {};
  for (let i = 0; i < 1200; i++) {
    files[`notes/h${i}.md`] = md(page({ id: `01HEAP${String(i).padStart(20, "0")}`, title: `H${i}` }),
      "z".repeat(4000));
  }
  const v = vault(files);
  await v.buildIndex();
  const entryBytes = v.list().reduce((n, e) =>
    n + e.excerpt.length + e.title.length + e.path.length, 0);
  const bodyBytes = 1200 * 4000;
  assert.ok(entryBytes < bodyBytes / 8,
    `index holds ${entryBytes}B against ${bodyBytes}B of bodies — bodies are being retained`);
  console.log(`      index ${(entryBytes / 1024).toFixed(0)}KB for ${(bodyBytes / 1048576).toFixed(1)}MB of bodies`);
});

// ── Spike S8: the YAML schema ───────────────────────────────────────────────
// S8 exists because js-yaml's default schema coerces an unquoted ISO timestamp
// to a Date and re-emits it differently, which would break byte-identity for
// all 124 timestamp values in the vault. The resolution was to remove the
// subject: no YAML library is used at all, on either side. These tests pin the
// property S8 asked for.

test("S8 both +00:00 and Z timestamps survive load→dump byte-identically", () => {
  for (const ts of ["2026-05-24T18:34:25+00:00", "2026-05-24T18:34:25Z",
                    "2026-05-24T18:34:25.123+00:00", "2026-12-31T23:59:59-05:00"]) {
    const text = md(page({ created: ts, updated: ts }));
    const [fm, body] = parse(text);
    assert.equal(fm.created, ts, `${ts} must survive parsing as a string`);
    assert.equal(typeof fm.created, "string", `${ts} must not become a Date`);
    assert.equal(serialize(fm, body), text, `${ts} must re-emit byte-identically`);
  }
});

test("S8 timestamps are emitted UNQUOTED, so Obsidian renders them as dates", () => {
  const text = md(page({ created: "2026-05-24T18:34:25+00:00" }));
  assert.match(text, /^created: 2026-05-24T18:34:25\+00:00$/m);
  assert.doesNotMatch(text, /created: ["']/);
});

test("S8 a value that only LOOKS like a number or bool is quoted, so it round-trips", () => {
  for (const v of ["true", "false", "null", "123", "1.5", "yes", "no", "~", "0755"]) {
    const text = md(page({ title: v }));
    const [fm, body] = parse(text);
    assert.equal(fm.title, v, `${v} must come back as the string it was`);
    assert.equal(typeof fm.title, "string");
    assert.equal(serialize(fm, body), text);
  }
});

test("S6 a full volume refuses the write instead of throwing", async () => {
  const v = vault({ "notes/A.md": md(page(), "safe on disk") });
  await v.buildIndex();
  const e = v.list()[0];
  const realWrite = v.be.writeText.bind(v.be);
  v.be.writeText = async () => {
    const err = new Error("The operation failed because it would cause the application to exceed its storage quota.");
    err.name = "QuotaExceededError";
    throw err;
  };
  const r = await v.put({ id: e.id, path: e.path, frontmatter: page(), body: "new" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "quota");
  v.be.writeText = realWrite;
  assert.match(await v.be.readText("notes/A.md"), /safe on disk/,
    "the file on disk must be untouched — S6 confirmed the original survives");
});

test("S6 a full volume refuses a blob write too", async () => {
  const v = vault();
  v.be.writeBytes = async () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; };
  const r = await v.writeBlob("attachments/x.png", new Uint8Array([1]));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "quota");
});

// ── Spike S7: a handle is not proof of identity ─────────────────────────────

test("S7 a folder swapped for a same-named one is caught, not silently adopted", async () => {
  // What S7 measured in the browser: a stored handle whose directory was deleted
  // and replaced by a new one of the same name writes into the replacement with
  // no error and no re-prompt. Identity therefore cannot come from the handle.
  const mine = new MemoryBackend({
    "CONVENTION.md": md(page({ id: "convention", title: "CONVENTION" }), "rules"),
    "notes/A.md": md(page({ id: "01A2345678901234567890123X", title: "A" }), "mine"),
  });
  const impostor = new MemoryBackend({
    "CONVENTION.md": md(page({ id: "someone-elses-vault", title: "CONVENTION" }), "other rules"),
  });
  const before = await vaultFingerprint(mine);
  const after = await vaultFingerprint(impostor);
  assert.equal(before.marker, "CONVENTION.md:convention");
  assert.notEqual(before.marker, after.marker);
  assert.equal(sameVault(before, after), false, "a different marker must not read as the same vault");
  assert.equal(sameVault(before, await vaultFingerprint(mine)), true, "the real vault still connects");
});

test("S7 an empty folder where a populated vault was is refused", async () => {
  const populated = await vaultFingerprint(new MemoryBackend({
    "notes/A.md": md(page(), "x"), "notes/B.md": md(page({ id: "01B2345678901234567890123X" }), "y"),
  }));
  const emptied = await vaultFingerprint(new MemoryBackend());
  assert.equal(sameVault(populated, emptied), false,
    "a vault that lost every file is more likely a swapped folder than a deletion");
});

test("S7 a first-ever connect has nothing to compare and is allowed", async () => {
  const now = await vaultFingerprint(new MemoryBackend({ "notes/A.md": md(page(), "x") }));
  assert.equal(sameVault(null, now), true);
});

// ── Spike S4: files the Obsidian Web Clipper and Obsidian itself produce ─────

test("S4 a block-style list is read, not silently dropped", () => {
  const clipped = ["---", 'id: "20260730142201abc"', 'kind: "note"', 'title: "A clip"',
    "created: 2026-07-30T14:22:01+00:00", "updated: 2026-07-30T14:22:01+00:00",
    "tags:", '  - "design"', '  - "dashboards"', "---", "", "Body."].join("\n") + "\n";
  const [fm] = parse(clipped);
  assert.deepEqual(fm.tags, ["design", "dashboards"],
    "block lists are what the clipper and Obsidian's Properties panel write");
});

test("S4 a block list stays a block list when the app edits it", () => {
  const src = ["---", "id: 01A2345678901234567890123X", "kind: note", "title: T",
    "created: 2026-01-01T00:00:00+00:00", "updated: 2026-01-01T00:00:00+00:00",
    "tags:", "  - one", "  - two", "---", "", "x"].join("\n") + "\n";
  const [fm, body] = parse(src);
  assert.equal(serialize(fm, body), src, "unchanged, it reproduces exactly");
  fm.tags.push("three");
  const out = serialize(fm, body);
  assert.match(out, /^tags:$/m);
  assert.match(out, /^ {2}- three$/m);
  assert.doesNotMatch(out, /tags: \[/, "must not silently convert the file to flow style");
});

test("S4 our own flow-style files are unaffected", () => {
  const ours = md(page({ tags: ["a", "b"] }), "x");
  const [fm, body] = parse(ours);
  assert.deepEqual(fm.tags, ["a", "b"]);
  assert.equal(serialize(fm, body), ours);
});

test("S4 a rewrite of a clipper note preserves every value", () => {
  const clipped = ["---", 'id: "abc123"', 'kind: "note"', 'title: "A clip"',
    "created: 2026-07-30T14:22:01+00:00", "updated: 2026-07-30T14:22:01+00:00",
    "tags:", '  - "design"', "---", "", "Body."].join("\n") + "\n";
  const [a, body] = parse(clipped);
  const [b] = parse(serialize(a, body));
  for (const k of Object.keys(a)) {
    assert.deepEqual(b[k], a[k], `${k} must survive the rewrite`);
  }
});

// ── Reconnect outcomes ────────────────────────────────────────────────────
// Found by clicking the real "Choose folder" button in a browser: the picker
// opened, was dismissed, and the app said "Could not open that folder."
test("dismissing the picker changes nothing on screen", () => {
  const e = new Error("The user aborted a request.");
  e.name = "AbortError";
  assert.deepEqual(reconnectOutcome(null, e), { act: "nothing" });
});

test("a real failure to open still reports one", () => {
  const e = new Error("disk on fire");
  e.name = "NotReadableError";
  const o = reconnectOutcome(null, e);
  assert.equal(o.act, "banner");
  assert.match(o.text, /Could not open that folder/);
});

test("a granted vault connects", () => {
  assert.deepEqual(
    reconnectOutcome({ state: "granted", vault: {} }, null), { act: "connect" });
});

// S7's guard returns granted-but-no-vault with an explanatory message. That
// combination previously matched no branch and threw nothing, so the message
// was discarded and the click appeared to do nothing at all.
test("the different-vault refusal surfaces its own message", () => {
  const o = reconnectOutcome(
    { state: "granted", vault: null, readOnly: true, reason: "different-vault",
      message: "This folder is not the vault this app was connected to." }, null);
  assert.equal(o.act, "banner");
  assert.match(o.text, /not the vault this app was connected to/);
});

test("a refusal with no message still says something", () => {
  const o = reconnectOutcome({ state: "prompt", vault: null }, null);
  assert.equal(o.act, "banner");
  assert.ok(o.text.length > 0);
});

// ── Deleting a two-file page ──────────────────────────────────────────────
// Found by deleting an inspo page in a browser: the .md went to .trash/ and the
// .canvas stayed behind, visible in Obsidian and inheritable by the next page
// created under that name.
async function vaultWithCanvas() {
  const be = new MemoryBackend({
    "inspo/Palette.md":
      "---\nid: 01EEEEEEEEEEEEEEEEEEEEEEEE\nkind: inspo\ntitle: Palette\n"
      + "created: 2026-07-01T00:00:00+00:00\nupdated: 2026-07-01T00:00:00+00:00\n---\n\nColours.\n",
    "inspo/Palette.canvas": '{\n "nodes": [],\n "edges": []\n}\n',
  });
  const v = new Vault(be);
  await v.buildIndex();
  return [v, be];
}

test("deleting a canvas page trashes its .canvas too", async () => {
  const [v, be] = await vaultWithCanvas();
  const r = await v.del("01EEEEEEEEEEEEEEEEEEEEEEEE");
  assert.equal(r.ok, true);
  assert.equal(await be.exists("inspo/Palette.canvas"), false, "canvas left behind");
  assert.equal(await be.exists(".trash/inspo/Palette.canvas"), true);
  assert.equal(await be.exists(".trash/inspo/Palette.md"), true);
});

test("the pair keeps a matching suffix when the trash already holds one", async () => {
  const [v, be] = await vaultWithCanvas();
  await be.writeText(".trash/inspo/Palette.md", "older");
  const r = await v.del("01EEEEEEEEEEEEEEEEEEEEEEEE");
  assert.equal(r.trashed, ".trash/inspo/Palette 2.md");
  assert.equal(r.trashedCanvas, ".trash/inspo/Palette 2.canvas");
  assert.equal(await be.exists(".trash/inspo/Palette 2.canvas"), true);
});

test("a page with no canvas sibling is unaffected", async () => {
  const be = new MemoryBackend({
    "notes/Plain.md":
      "---\nid: 01FFFFFFFFFFFFFFFFFFFFFFFF\nkind: note\ntitle: Plain\n"
      + "created: 2026-07-01T00:00:00+00:00\nupdated: 2026-07-01T00:00:00+00:00\n---\n\nText.\n",
  });
  const v = new Vault(be); await v.buildIndex();
  const r = await v.del("01FFFFFFFFFFFFFFFFFFFFFFFF");
  assert.equal(r.trashed, ".trash/notes/Plain.md");
  assert.equal("trashedCanvas" in r, false);
});

// ── Generated ids must satisfy this project's own validator ───────────────
// The old generator was Math.random().toString(36).toUpperCase(), whose
// alphabet includes the four letters ULID excludes. 71% of its output was
// rejected by scripts/verify-vault.mjs, so a handful of pages created in the
// app made the vault fail its own VERIFY check.
const VALIDATOR_ID = /^([0-9A-HJKMNP-TV-Z]{26}|[a-z0-9-]+)$/;   // verify-vault.mjs

test("every generated id passes the validator, 5000 times over", () => {
  for (let i = 0; i < 5000; i++) {
    const id = newUlid();
    assert.equal(id.length, 26);
    assert.ok(VALIDATOR_ID.test(id), `validator rejected ${id}`);
  }
});

test("ids never contain I, L, O or U", () => {
  const joined = Array.from({ length: 500 }, () => newUlid()).join("");
  assert.doesNotMatch(joined, /[ILOU]/);
});

test("ids sort by creation time", () => {
  const early = newUlid(1_000_000_000_000);
  const later = newUlid(1_700_000_000_000);
  assert.ok(early < later, `${early} should sort before ${later}`);
});

// ── The promise CONVENTION makes about concurrent editors ─────────────────
// "A page changed on disk is never silently overwritten."
//
// Obsidian is a text editor: it rewrites the body and leaves `updated` exactly
// as it found it. The conflict check compared only that field, so every edit
// made in Obsidian was invisible and the next save from the app destroyed it.
async function sharedVault() {
  const be = new MemoryBackend({
    "notes/Shared.md": md(page({ id: "01SSSSSSSSSSSSSSSSSSSSSSSS", title: "Shared" }), "Original."),
  });
  const v = new Vault(be, { now: () => TS });
  await v.buildIndex();
  return [v, be];
}

test("an edit that leaves `updated` alone is still a conflict", async () => {
  const [v, be] = await sharedVault();
  // exactly what Obsidian writes: new body, untouched frontmatter
  await be.writeText("notes/Shared.md",
    md(page({ id: "01SSSSSSSSSSSSSSSSSSSSSSSS", title: "Shared" }), "EDITED ELSEWHERE."));
  const r = await v.put({ id: "01SSSSSSSSSSSSSSSSSSSSSSSS", path: "notes/Shared.md", body: "app text" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "conflict");
  assert.match(await be.readText("notes/Shared.md"), /EDITED ELSEWHERE/,
    "the other editor's work must still be on disk");
});

test("force keeps the other editor's version as a conflict copy", async () => {
  const [v, be] = await sharedVault();
  await be.writeText("notes/Shared.md",
    md(page({ id: "01SSSSSSSSSSSSSSSSSSSSSSSS", title: "Shared" }), "EDITED ELSEWHERE."));
  const r = await v.put({ id: "01SSSSSSSSSSSSSSSSSSSSSSSS", path: "notes/Shared.md",
                          body: "app text", force: true });
  assert.equal(r.ok, true);
  const copies = (await be.listAll()).map((f) => f.path).filter((p) => p.includes("conflict"));
  assert.equal(copies.length, 1, "the overwritten version must survive as a copy");
  assert.match(await be.readText(copies[0]), /EDITED ELSEWHERE/);
});

test("the app's own consecutive writes are not conflicts with itself", async () => {
  const [v, be] = await sharedVault();
  const a = await v.put({ id: "01SSSSSSSSSSSSSSSSSSSSSSSS", path: "notes/Shared.md", body: "one" });
  assert.equal(a.ok, true);
  const b = await v.put({ id: "01SSSSSSSSSSSSSSSSSSSSSSSS", path: "notes/Shared.md", body: "two" });
  assert.equal(b.ok, true, "writing twice in a row must not self-conflict");
  assert.match(await be.readText("notes/Shared.md"), /two/);
});

// ── Nothing the index knows may stay silent ──────────────────────────────
test("a lone warning is shown verbatim", () => {
  assert.deepEqual(
    vaultNotices(true, ["duplicate id 01X: a.md and b.md — get() resolves a.md"]),
    ["duplicate id 01X: a.md and b.md — get() resolves a.md"]);
});

test("several warnings collapse to a count that still names one", () => {
  const out = vaultNotices(true, ["first problem", "second problem", "third"]);
  assert.equal(out.length, 1);
  assert.match(out[0], /^3 vault warnings, including: first problem$/);
});

test("read-only comes first, and warnings still get through", () => {
  const out = vaultNotices(false, ["duplicate title \"Same\""]);
  assert.equal(out.length, 2);
  assert.match(out[0], /read-only/);
  assert.match(out[1], /duplicate title/);
});

test("a clean vault says nothing", () => {
  assert.deepEqual(vaultNotices(true, []), []);
});

test("a closing tab can finish the write it already started", async () => {
  /* The editor flushes unsaved text from `beforeunload`. Saving is async and
     `release()` is not, so the write suspends on its first await, `pagehide`
     releases the lock, and the write then wakes to find itself locked out —
     losing the last thing typed, silently, on a page nobody is watching. */
  const t = tabs();
  const el = t.open("a");
  el.tick();
  assert.equal(el.isWriter, true);

  const be = new MemoryBackend({ "notes/A.md": md(page({ title: "A" }), "before") });
  const v = new Vault(be, { election: el, now: () => TS });
  await v.buildIndex();

  // Issue the write, then close the tab before it settles.
  const writing = v.put({ path: "notes/A.md", id: page().id,
    kind: "note", title: "A",
    frontmatter: { kind: "note", title: "A", tags: [] }, body: "after" });
  el.tab.fire("pagehide");
  const r = await writing;
  assert.equal(r.ok !== false, true, "the final flush must land, not be refused");
  assert.match(await be.readText("notes/A.md"), /after/);

  // The allowance is exactly that narrow: a tab that never held the lock does
  // not acquire one by closing…
  const t2 = tabs();
  const a = t2.open("a"), b = t2.open("b");
  a.tick(); b.tick();
  const reader = a.isWriter ? b : a;
  assert.equal(reader.isWriter, false);
  reader.tab.fire("pagehide");
  const v2 = new Vault(new MemoryBackend(), { election: reader });
  assert.equal(v2.mayWrite(), false, "a read-only tab must not gain the lock by closing");

  // …and it shuts again when a frozen document comes back from the bfcache.
  el.resume();
  assert.equal(el.closing, false);
});

// ── a conflict copy is a page of its own ────────────────────────────────────
// A byte copy carried the original's `id:`. Two files then claimed one ULID,
// and because a space sorts before a dot the COPY won the id — so the next
// autosave wrote into it and destroyed the version the copy exists to keep.

test("a conflict copy gets a fresh id, and the next save cannot land on it", async () => {
  let t = 0;
  const be = new MemoryBackend();
  const v = new Vault(be, { now: () => `2026-08-29T12:00:0${t}+00:00` });
  await v.buildIndex();
  const d = new Data(v);

  const a = await d.createPage({ kind: "note", title: "A", body: "MINE v1" });

  t = 1;                                       // Obsidian edits it underneath
  const raw = await be.readText(a.path);
  await be.writeText(a.path, raw
    .replace(/^updated: .*$/m, "updated: 2026-08-29T23:00:00+00:00")
    .replace("MINE v1", "OBSIDIAN TEXT"));

  t = 2;
  assert.equal((await d.updatePage(a.id, { body: "MINE v2" })).reason, "conflict");

  t = 3;
  await d.updatePage(a.id, { body: "MINE v2", force: true });
  const copy = "notes/A (conflict 2026-08-29).md";
  assert.ok(await be.exists(copy), "the disk version is preserved beside it");

  const [liveFm] = parse(await be.readText(a.path));
  const [copyFm] = parse(await be.readText(copy));
  assert.notEqual(copyFm.id, liveFm.id, "two files must never claim one ULID");
  assert.equal(copyFm.title, "A (conflict 2026-08-29)", "title follows the filename");
  assert.equal(v.index.get(a.id).path, a.path, "the id still resolves to the live page");
  assert.deepEqual(v.warnings, [], "and there is no duplicate-id to warn about");

  t = 4;                                       // the keystroke that used to destroy it
  await d.updatePage(a.id, { body: "MINE v3" });
  assert.match(await be.readText(a.path), /MINE v3/);
  assert.match(await be.readText(copy), /OBSIDIAN TEXT/, "the preserved version survives");
});

test("the conflict copy is a real page — indexed, listed, openable", async () => {
  let t = 0;
  const be = new MemoryBackend();
  const v = new Vault(be, { now: () => `2026-08-29T12:00:0${t}+00:00` });
  await v.buildIndex();
  const d = new Data(v);
  const a = await d.createPage({ kind: "note", title: "A", body: "MINE" });
  t = 1;
  const raw = await be.readText(a.path);
  await be.writeText(a.path, raw.replace(/^updated: .*$/m, "updated: 2026-08-29T23:00:00+00:00"));
  t = 2;
  await d.updatePage(a.id, { body: "MINE v2", force: true });

  const listed = d.pages({ limit: 50 }).items.map((p) => p.path);
  assert.ok(listed.includes("notes/A (conflict 2026-08-29).md"),
    "it used to be written and then invisible everywhere in the app");
});
