// The `.excalidraw.md` file format, as the Obsidian Excalidraw plugin writes it.
//
// This module is the interop contract. Every literal below — heading text, the
// `%%` wrapper, the fence language, the 256-character chunking — was read out of
// the plugin's own source rather than inferred from a sample file, because a
// single wrong marker means the plugin silently treats our file as an ordinary
// note and the drawing disappears:
//
//   src/constants/constants.ts   MD_EXCALIDRAW / MD_TEXTELEMENTS / MD_DRAWING
//   src/shared/ExcalidrawData.ts generateMDBase(), getMarkdownDrawingSection()
//   src/shared/Workers/compression-worker.ts   compress / decompress
//
// The shape of a file:
//
//   ---
//   excalidraw-plugin: parsed
//   tags: [excalidraw]
//   ---
//   <back-of-the-note markdown, freely editable by the user>
//   %%
//   # Excalidraw Data
//
//   ## Text Elements
//   the raw text ^elementId
//
//   ## Element Links
//   elementId: [[Some Note]]
//
//   ## Embedded Files
//   fileId: [[attachments/pic.png]]
//
//   ## Drawing
//   ```compressed-json
//   <base64, 256 chars per line, blank line between>
//   ```
//   %%
//
// Note the asymmetry the plugin itself lives with: `## Drawing` is authoritative,
// and `## Text Elements` is a derived index that exists so Obsidian's search and
// backlinks can see words inside a drawing. We regenerate it from the scene on
// every write for exactly that reason — never parse it back into the scene.

import LZString from "../vendor/lz-string.js";

export const MD_EXCALIDRAW = "# Excalidraw Data";
export const MD_TEXTELEMENTS = "## Text Elements";
export const MD_ELEMENTLINKS = "## Element Links";
export const MD_EMBEDFILES = "## Embedded Files";
export const MD_DRAWING = "## Drawing";

/** A drawing with nothing in it, in the plugin's own `BLANK_DRAWING` shape. */
export const BLANK_SCENE = {
  type: "excalidraw",
  version: 2,
  source: "https://github.com/zsviczian/obsidian-excalidraw-plugin/releases",
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
  files: {},
};

/** Every `.excalidraw.md` is one of these; anything else is an ordinary note. */
export function isExcalidrawPath(path) {
  return /\.excalidraw\.md$/i.test(String(path || ""));
}

/**
 * `appState` keys that are a live editor session rather than a drawing, and so
 * must never make the trip through a file.
 *
 * Both are objects JSON cannot represent, and both come back from a round trip
 * as a bare `{}` that is the wrong *type* rather than merely the wrong value:
 *
 *   collaborators  a Map. Excalidraw's `restore()` passes any supplied value
 *                  straight through — it only fills in a default when the key
 *                  is absent — so `{}` reaches the editor, which calls
 *                  `.forEach` on it while rendering remote pointers and throws
 *                  `appState.collaborators.forEach is not a function` on every
 *                  update. The drawing still paints, which is what let this
 *                  ride: the failure is an uncaught error behind a canvas that
 *                  looks fine.
 *   fileHandle     a live FileSystemFileHandle, meaningless in another session.
 *
 * Deliberately a denylist, not an allowlist: `scrollX`/`scrollY`/`zoom` are how
 * a drawing reopens where the user left it, and the plugin writes keys of its
 * own that are none of our business. We drop what we know is broken and keep
 * the rest.
 */
const SESSION_APPSTATE = ["collaborators", "fileHandle"];

/**
 * A scene with that session state left out of it.
 *
 * Applied on the way in *and* on the way out. In, because files already carry
 * the bad keys — every drawing this app has ever saved has them, since the
 * editor handle serializes the whole live `appState`. Out, so we stop writing
 * more of them. Returns the scene unchanged when there is nothing to strip.
 */
export function cleanScene(scene) {
  if (!scene || typeof scene !== "object") return scene;
  const st = scene.appState;
  if (!st || typeof st !== "object") return scene;
  if (!SESSION_APPSTATE.some((k) => k in st)) return scene;
  const appState = {};
  for (const k of Object.keys(st)) {
    if (!SESSION_APPSTATE.includes(k)) appState[k] = st[k];
  }
  return { ...scene, appState };
}

/**
 * Compress exactly as the plugin's worker does: base64, then 256-character
 * chunks separated by a blank line, then trimmed.
 *
 * The chunking is not cosmetic. One multi-megabyte line makes git diffs
 * unusable and some editors choke on it, which is why the plugin splits it —
 * and why a reader must strip newlines before decoding.
 */
export function compressScene(jsonString) {
  const compressed = LZString.compressToBase64(String(jsonString));
  let out = "";
  for (let i = 0; i < compressed.length; i += 256) {
    out += compressed.slice(i, i + 256) + "\n\n";
  }
  return out.trim();
}

/**
 * The inverse. Strips *all* newlines and carriage returns first — the chunk
 * breaks are formatting, not data, and base64 with a stray \n decodes to
 * garbage rather than failing loudly.
 */
export function decompressScene(chunked) {
  const cleaned = String(chunked == null ? "" : chunked).replace(/[\n\r]/g, "");
  if (!cleaned) return null;
  try {
    return LZString.decompressFromBase64(cleaned);
  } catch {
    return null;
  }
}

// `## Drawing` through the closing fence. Both fence languages, because the
// plugin writes whichever the user's "compress" setting says and we must read
// files written by either.
const RE_DRAWING_COMPRESSED =
  /\n##? Drawing\n[^`]*```compressed-json\n([\s\S]*?)```/m;
const RE_DRAWING_JSON = /\n##? Drawing\n[^`]*```json\n([\s\S]*?)```/m;
// The whole plugin-owned block, so the user's own prose can be separated from it.
const RE_DATA_BLOCK = /\n?(?:%%\n)?# Excalidraw Data\n[\s\S]*$/m;
const RE_FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Just the user's prose, without decoding the drawing.
 *
 * The index calls this on every file it walks, so it must stay cheap — running
 * a full parse (and a decompress) per drawing at startup would be paid by every
 * vault open. Without it, a drawing's excerpt is 300 characters of base64.
 */
export function stripExcalidrawData(text) {
  const src = String(text == null ? "" : text);
  const at = src.search(RE_DATA_BLOCK);
  return (at >= 0 ? src.slice(0, at) : src)
    .replace(/^\s*==⚠[^\n]*\n?/m, "")
    .trim();
}

/**
 * The words *inside* a drawing, as one searchable string.
 *
 * The plugin already writes every text element in plain text under
 * `## Text Elements` — that section exists precisely so an indexer can read a
 * drawing's words without understanding Excalidraw. We were throwing it away:
 * `stripExcalidrawData` cuts from `# Excalidraw Data` onward and the section
 * sits after the cut, so a box labelled "Fold" was invisible to search even
 * though the word was sitting in the markdown in plain sight.
 *
 * Held to the same cost rule as `stripExcalidrawData` — this runs for every
 * drawing on every vault open, so it reads the already-plain section and never
 * decompresses the scene.
 *
 * READ-ONLY, like everything derived from this section: `## Drawing` is
 * authoritative and this text is regenerated from it on write. Never feed the
 * result back into a scene.
 */
export function textOfExcalidraw(text) {
  const src = String(text == null ? "" : text);
  const chunk = sectionText(src, MD_TEXTELEMENTS);
  if (!chunk) return "";
  // Drop the `^elementId` anchors — they are addressing, not words, and
  // leaving them in means a search for a stray hex string "matches" a drawing.
  return chunk
    .split(/\n\n+/)
    .map((para) => para.replace(/\s*\^(\S+)\s*$/, "").trim())
    .filter((t) => t && t !== "_dummy!_")
    .join(" ")
    .trim();
}

/**
 * Read a `.excalidraw.md` into its parts.
 *
 * Returns `{ frontmatter, backOfNote, scene, compressed, textElements,
 * elementLinks, embeddedFiles, error }`. A file we cannot decode comes back
 * with `scene: null` and a populated `error` rather than throwing: the caller
 * must be able to show "this drawing is unreadable" without losing the file.
 */
/**
 * True when `body` (a file body, frontmatter already off) carries the plugin's
 * data block — i.e. it is the WHOLE drawing file and not just the prose above
 * it. `page(id)` hands the app `backOfNote` as the page's body, so anything
 * that saves "the body" of a board is holding half a file and does not know it.
 */
export function hasExcalidrawData(body) {
  return RE_DATA_BLOCK.test(String(body == null ? "" : body));
}

/**
 * Put `back` above the drawing and leave the drawing's own bytes alone.
 *
 * The scene is not re-serialized here on purpose: re-encoding it to change the
 * prose above it would rewrite the compressed payload and the generated
 * sections for an edit that never touched a single element.
 */
export function withBackOfNote(body, back) {
  const src = String(body == null ? "" : body);
  const at = src.search(RE_DATA_BLOCK);
  if (at < 0) return String(back || "");
  const text = String(back || "").trim();
  return (text ? `${text}\n\n` : "\n") + src.slice(at).replace(/^\n+/, "");
}

export function parseExcalidraw(text) {
  const src = String(text == null ? "" : text);
  const out = {
    frontmatter: "", backOfNote: "", scene: null, compressed: null,
    textElements: [], elementLinks: [], embeddedFiles: [], error: null,
  };

  let body = src;
  const fm = src.match(RE_FRONTMATTER);
  if (fm) { out.frontmatter = fm[1]; body = src.slice(fm[0].length); }

  // Everything before the plugin block belongs to the user. Preserving it is
  // not a nicety — the plugin calls it the "back of the note" and people keep
  // real writing there, so a save that dropped it would destroy their work.
  const blockAt = body.search(RE_DATA_BLOCK);
  out.backOfNote = (blockAt >= 0 ? body.slice(0, blockAt) : body)
    .replace(/^\s*==⚠[^\n]*\n?/m, "")     // the plugin's own switch-view notice
    .trim();

  let raw = null;
  const packed = body.match(RE_DRAWING_COMPRESSED);
  if (packed) {
    out.compressed = true;
    raw = decompressScene(packed[1]);
    if (raw == null) out.error = "the compressed drawing data could not be decoded";
  } else {
    const plain = body.match(RE_DRAWING_JSON);
    if (plain) { out.compressed = false; raw = plain[1]; }
  }

  if (raw != null && out.error == null) {
    try {
      out.scene = cleanScene(JSON.parse(raw));
    } catch (e) {
      out.error = `the drawing JSON is malformed: ${e.message}`;
    }
  } else if (raw == null && out.error == null) {
    out.error = "no ## Drawing section — this is not an Excalidraw file";
  }

  out.textElements = parseSection(body, MD_TEXTELEMENTS);
  out.elementLinks = parseKeyed(body, MD_ELEMENTLINKS);
  out.embeddedFiles = parseKeyed(body, MD_EMBEDFILES);
  return out;
}

// `<raw text> ^<elementId>`, one per paragraph.
function parseSection(body, heading) {
  const chunk = sectionText(body, heading);
  if (!chunk) return [];
  const out = [];
  for (const para of chunk.split(/\n\n+/)) {
    const m = para.match(/^([\s\S]*?)\s*\^(\S+)\s*$/);
    if (m && m[2] !== "_dummy!_") out.push({ id: m[2], raw: m[1] });
  }
  return out;
}

// `<key>: <value>`, one per paragraph.
function parseKeyed(body, heading) {
  const chunk = sectionText(body, heading);
  if (!chunk) return [];
  const out = [];
  for (const para of chunk.split(/\n\n+/)) {
    const m = para.match(/^([^:\n]+):\s*([\s\S]*?)\s*$/);
    if (m) out.push({ key: m[1].trim(), value: m[2] });
  }
  return out;
}

function sectionText(body, heading) {
  const start = body.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const after = start + heading.length + 2;
  // Stop at the next section heading of any level, or the closing `%%`.
  const rest = body.slice(after);
  const end = rest.search(/\n##? [A-Z]|\n%%\s*$/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/**
 * Text elements, regenerated from the scene for Obsidian's indexer.
 *
 * Derived, never authoritative — see the note at the top of this file.
 */
export function textElementsOf(scene) {
  const els = (scene && Array.isArray(scene.elements)) ? scene.elements : [];
  return els
    .filter((el) => el && el.type === "text" && !el.isDeleted)
    .map((el) => ({
      id: el.id,
      raw: String(el.rawText != null ? el.rawText : (el.originalText || el.text || "")),
    }))
    .filter((t) => t.id && t.raw !== "");
}

/**
 * Element links, regenerated from the scene.
 *
 * Derived for the same reason the text index is. A link attached to a shape
 * lives in `element.link` — which is inside the compressed blob, so Obsidian
 * cannot see it, the backlink graph cannot see it, and an agent reading the
 * markdown cannot see it. Written out here as `elementId: [[Page]]`, it is an
 * ordinary wikilink in an ordinary file: `vault.js` scans mentions from the
 * whole body, `%%` block included, so a link drawn on a shape becomes a real
 * edge in the graph with nothing else to build.
 *
 * The value is passed through as the user set it — `[[Page]]`, a bare page
 * name, or an external URL are all things a link can legitimately be, and
 * guessing which would corrupt two of the three.
 */
export function elementLinksOf(scene) {
  const els = (scene && Array.isArray(scene.elements)) ? scene.elements : [];
  return els
    .filter((el) => el && !el.isDeleted && el.id && el.link != null && String(el.link).trim())
    .map((el) => ({ key: el.id, value: String(el.link).trim() }));
}

/** `[[a/b.png]]` → `a/b.png`; anything else is returned unchanged. */
function unwrapLink(value) {
  const m = String(value == null ? "" : value).trim().match(/^!?\[\[([^\]|#]+)/);
  return m ? m[1].trim() : String(value == null ? "" : value).trim();
}

/**
 * Embedded files, regenerated from the scene against what we know of the vault.
 *
 * An image dropped into the editor arrives as a `dataURL` in `scene.files` and
 * nothing else — a megabyte of base64 with no name, invisible to every other
 * client. `paths` maps each `fileId` to the vault file it was written out to
 * (see `Data.adoptDrawingImages`), and this turns that into the plugin's own
 * `fileId: [[attachments/pic.png]]`, which Obsidian resolves and an agent can
 * follow like any other embed.
 *
 * A file with no known path is left out rather than guessed at: the drawing
 * still renders it from the blob, and a broken wikilink is worse than none.
 */
export function embeddedFilesOf(scene, paths) {
  const map = paths instanceof Map
    ? paths
    : new Map((Array.isArray(paths) ? paths : []).map((e) => [e.key, unwrapLink(e.value)]));
  const ids = new Set(Object.keys((scene && scene.files) || {}));
  for (const el of (scene && Array.isArray(scene.elements)) ? scene.elements : []) {
    if (el && !el.isDeleted && el.fileId) ids.add(el.fileId);
  }
  const out = [];
  for (const id of ids) {
    const path = map.has(id) ? unwrapLink(map.get(id)) : null;
    if (path) out.push({ key: id, value: `[[${path}]]` });
  }
  return out;
}

/**
 * Scene → a `.excalidraw.md` the plugin will open as a drawing.
 *
 * `compressed` defaults to true because that is what the plugin writes out of
 * the box, so our files look native beside the ones it made.
 *
 * All three index sections are regenerated from the scene on every write.
 * `elementLinks` used to be an opt the caller passed back from the parse, which
 * meant a link added *in this app* never reached the markdown — it survived
 * only inside the base64. Derived beats passed-through for the same reason it
 * does for text: the scene is the truth, the sections are its index.
 * `embeddedFiles` stays an argument because only the caller knows where in the
 * vault an image was written — but what it names is still filtered against the
 * scene, so a stale entry cannot outlive the image it described.
 */
export function serializeExcalidraw(scene, opts = {}) {
  const {
    compressed = true,
    backOfNote = "",
    frontmatter = null,
    embeddedFiles = [],
  } = opts;
  const elementLinks = elementLinksOf(scene);

  const fmBody = frontmatter != null && String(frontmatter).trim()
    ? String(frontmatter).trim()
    : "excalidraw-plugin: parsed\ntags: [excalidraw]";

  let out = `---\n${fmBody}\n---\n`;
  const back = String(backOfNote || "").trim();
  out += back ? `${back}\n\n` : "\n";
  out += "%%\n";
  out += `${MD_EXCALIDRAW}\n\n${MD_TEXTELEMENTS}\n`;
  for (const t of textElementsOf(scene)) out += `${t.raw} ^${t.id}\n\n`;

  if (elementLinks.length) {
    out += `${MD_ELEMENTLINKS}\n`;
    for (const l of elementLinks) out += `${l.key}: ${l.value}\n\n`;
  }
  const embeds = embeddedFilesOf(scene, embeddedFiles);
  if (embeds.length) {
    out += `${MD_EMBEDFILES}\n`;
    for (const f of embeds) out += `${f.key}: ${f.value}\n\n`;
  }

  const json = JSON.stringify(cleanScene(scene == null ? BLANK_SCENE : scene));
  out += compressed
    ? `${MD_DRAWING}\n\`\`\`compressed-json\n${compressScene(json)}\n\`\`\`\n%%`
    : `${MD_DRAWING}\n\`\`\`json\n${json}\n\`\`\`\n%%`;
  return out + "\n";
}
