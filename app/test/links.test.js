// Task 6.10: one fixture per resolution tier, plus the link forms Obsidian
// supports. Resolution order is basename → aliases → path, case-insensitive.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWikilink, parseWikilink, findWikilinks, basenameOf, isEmbeddableFile,
         withMention, withoutMention, mentionName, isLinkOnlyLine } from "../vault/links.js";

const ENTRIES = [
  { id: "01A", path: "notes/Lantern Notes.md",      title: "Lantern Notes",   aliases: [] },
  { id: "01B", path: "topics/Quire Structures.md",  title: "Quire Structures", aliases: ["Quires", "QS"] },
  { id: "01C", path: "projects/Bindery/Bindery.md", title: "Bindery",         aliases: [] },
  { id: "01D", path: "notes/Design-0rks.md",        title: "Design",          aliases: ["Design"] },
  { id: "01E", path: "canvas/Pressed Leaf.md",      title: "Pressed Leaf",    aliases: [] },
];

test("tier 1 — resolves by filename basename", () => {
  assert.equal(resolveWikilink("Lantern Notes", ENTRIES).id, "01A");
});

test("tier 2 — resolves by alias when no basename matches", () => {
  assert.equal(resolveWikilink("Quires", ENTRIES).id, "01B");
  // the suffixed file carries its true title in aliases (task 1.15)
  assert.equal(resolveWikilink("Design", ENTRIES).id, "01D");
});

test("tier 3 — resolves by relative path", () => {
  assert.equal(resolveWikilink("projects/Bindery/Bindery.md", ENTRIES).id, "01C");
  assert.equal(resolveWikilink("projects/Bindery/Bindery", ENTRIES).id, "01C");
});

test("resolution is case-insensitive", () => {
  assert.equal(resolveWikilink("lantern notes", ENTRIES).id, "01A");
  assert.equal(resolveWikilink("QUIRES", ENTRIES).id, "01B");
});

test("basename beats alias when both could match", () => {
  const entries = [
    { id: "X", path: "notes/Alpha.md", title: "Alpha", aliases: [] },
    { id: "Y", path: "notes/Beta.md",  title: "Beta",  aliases: ["Alpha"] },
  ];
  assert.equal(resolveWikilink("Alpha", entries).id, "X");
});

test("an unresolvable target returns null, not a guess", () => {
  assert.equal(resolveWikilink("Nothing Here", ENTRIES), null);
  assert.equal(resolveWikilink("", ENTRIES), null);
});

test("parses display text, headings and both together", () => {
  assert.deepEqual(parseWikilink("Target"), { target: "Target", display: null, heading: null });
  assert.deepEqual(parseWikilink("Target|the piece"), { target: "Target", display: "the piece", heading: null });
  assert.deepEqual(parseWikilink("Target#Section"), { target: "Target", display: null, heading: "Section" });
  assert.deepEqual(parseWikilink("Target#Section|shown"),
    { target: "Target", display: "shown", heading: "Section" });
});

test("finds every link form in a body, embeds included", () => {
  const body = "See [[Lantern Notes]] and [[Quire Structures|the quires]].\n"
             + "Also [[Quire Structures#Folding]] plus ![[reference-01.png]] and ![[Pressed Leaf.canvas]].";
  const found = findWikilinks(body);
  assert.equal(found.length, 5);
  assert.deepEqual(found.map((f) => f.embed), [false, false, false, true, true]);
  assert.equal(found[1].display, "the quires");
  assert.equal(found[2].heading, "Folding");
  assert.ok(isEmbeddableFile(found[3].target));
  assert.ok(isEmbeddableFile(found[4].target));
  assert.ok(!isEmbeddableFile(found[0].target));
});

test("6.10 nothing in a migrated body resolves broken", () => {
  const body = "A [[Lantern Notes]], an alias [[QS]], a path [[projects/Bindery/Bindery.md]], "
             + "a piped [[Quire Structures|quires]] and a heading [[Lantern Notes#Intro]].";
  const broken = findWikilinks(body)
    .filter((l) => !isEmbeddableFile(l.target))
    .filter((l) => !resolveWikilink(l.target, ENTRIES));
  assert.deepEqual(broken.map((b) => b.target), [], "every tier must resolve");
});

test("6.10 a genuinely missing target is reported broken — the 1.13 case", () => {
  const body = "child [[missing-page-05yxzz]]";
  const [l] = findWikilinks(body);
  assert.equal(resolveWikilink(l.target, ENTRIES), null);
});

test("basenameOf strips folders and the extension", () => {
  assert.equal(basenameOf("projects/Bindery/Bindery.md"), "Bindery");
  assert.equal(basenameOf("canvas/Pressed Leaf.canvas"), "Pressed Leaf");
});

// Obsidian does not linkify inside code, and CONVENTION.md — which now ships
// into every scaffolded vault — carries seven [[example]]s inside code blocks.
// Without masking, every new vault opens with seven dead links in its graph.

test("a wikilink inside a fenced code block is not a link", () => {
  const text = "See [[Real Page]].\n\n```markdown\n[[Not A Link]]\n![[nope.canvas]]\n```\n\nAnd [[Also Real]].\n";
  assert.deepEqual(findWikilinks(text).map((l) => l.target), ["Real Page", "Also Real"]);
});

test("a wikilink inside an inline code span is not a link", () => {
  const text = 'Write `parent: "[[X]]"` and it embeds with `![[board.canvas]]`, unlike [[Real]].\n';
  assert.deepEqual(findWikilinks(text).map((l) => l.target), ["Real"]);
});

test("tilde fences and long fences close correctly", () => {
  const text = "~~~\n[[a]]\n~~~\n[[b]]\n````\n[[c]]\n```\nstill code [[d]]\n````\n[[e]]\n";
  assert.deepEqual(findWikilinks(text).map((l) => l.target), ["b", "e"]);
});

test("an unclosed fence swallows the rest of the file, as markdown does", () => {
  assert.deepEqual(findWikilinks("[[before]]\n```\n[[after]]\n").map((l) => l.target), ["before"]);
});

test("offsets still index the original text after masking", () => {
  const text = "`[[skipped]]` then [[Kept]] here\n";
  const [link] = findWikilinks(text);
  assert.equal(link.target, "Kept");
  assert.equal(text.slice(link.start, link.end), "[[Kept]]");
});

test("the shipped CONVENTION.md has no wikilinks outside code except index and log", async () => {
  const { CONVENTION_MD } = await import("../vault/brain-text.js");
  assert.deepEqual(
    [...new Set(findWikilinks(CONVENTION_MD).map((l) => l.target))].sort(),
    ["index", "log"],
  );
});

// ── Mentions, as text ───────────────────────────────────────────────────────
// `entry.mentions` is derived from the body, so adding a link means writing one
// into the body. "Link a page" pushed onto the in-memory array instead, and the
// chip was gone by the next load. These are the transforms that fix that.

test("a mention goes into the body as a title, never as an id", () => {
  assert.equal(withMention("Prose.", "Quire Structures"), "Prose.\n\n[[Quire Structures]]");
  // CONVENTION: "Never [[<ULID>]]" — whatever is passed is written verbatim, so
  // the caller must pass the title. The picker's row label is the title.
  assert.equal(withMention("", "Alpha"), "[[Alpha]]");
});

test("brackets and pipes cannot end the link early", () => {
  assert.equal(mentionName(" A [weird] name|x "), "A weird namex");
  assert.equal(withMention("x", "A [B] C"), "x\n\n[[A B C]]");
});

test("a page already linked in the prose is not linked again", () => {
  const body = "See [[Alpha]] for the rest.";
  assert.equal(withMention(body, "Alpha"), body);
  assert.equal(withMention(body, "alpha"), body, "resolution is case-insensitive");
});

test("consecutive links join one trailing line instead of one paragraph each", () => {
  let b = withMention("Prose.", "Alpha");
  b = withMention(b, "Beta");
  b = withMention(b, "Gamma");
  assert.equal(b, "Prose.\n\n[[Alpha]] [[Beta]] [[Gamma]]");
});

test("a link inside a sentence is unlinked, not deleted — the word stays", () => {
  assert.equal(withoutMention("Built on [[Alpha]] for now.", "Alpha"), "Built on Alpha for now.");
  assert.equal(withoutMention("Built on [[Alpha|the first]].", "Alpha"), "Built on the first.");
});

test("a link on a line of its own goes, and takes its blank line with it", () => {
  assert.equal(withoutMention("Prose.\n\n[[Alpha]]", "Alpha"), "Prose.");
  assert.equal(withoutMention("Prose.\n\n[[Alpha]] [[Beta]]", "Alpha"), "Prose.\n\n[[Beta]]");
});

test("an embed is not a mention and is left alone", () => {
  const body = "![[mood.png]]\n\n[[Alpha]]";
  assert.equal(withoutMention(body, "mood.png"), body);
});

test("a link inside code is not touched, because Obsidian does not linkify it", () => {
  const body = "```\n[[Alpha]]\n```\n\n[[Alpha]]";
  assert.equal(withoutMention(body, "Alpha"), "```\n[[Alpha]]\n```");
  assert.equal(withMention("`[[Alpha]]`", "Alpha"), "`[[Alpha]]`\n\n[[Alpha]]",
    "a link that only exists in code does not count as already linked");
});

test("removing a mention the body does not carry changes nothing", () => {
  assert.equal(withoutMention("Prose.", "Alpha"), "Prose.");
});

test("a links-only line is bookkeeping; a sentence is not", () => {
  assert.equal(isLinkOnlyLine("[[A]] [[B]]"), true);
  assert.equal(isLinkOnlyLine("see [[A]]"), false);
  assert.equal(isLinkOnlyLine(""), false);
});

test("add then remove leaves the body as it was", () => {
  for (const body of ["Prose.", "", "# Head\n\nA line.\n", "Only [[Beta]] here."]) {
    const round = withoutMention(withMention(body, "Alpha"), "Alpha");
    assert.equal(round, body.replace(/\s+$/, ""), JSON.stringify(body));
  }
});
