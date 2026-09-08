// The stylesheet is 6000 lines with no build step and no parser between it
// and the browser, so a malformed comment or an unbalanced brace ships.
//
// This is not hypothetical. Editing a rule whose explanatory comment sat
// directly above it left the old comment closed and the new prose bare in the
// stylesheet, followed by a stray `*/`. CSS error recovery swallowed it: the
// page still rendered, `.page-hd`'s padding silently computed to 0, and the
// only symptom was a header that looked cramped. Nothing failed, so nothing
// said anything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"), "utf8");

/** The sheet with every well-formed comment removed. */
const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

test("every comment is opened and closed", () => {
  // A `*/` surviving the strip means it had no opener — the exact shape of
  // the bug above, where prose ended up outside the comment it belonged to.
  const stray = stripped.indexOf("*/");
  assert.equal(stray, -1, stray < 0 ? "" :
    `stray "*/" — prose left outside a comment near: ${
      JSON.stringify(stripped.slice(Math.max(0, stray - 160), stray + 4))}`);
  // And a `/*` surviving means a comment was never closed, which eats every
  // rule after it until the next `*/`.
  const open = stripped.indexOf("/*");
  assert.equal(open, -1, open < 0 ? "" :
    `unclosed comment near: ${JSON.stringify(stripped.slice(open, open + 160))}`);
});

test("braces balance", () => {
  const opens = (stripped.match(/\{/g) || []).length;
  const closes = (stripped.match(/\}/g) || []).length;
  assert.equal(opens, closes, `${opens} "{" vs ${closes} "}" — a rule is unterminated`);
});

test("the masthead still declares the padding it is supposed to have", () => {
  /* The regression that motivated this file was silent because the rule
     stopped existing, not because a value changed. Assert the rule is
     present and still sets padding on all four sides from one token. */
  const rule = /\.page-hd\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, ".page-hd rule is missing entirely");
  assert.match(rule[1], /padding:\s*var\(--sp-\d\);/,
    "the masthead's padding must be a single token applied to all four sides");
});

test("every declaration's parentheses balance", () => {
  /* One paren too many voids the whole declaration, and CSS error recovery
     says nothing about it. `.pages-row` carried
     `border-bottom: 1px dashed var(--line-very-soft));` for as long as anyone
     can tell: no separator was ever drawn between two rows, while the rule
     right underneath it — `:last-child { border-bottom: 0 }` — went on looking
     like it was doing something. Nothing failed, so nothing said anything.
     Same class of bug as the unclosed comment above, same reason for a test. */
  const noStrings = stripped.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const bad = [];
  // Split on the three characters that end a declaration or a selector; every
  // piece should balance on its own.
  for (const piece of noStrings.split(/[;{}]/)) {
    if (!piece.includes(":")) continue;      // not a declaration or a selector
    let depth = 0;
    let broke = false;
    for (const ch of piece) {
      if (ch === "(") depth++;
      else if (ch === ")" && --depth < 0) { broke = true; break; }
    }
    if (broke || depth !== 0) bad.push(piece.trim().replace(/\s+/g, " ").slice(0, 120));
  }
  assert.deepEqual(bad, [], `unbalanced parentheses — these declarations are dead:\n${bad.join("\n")}`);
});
