// The five structural body sections, on the DISK side of the escape.
//
// CONVENTION's "Body sections": `## Thread`, `## Attachments`, `## Links`,
// `## Mentions` and `## Board contents` are structure. Everything else in a
// body — a user's own `## Design notes` — is prose, and stays untouched.
//
// `escapeUser` is the whole reason the two can be told apart: a heading the
// user typed reaches disk as `\## Attachments`, so an *unescaped* one is
// unambiguously ours. Which is why every function here reads and writes the
// body **as it sits on disk** — after `escapeUser`, before `unescapeUser`.
// Split a body that has already been unescaped and a page whose prose merely
// says `## Attachments` grows a section it never had; compose one above the
// escape and `put()` backslashes the heading you just wrote, which is the bug
// that kept the attachments tray from ever reaching a file.
//
// So: `Vault.get()` splits here and hands the prose out unescaped with the
// sections beside it; `Vault.put()` escapes the prose and appends the sections
// verbatim. The seam is those two lines and nothing else.

import { SECTIONS } from "./mdfile.js";

const HEADING = new RegExp(`^##[ \\t]+(${SECTIONS.join("|")})[ \\t]*$`);

/** Where a section sorts, when one is being inserted. CONVENTION's own order. */
const RANK = new Map(SECTIONS.map((name, i) => [name, i]));

const trimBlank = (s) => String(s).replace(/^\n+/, "").replace(/\s+$/, "");

/**
 * A body → `{prose, sections}`, both still escaped.
 *
 * The first unescaped structural heading is the seam: everything above it is
 * the page, everything from it down is structure. There is no interleaving —
 * a section that started cannot be followed by more prose, which is what makes
 * the split reversible.
 */
export function splitSections(body) {
  const lines = String(body ?? "").split("\n");
  const at = lines.findIndex((ln) => HEADING.test(ln));
  if (at === -1) return { prose: trimBlank(lines.join("\n")), sections: "" };
  return {
    prose: trimBlank(lines.slice(0, at).join("\n")),
    sections: trimBlank(lines.slice(at).join("\n")),
  };
}

/** The inverse of `splitSections`, exactly — one blank line between the two. */
export function joinBody(prose, sections) {
  const p = trimBlank(prose ?? "");
  const s = trimBlank(sections ?? "");
  if (!s) return p;
  return p ? `${p}\n\n${s}` : s;
}

/** The sections blob → `[{name, body}]`, in the order the file has them. */
export function parseSections(sections) {
  const out = [];
  for (const line of String(sections ?? "").split("\n")) {
    const m = HEADING.exec(line);
    if (m) out.push({ name: m[1], lines: [] });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  return out.map(({ name, lines }) => ({ name, body: trimBlank(lines.join("\n")) }));
}

export function stringifySections(list) {
  return (list || [])
    .filter((s) => s && s.name)
    .map((s) => (s.body ? `## ${s.name}\n\n${trimBlank(s.body)}` : `## ${s.name}`))
    .join("\n\n");
}

/** One section's body, or `null` when the file has no such section. */
export function getSection(sections, name) {
  const hit = parseSections(sections).find((s) => s.name === name);
  return hit ? hit.body : null;
}

/**
 * Replace one section, leaving the others exactly where they were.
 *
 * An empty body REMOVES the section — an emptied tray must leave no heading
 * behind, or the page keeps an "Attachments" hole forever. A section the file
 * did not have is inserted in CONVENTION's order rather than appended, so two
 * clients writing different sections converge on the same file.
 */
export function setSection(sections, name, body) {
  const list = parseSections(sections);
  const at = list.findIndex((s) => s.name === name);
  const next = trimBlank(body ?? "");
  if (at !== -1) {
    if (next) list[at] = { name, body: next };
    else list.splice(at, 1);
  } else if (next) {
    const rank = RANK.has(name) ? RANK.get(name) : SECTIONS.length;
    const before = list.findIndex((s) => (RANK.has(s.name) ? RANK.get(s.name) : SECTIONS.length) > rank);
    list.splice(before === -1 ? list.length : before, 0, { name, body: next });
  }
  return stringifySections(list);
}
