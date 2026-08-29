// `## Attachments` — the reference material a topic keeps beside it.
//
// The tray on a topic page holds pasted notes, markdown, a link with a reason,
// and exported conversations. None of that can live in frontmatter: FIELD_ORDER
// has no key for it, `serialize()` throws on an unknown one, and it emits only
// scalars and scalar arrays — an attachment is a nested object with a body of
// arbitrary prose in it. So it goes where CONVENTION says structured content
// goes, into a body section Obsidian renders as ordinary markdown:
//
//     ## Attachments
//
//     ### Some article (link)
//     Source: https://example.com
//
//     why it matters
//
// One `###` per attachment. The parenthesis carries the source label the tray
// shows on the chip; `Source:` carries the URL, and only when it is the line
// directly under the heading — separated from the body by a blank line, so an
// attachment whose text *begins* "Source: …" is still its own text.
//
// Everything here works on the escaped, on-disk form (see sections.js). An
// attachment body is user content pasted from anywhere — a chat export is full
// of `###` — so each one is escaped STRICTLY on the way in: strict mode adds
// `###` to the delimiters, which is what stops a pasted heading from forging
// the boundary between one attachment and the next.

import { escapeUser, unescapeUser } from "./mdfile.js";
import { getSection, setSection } from "./sections.js";
import { safeUrl, oneLine } from "./clip.js";

export const SECTION = "Attachments";

/** The tray's own type vocabulary. `chat` is one type over several sources. */
const CHAT_SOURCES = new Set(["chatgpt", "claude", "gemini", "notebooklm", "chat"]);

const MAX_TITLE = 200;

/**
 * The type is DERIVED, never stored twice: a url makes it a link, a known chat
 * label makes it a chat, `markdown` renders as markdown, and anything else —
 * including CONVENTION's own `### Some article (web)` — is plain text, which is
 * the one preview that can render any string safely.
 */
export function typeFor(source, url) {
  if (url) return "link";
  const s = String(source || "").toLowerCase();
  if (s === "markdown") return "markdown";
  if (CHAT_SOURCES.has(s)) return "chat";
  return "text";
}

/** A label safe to sit inside `(…)` on the heading line. */
function safeSource(att) {
  const raw = String(att.source || att.type || "").toLowerCase();
  const clean = raw.replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || typeFor(null, null);
}

/** One attachment → its `###` block, or null when there is nothing to write. */
function blockFor(att) {
  if (!att || typeof att !== "object") return null;
  // The clipper's rule, applied here for the same reason: a `javascript:` href
  // written into a topic is a link Obsidian will happily offer to click.
  const url = safeUrl(att.url ?? (att.meta && att.meta.url));
  const title = oneLine(att.title || "", MAX_TITLE) || "Untitled";
  const body = escapeUser(String(att.body ?? "").replace(/\s+$/, ""), true);
  if (!url && !body) return null;
  const head = [`### ${title} (${safeSource(att)})`, ...(url ? [`Source: ${url}`] : [])].join("\n");
  return body ? `${head}\n\n${body}` : head;
}

/** The attachments → the section body. Empty when nothing survives. */
export function serializeAttachments(list) {
  return (Array.isArray(list) ? list : []).map(blockFor).filter(Boolean).join("\n\n");
}

const ENTRY = /^###[ \t]+(.*?)(?:[ \t]+\(([^()]*)\))?[ \t]*$/;
const SOURCE_LINE = /^Source:[ \t]*(\S.*)$/;

/** The section body → the attachments. The inverse of `serializeAttachments`. */
export function parseAttachments(sectionBody) {
  const out = [];
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (const line of String(sectionBody ?? "").split("\n")) {
    const m = ENTRY.exec(line);
    if (m) {
      flush();
      cur = { title: m[1].trim(), source: (m[2] || "").trim().toLowerCase(), lines: [] };
      continue;
    }
    if (!cur) continue;                       // preamble under the heading: not ours
    // Adjacent to the heading, `Source:` is the URL. One blank line down it is
    // the attachment's own first sentence.
    if (!cur.lines.length && cur.url === undefined) {
      const s = SOURCE_LINE.exec(line);
      if (s) { cur.url = safeUrl(s[1].trim()); continue; }
      if (line.trim() === "") { cur.url = null; continue; }
      cur.url = null;
    }
    cur.lines.push(line);
  }
  flush();
  return out.map(({ title, source, url, lines }) => {
    const body = unescapeUser(lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, ""));
    return {
      type: typeFor(source, url),
      title: title || "Untitled",
      source: source || typeFor(source, url),
      body,
      ...(url ? { url, meta: { url } } : {}),
    };
  });
}

/** What the topic page reads: a page's sections blob → its attachments. */
export function readAttachments(sections) {
  return parseAttachments(getSection(sections, SECTION) ?? "");
}

/** What a save writes: the sections blob with `## Attachments` replaced. */
export function writeAttachments(sections, list) {
  return setSection(sections, SECTION, serializeAttachments(list));
}
