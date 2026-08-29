// About me is a page in `context/`, and its content is its BODY.
//
// It used to be a form: Identity / Taste / Communication / State over
// experience, skills, education and highlights. Not one of those fields ever
// reached the disk. `updatePage` writes title, tags, aliases, url, status,
// two `meta` keys and the body — the screen's other eight keys were dropped
// on the way past, and the save reported success every time. The read side
// never had them either, so the form came back blank on every load.
//
// Widening the format was not available: the frontmatter key list is closed,
// `serialize` throws outside it, and YAML there cannot hold a nested object
// at all. So the fields are gone and these tests hold both halves shut — the
// body really does round-trip through the disk, and a patch carrying
// something the vault cannot write is refused OUT LOUD rather than swallowed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault, MemoryBackend } from "../vault/vault.js";
import { Data } from "../vault/data.js";
import { serialize } from "../vault/mdfile.js";

const TS = (d) => `2026-08-${String(d).padStart(2, "0")}T12:00:00+00:00`;
const NOTE_ID = "01AAAAAAAAAAAAAAAAAAAAAAAA";

/** The eight keys the About Me screen sent on every save. */
const GONE = ["identity", "taste", "communication", "state",
  "experience", "skills", "education", "highlights"];

async function stand({ aboutMe = true } = {}) {
  const files = {
    "notes/Harbour.md": serialize({
      id: NOTE_ID, kind: "note", title: "Harbour",
      created: TS(1), updated: TS(2),
    }, "Prose.\n"),
  };
  if (aboutMe) {
    files["context/about-me.md"] = serialize({
      id: "01MEMEMEMEMEMEMEMEMEMEMEME", kind: "note", title: "About me",
      created: TS(1), updated: TS(2), aliases: ["About me"],
    }, "I bind books.\n");
  }
  const v = new Vault(new MemoryBackend(files), { now: () => TS(9) });
  await v.buildIndex();
  return { v, d: new Data(v, { renderMarkdown: (m) => m }) };
}

test("about me is its body, and the body reaches the file on disk", async () => {
  const { v, d } = await stand();
  const before = await d.aboutMe();
  assert.equal(before.body.trim(), "I bind books.");
  assert.equal(before.path, "context/about-me.md");

  const r = await d.updateAboutMe({ body: "I bind books and draw charts.\n" });
  assert.notEqual(r.ok, false, "a body is writable and must not be refused");

  // Read back through the backend, not the index: the point of the round-trip
  // is that the bytes changed, not that an object in memory did.
  const raw = await v.be.readText("context/about-me.md");
  assert.match(raw, /I bind books and draw charts\./);
  assert.equal((await d.aboutMe()).body.trim(), "I bind books and draw charts.");
});

test("the eight fields the form used to send are refused, not dropped", async () => {
  const { d } = await stand();
  const r = await d.updateAboutMe(Object.fromEntries(GONE.map((k) => [k, {}])));
  assert.equal(r.ok, false, "the save must not report success");
  assert.equal(r.reason, "unwritable-fields");
  assert.deepEqual([...r.fields].sort(), [...GONE].sort());
  // And the message names them, because "Not saved" alone is a shrug.
  for (const k of GONE) assert.match(r.message, new RegExp(k));
});

test("a refusal is whole — the writable half is not written either", async () => {
  const { v, d } = await stand();
  const r = await d.updateAboutMe({ body: "half of this", identity: { name: "R" } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.fields, ["identity"]);
  const raw = await v.be.readText("context/about-me.md");
  assert.match(raw, /I bind books\./);
  assert.doesNotMatch(raw, /half of this/);
});

test("a vault adopted without the file says so instead of pretending", async () => {
  const { d } = await stand({ aboutMe: false });
  const me = await d.aboutMe();
  // `path: null` is what the screen reads to withhold the editor: a surface
  // that cannot write must not accept the gesture.
  assert.equal(me.path, null);
  assert.equal(me.body, "");
  const r = await d.updateAboutMe({ body: "anything at all" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-about-me");
});

test("everything the page editor sends on a save is still accepted", async () => {
  // The strictness above must not break the editor, which sends three keys
  // this layer deliberately ignores: `mentions` is recomputed from the body's
  // wikilinks, `kind` belongs to the frontmatter and the path, `slug` is
  // display. Ignoring those is correct; refusing them would be a regression.
  const { d } = await stand();
  const r = await d.updatePage(NOTE_ID, {
    title: "Harbour", body: "Prose, revised.\n", tags: ["draft"],
    mentions: ["Some Page"], kind: "note", slug: "harbour", meta: {},
  });
  assert.notEqual(r.ok, false, JSON.stringify(r));
  assert.equal((await d.page(NOTE_ID)).body.trim(), "Prose, revised.");
});

test("frontmatter could never have held them anyway", async () => {
  // Why "just widen the write list" was not an option. The key list is the
  // convention's, it is closed, and a nested object has no YAML form here.
  const fm = {
    id: NOTE_ID, kind: "note", title: "About me",
    created: TS(1), updated: TS(2),
  };
  for (const k of GONE) {
    assert.throws(() => serialize({ ...fm, [k]: { anything: 1 } }, ""),
      /unknown frontmatter fields/, `serialize must reject \`${k}:\``);
  }
});
