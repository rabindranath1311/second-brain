// FSABackend, exercised.
//
// Every write-safety test in this suite ran against MemoryBackend, and
// MemoryBackend is a flat Map keyed by path — it has no directories, so it
// cannot disagree with anything. FSABackend is the only backend that ever
// touches a user's folder, and it was never run at all. That gap is not
// incidental: it is why `listDir` could return `[]` for every question anyone
// asks it, in the shipping build, with the suite green.
//
// So: a fake File System Access directory handle, faithful in the ways that
// have already bitten us — real nested directories, dot-directories that exist
// and can be walked, `removeEntry` that returns a promise and can reject.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FSABackend, MemoryBackend, Vault } from "../vault/vault.js";
import { Data } from "../vault/data.js";

// ── a fake directory handle ─────────────────────────────────────────────────
function dirHandle(name = "") {
  const children = new Map();          // name -> handle
  return {
    kind: "directory", name, children,
    async getDirectoryHandle(n, opts = {}) {
      let h = children.get(n);
      if (!h) {
        if (!opts.create) { const e = new Error(`NotFound: ${n}`); e.name = "NotFoundError"; throw e; }
        h = dirHandle(n); children.set(n, h);
      }
      if (h.kind !== "directory") throw new Error(`not a directory: ${n}`);
      return h;
    },
    async getFileHandle(n, opts = {}) {
      let h = children.get(n);
      if (!h) {
        if (!opts.create) { const e = new Error(`NotFound: ${n}`); e.name = "NotFoundError"; throw e; }
        h = fileHandle(n); children.set(n, h);
      }
      if (h.kind !== "file") throw new Error(`not a file: ${n}`);
      return h;
    },
    async removeEntry(n) {
      if (!children.has(n)) { const e = new Error(`NotFound: ${n}`); e.name = "NotFoundError"; throw e; }
      children.delete(n);
    },
    async *entries() { for (const [k, v] of [...children]) yield [k, v]; },
  };
}

let clock = 1;
function fileHandle(name) {
  let data = new Uint8Array();
  let mtime = clock++;
  return {
    kind: "file", name,
    async getFile() {
      const bytes = data;
      return {
        lastModified: mtime, size: bytes.length,
        async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
      };
    },
    async createWritable() {
      let buf = new Uint8Array();
      return {
        async write(b) { buf = b instanceof Uint8Array ? b : new Uint8Array(b); },
        async close() { data = buf; mtime = clock++; },
      };
    },
  };
}

const fsa = () => new FSABackend(dirHandle());

// ── the bug this file exists for ────────────────────────────────────────────

test("listDir sees inside a dot-directory — the only kind anyone asks about", async () => {
  const be = fsa();
  await be.writeText(".history/01ABC/2026-08-29T10-00-00+00-00.md", "one");
  await be.writeText(".history/01ABC/2026-08-29T10-00-01+00-00.md", "two");
  await be.writeText("notes/Elsewhere.md", "unrelated");

  const got = await be.listDir(".history/01ABC");
  assert.deepEqual(got, [
    ".history/01ABC/2026-08-29T10-00-00+00-00.md",
    ".history/01ABC/2026-08-29T10-00-01+00-00.md",
  ]);
});

test("listDir recurses, and matches MemoryBackend on the same tree", async () => {
  const files = {
    ".trash/notes/A.md": "a",
    ".trash/topics/B.md": "b",
    "notes/Kept.md": "k",
  };
  const mem = new MemoryBackend(files);
  const be = fsa();
  for (const [p, t] of Object.entries(files)) await be.writeText(p, t);

  const a = (await be.listDir(".trash")).sort();
  const b = (await mem.listDir(".trash")).sort();
  assert.deepEqual(a, b, "the two backends must answer the same question the same way");
  assert.deepEqual(a, [".trash/notes/A.md", ".trash/topics/B.md"]);
});

test("listDir on a directory that does not exist is empty, not a throw", async () => {
  assert.deepEqual(await fsa().listDir(".history/nobody"), []);
});

test("listAll still skips dot-directories — that walk builds the index", async () => {
  const be = fsa();
  await be.writeText(".history/01ABC/snap.md", "x");
  await be.writeText(".trash/notes/Gone.md", "x");
  await be.writeText("notes/Real.md", "x");
  assert.deepEqual((await be.listAll()).map((f) => f.path), ["notes/Real.md"]);
});

// ── version history, end to end, on the backend that ships ──────────────────

test("version history is not empty on an FSA vault, and prunes to historyKeep", async () => {
  const v = new Vault(fsa(), { historyKeep: 3 });
  await v.buildIndex();
  const d = new Data(v);

  const p = await d.createPage({ kind: "note", title: "Kept", body: "v1" });
  for (let i = 2; i <= 6; i++) await d.updatePage(p.id, { body: "v" + i });

  const snaps = await d.pageHistory(p.id);
  assert.ok(snaps.length > 0, "history must not be empty — it was [] for every real vault");
  assert.ok(snaps.length <= 3, `pruning must run: kept ${snaps.length}, cap is 3`);

  const read = await d.readSnapshot(snaps[0].path);
  assert.ok(read.ok, "a snapshot must be readable back");
});

// ── the other half: a delete that fails must not report success ─────────────

test("remove and move await removeEntry, so a failed delete is not a silent success", async () => {
  const be = fsa();
  await be.writeText("notes/A.md", "a");
  await be.remove("notes/A.md");
  assert.equal(await be.exists("notes/A.md"), false);

  await assert.rejects(() => be.remove("notes/Missing.md"),
    "a removal that cannot happen must reject, not resolve");

  await be.writeText("notes/B.md", "b");
  await be.move("notes/B.md", ".trash/notes/B.md");
  assert.equal(await be.exists("notes/B.md"), false, "the source must be gone after a move");
  assert.equal(await be.readText(".trash/notes/B.md"), "b");
});

// ── one snapshot per write, not per second ──────────────────────────────────
// The editor autosaves on a 600ms debounce and `now()` is second-resolution
// (CONVENTION pins `updated:` to that form), so saves routinely shared a
// filename and the later one overwrote the earlier snapshot. Seven overwrites
// left one version, under a setting that promises N.

test("every write gets its own snapshot, even within one second", async () => {
  const v = new Vault(fsa(), { historyKeep: 10, now: () => "2026-08-29T09:00:00+00:00" });
  await v.buildIndex();
  const d = new Data(v);
  const p = await d.createPage({ kind: "note", title: "H", body: "v1" });
  for (let i = 2; i <= 8; i++) await d.updatePage(p.id, { body: "v" + i });

  const snaps = await d.pageHistory(p.id);
  assert.equal(snaps.length, 7, "7 overwrites must leave 7 snapshots, not 1");
  const bodies = [];
  for (const s of snaps) bodies.push((await d.readSnapshot(s.path)).body.trim());
  assert.deepEqual(bodies, ["v7", "v6", "v5", "v4", "v3", "v2", "v1"], "newest first");
});

test("pruning drops the OLDEST, and a pruned name is never reused", async () => {
  const v = new Vault(fsa(), { historyKeep: 3, now: () => "2026-08-29T09:00:00+00:00" });
  await v.buildIndex();
  const d = new Data(v);
  const p = await d.createPage({ kind: "note", title: "H", body: "v1" });
  for (let i = 2; i <= 8; i++) await d.updatePage(p.id, { body: "v" + i });

  const snaps = await d.pageHistory(p.id);
  assert.equal(snaps.length, 3);
  const bodies = [];
  for (const s of snaps) bodies.push((await d.readSnapshot(s.path)).body.trim());
  assert.deepEqual(bodies, ["v7", "v6", "v5"], "the newest three survive, not the oldest three");
});

test("the ~N that disambiguates a second is not shown to the reader", async () => {
  const v = new Vault(fsa(), { historyKeep: 10, now: () => "2026-08-29T09:00:00+00:00" });
  await v.buildIndex();
  const d = new Data(v);
  const p = await d.createPage({ kind: "note", title: "H", body: "v1" });
  await d.updatePage(p.id, { body: "v2" });
  await d.updatePage(p.id, { body: "v3" });
  for (const s of await d.pageHistory(p.id)) {
    assert.equal(s.stamp, "2026-08-29T09-00-00+00-00", "the stamp is a time, not a filename");
  }
});
