// The clipper's structural promises — the ones no unit test of its logic would
// catch, because they are about what the extension *is* rather than what it
// computes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { survey, orphans, MIRRORED } from "../../scripts/sync-extension.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const manifest = JSON.parse(read("extension/manifest.json"));

test("extension/vault is a byte-exact mirror of app/vault", () => {
  const stale = survey().filter((f) => f.stale).map((f) => f.to);
  assert.deepEqual(stale, [], "run: node scripts/sync-extension.mjs");
  assert.deepEqual(orphans(), [], "a mirrored file lost its source");
});

test("the mirror carries no vault-creating code", () => {
  // The clipper writes into a vault the user already has. `scaffold.js` would
  // let it invent one — a folder picked by mistake would quietly acquire a
  // CONVENTION.md and look like a vault ever after.
  const names = MIRRORED.map(([from]) => from);
  assert.ok(!names.some((n) => n.endsWith("scaffold.js")));
  assert.ok(!readdirSync(join(ROOT, "extension/vault")).includes("scaffold.js"));
});

test("the manifest asks for the permissions it uses, and no others", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(),
                   ["activeTab", "contextMenus", "scripting", "storage", "unlimitedStorage"]);
  // No "tabs" (the popup uses activeTab), no "cookies", no "history", no
  // "webRequest": a clipper that could read your browsing history would be a
  // different product, whatever it did with it.
  for (const nope of ["tabs", "cookies", "history", "webRequest", "downloads", "identity"]) {
    assert.ok(!manifest.permissions.includes(nope), `${nope} is not the clipper's business`);
  }
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
});

test("no remote code, and nothing phoned home", () => {
  // SPEC's hard rule, applied to the extension: no server. Every fetch in here
  // takes a URL the user pointed at — an image on the page they are looking at
  // — and there is no literal endpoint anywhere to send anything to.
  for (const file of readdirSync(join(ROOT, "extension")).filter((f) => f.endsWith(".js"))) {
    const src = read(`extension/${file}`);
    const literals = [...src.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)].map((m) => m[1]);
    assert.deepEqual(literals, [], `${file} names a remote URL: ${literals.join(", ")}`);
  }
  for (const html of ["popup.html", "vault.html"]) {
    const src = read(`extension/${html}`);
    assert.ok(!/<script[^>]+src=["']https?:/i.test(src), `${html} loads a remote script`);
  }
});

test("injected code is self-contained", () => {
  // chrome.scripting serializes these functions and evaluates them in the
  // page. An import would survive review and fail only in someone's browser.
  const src = read("extension/injected.js");
  assert.ok(!/^\s*import\s/m.test(src), "injected.js must not import anything");
});

test("the clipper's own files are not the app's", () => {
  // A grep that would have caught the whole class of "it works because the app
  // happens to be open" mistakes.
  const bg = read("extension/background.js");
  assert.ok(!/localhost|127\.0\.0\.1|vercel/i.test(bg));
});

test("the popup's page list keeps a bookmark's empty address", async () => {
  /* The picker behind "add to a page" offers notes and bookmarks separately,
     and the only thing telling them apart is whether `url` is present. A
     bookmark whose address has not been filled in yet carries `url: ""` — the
     presence of the key IS the fact, which is why every reader in the model
     asks `url != null`. `|| null` flattened that and filed it under notes, in
     the one list whose whole job is the distinction. */
  const { pageList } = await import("../../extension/writer.js");
  const { Vault, MemoryBackend } = await import("../vault/vault.js");
  const { serialize } = await import("../vault/mdfile.js");
  const at = "2026-07-20T12:00:00+00:00";
  const md = (over) => serialize({ id: over.id, kind: "note", title: over.title,
                                   created: at, updated: at, ...over }, "x");
  const v = new Vault(new MemoryBackend({
    "notes/Plain.md": md({ id: "01AAAAAAAAAAAAAAAAAAAAAAAA", title: "Plain" }),
    "notes/Draft.md": md({ id: "01BBBBBBBBBBBBBBBBBBBBBBBB", title: "Draft", url: "" }),
  }));
  await v.buildIndex();
  const by = Object.fromEntries(pageList({ vault: v }).map((p) => [p.title, p]));
  assert.equal(by.Plain.url, null, "a note has no address at all");
  assert.equal(by.Draft.url, "", "a bookmark in progress keeps its empty one");
});
