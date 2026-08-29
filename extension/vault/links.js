// Task 6.10: wikilink resolution, matching Obsidian's own rules.
//
// Obsidian resolves a `[[Wikilink]]` against the **filename basename** and the
// frontmatter **aliases** — it never reads a `title:` field. Getting this wrong
// is what made the previous export Obsidian-dead, so the order here is not a
// preference: basename → aliases → relative path, case-insensitive.
//
// Kept separate from app.js so it can be tested headlessly.

/** Split `Target|display` / `Target#heading` / `Target#^block`. */
export function parseWikilink(inner) {
  let rest = String(inner);
  let display = null;
  const pipe = rest.indexOf("|");
  if (pipe !== -1) {
    display = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe);
  }
  let heading = null;
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    heading = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), display, heading };
}

const lower = (s) => String(s || "").toLowerCase();

/** The extension a link target may spell out, and a basename drops. */
const EXT = /\.(md|canvas)$/i;

/** Basename of a vault path, without the extension. */
export function basenameOf(path) {
  const name = String(path).split("/").pop();
  return name.replace(EXT, "");
}

/** A link target, normalised the way every tier compares it. */
const targetKey = (target) => lower(String(target).replace(EXT, "")).trim();

/**
 * The lookup `resolveWikilink` walks, built once for many resolutions.
 *
 * Same three tiers in the same order, and the same tie-break: entries are
 * indexed in path order and the first to claim a key keeps it, so a lookup
 * answers exactly what the linear scan below would have.
 *
 * It exists because that scan sorts the whole vault on every call, and the
 * queries that need it — backlinks, a topic's orbit — resolve every mention in
 * the vault. One sort per query, not one per mention.
 */
export function linkResolver(entries) {
  const byBasename = new Map(), byAlias = new Map(), byPath = new Map();
  const claim = (map, key, e) => { if (key && !map.has(key)) map.set(key, e); };
  const sorted = [...entries].sort((a, b) => String(a.path).localeCompare(String(b.path)));
  for (const e of sorted) {
    claim(byBasename, lower(basenameOf(e.path)), e);              // 1) basename
    for (const a of e.aliases || []) claim(byAlias, lower(a), e); // 2) aliases
    const p = lower(e.path);                                      // 3) relative path,
    claim(byPath, p, e);                                          //    with or
    claim(byPath, p.replace(EXT, ""), e);                         //    without the extension
  }
  return (target) => {
    const t = targetKey(target);
    if (!t) return null;
    return byBasename.get(t) || byAlias.get(t) || byPath.get(t) || null;
  };
}

/**
 * Resolve a link target against index entries ({id, path, title, aliases}).
 * Returns the entry, or null. Ties are broken by path so the choice is stable.
 *
 * Resolving many targets against one set of entries? Build the lookup once with
 * `linkResolver` — this rebuilds it, sort and all, on every call.
 */
export function resolveWikilink(target, entries) {
  return linkResolver(entries)(target);
}

/** True when the target names an embeddable asset rather than a page. */
export function isEmbeddableFile(target) {
  return /\.(png|jpe?g|gif|webp|avif|svg|pdf|canvas)$/i.test(String(target));
}

/**
 * Blank out fenced code blocks and inline code spans, preserving length and
 * line structure so every offset into the result still indexes the original.
 *
 * Obsidian does not linkify inside code, and neither may we: `CONVENTION.md`
 * ships seven `[[example]]`s inside code blocks, and without this every new
 * vault would open showing them as dead links and pull them into the graph.
 */
export function maskCode(text) {
  const src = String(text);
  const lines = src.split("\n");
  let fence = null;                                   // the open fence's marker
  const masked = lines.map((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      // A closing fence is the same character, at least as long, alone on the line.
      const closes = m && m[1][0] === fence[0] && m[1].length >= fence.length
        && line.slice(line.indexOf(m[1]) + m[1].length).trim() === "";
      if (closes) fence = null;
      return " ".repeat(line.length);                 // fence lines are code too
    }
    if (m) { fence = m[1]; return " ".repeat(line.length); }
    // Inline code: matched backtick runs of equal length, within one line.
    return line.replace(/(`+)(?!`)([^\n]*?)\1(?!`)/g, (whole) => " ".repeat(whole.length));
  });
  return masked.join("\n");
}

/**
 * Find every wikilink in a string. Returns
 * {raw, embed, target, display, heading, start, end}.
 *
 * Offsets index the original text; links inside code are skipped.
 */
export function findWikilinks(text) {
  const out = [];
  const src = String(text);
  const scan = maskCode(src);
  const re = /(!?)\[\[([^\]\n]+?)\]\]/g;
  let m;
  // Masked regions are all spaces and so contain no `]]`; a match therefore
  // never straddles one, and the captures equal the original text at m.index.
  while ((m = re.exec(scan))) {
    const { target, display, heading } = parseWikilink(m[2]);
    out.push({
      raw: m[0], embed: m[1] === "!", target, display, heading,
      start: m.index, end: m.index + m[0].length,
    });
  }
  return out;
}

/* ── Mentions, as text ──────────────────────────────────────────────────────
 * A mention is not a stored field: `buildIndex` derives `entry.mentions` from
 * the `[[...]]` in the body on every rebuild. So adding or removing one means
 * editing the text, and these are that edit. Here rather than in `app.js`
 * because wikilink handling is one subject and this is the half of it that
 * writes — and because everything under `vault/` is testable in Node.
 *
 * Two rules from CONVENTION that these enforce and callers must not re-derive:
 * the link carries the TITLE ("**Never `[[<ULID>]]`**" — Obsidian looks for a
 * file by that name), and it goes in the body, never in a `## Mentions`
 * section: `Vault.put` escapes the five structural headings out of a body it
 * treats as user prose, so writing one there puts `\## Mentions` on disk.
 */

/** True of a line that is nothing but wikilinks — bookkeeping, not a sentence. */
export function isLinkOnlyLine(line) {
  const t = String(line);
  return t.trim() !== "" && t.replace(/!?\[\[[^\]\n]+\]\]/g, "").trim() === "";
}

/** The name as it may sit between brackets. `[`, `]` and `|` would end the link
 *  early or turn the rest into a display alias nobody asked for. */
export function mentionName(name) {
  return String(name == null ? "" : name).replace(/[\[\]|]/g, "").trim();
}

/**
 * `body` with `[[name]]` in it.
 *
 * Unchanged if the page already links there — a second copy at the foot of the
 * page says nothing the first one did not.
 */
export function withMention(body, name) {
  const src = String(body == null ? "" : body);
  const wanted = mentionName(name);
  if (!wanted) return src;
  const already = findWikilinks(src)
    .some((w) => w.target.trim().toLowerCase() === wanted.toLowerCase());
  if (already) return src;
  const link = `[[${wanted}]]`;
  const trimmed = src.replace(/\s+$/, "");
  if (!trimmed) return link;
  const lines = trimmed.split("\n");
  // Join the trailing run of bare links rather than opening a paragraph for
  // each one, or five links become five paragraphs.
  const last = lines[lines.length - 1];
  if (isLinkOnlyLine(last)) {
    lines[lines.length - 1] = `${last.trimEnd()} ${link}`;
    return lines.join("\n");
  }
  return `${trimmed}\n\n${link}`;
}

/**
 * `body` with the link to `name` taken out.
 *
 * Two removals, because there are two kinds of link. One sitting on a line of
 * its own is bookkeeping and simply goes. One inside a sentence is a WORD, and
 * deleting it would edit the user's prose — so it is unlinked and the word
 * stays, which is what "unlink" means everywhere else. Embeds (`![[x]]`) are
 * not mentions and are left alone, and so is anything inside code: Obsidian
 * does not linkify there either.
 */
export function withoutMention(body, name) {
  const src = String(body == null ? "" : body);
  const wanted = mentionName(name).toLowerCase();
  if (!wanted) return src;
  const srcLines = src.split("\n");
  const maskLines = maskCode(src).split("\n");     // same line count, by contract
  const kept = [];
  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    if (!maskLines[i].includes("[[")) { kept.push(line); continue; }
    const bare = isLinkOnlyLine(maskLines[i]);
    let touched = false;
    let next = line.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (raw, bang, inner) => {
      const target = inner.split("|")[0].split("#")[0].trim().toLowerCase();
      if (bang || target !== wanted) return raw;
      touched = true;
      if (bare) return "";
      const [head, display] = inner.split("|");
      return (display || head.split("#")[0]).trim();
    });
    if (!touched) { kept.push(line); continue; }
    next = bare ? next.replace(/\s{2,}/g, " ").trim()
                : next.replace(/[ \t]{2,}/g, " ").trimEnd();
    if (bare && next === "") {
      // That line held only this link. Take the blank line that was holding it
      // apart from the prose above with it, or the page grows a gap per unlink.
      while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
      continue;
    }
    kept.push(next);
  }
  return kept.join("\n").replace(/\s+$/, "");
}
