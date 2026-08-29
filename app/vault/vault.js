// The §9 data layer. Every file access in the app goes through here; app.js
// never touches a file API directly. That seam is what makes a native shell an
// add-on rather than a rewrite.
//
// One core, two backends. `FSABackend` is the File System Access API;
// `MemoryBackend` is an in-memory filesystem so the whole thing is testable
// under `node --test` with no browser and no npm install (task 5.11).

import { serialize, parse, escapeUser, unescapeUser, REQUIRED } from "./mdfile.js";
import { splitSections, joinBody } from "./sections.js";
import { isExcalidrawPath, stripExcalidrawData, textOfExcalidraw } from "./excalidraw.js";
import { basenameOf } from "./links.js";

/* Whose body is it.
   A `.excalidraw.md` is one blob in the Obsidian plugin's own format: the `%%`
   drawing block, the `## Text Elements` index regenerated on every write, and
   the back-of-note above them. It is written and read as a whole, and pulling
   a `## Board contents` out of the middle of it would hand the board's own
   text back twice — once inside the body the editor re-serializes, once as a
   section beside it. Everything else is prose plus sections. */
const splitsSections = (path) => !isExcalidrawPath(path);

export const IGNORED_DIRS = [".git", ".obsidian", ".trash", ".history"];
export const KIND_BY_FOLDER = {
  notes: "note", topics: "topic", canvas: "canvas",
  inspo: "inspo", projects: "project", context: "note",
};
const HISTORY_KEEP = 10;
const EXCERPT = 300;

const isIgnored = (path) =>
  path.split("/").some((p) => IGNORED_DIRS.includes(p) || (p.startsWith(".") && p !== "."));

// ── tags ────────────────────────────────────────────────────────────────────
// Task 5.24. `#` is only a tag outside fenced blocks and inline code, and only
// when it opens a word at a boundary — so `## Heading` and `example.com/#frag`
// are not tags.
export function extractInlineTags(body) {
  const stripped = String(body)
    .replace(/^```[\s\S]*?^```/gm, "")
    .replace(/^~~~[\s\S]*?^~~~/gm, "")
    .replace(/`[^`\n]*`/g, "");
  const out = new Set();
  for (const m of stripped.matchAll(/(?:^|\s)#([A-Za-z0-9_][\w/-]*)/g)) out.add(m[1]);
  return [...out];
}

export function inferKind(path) {
  // The file format identifies itself, so the extension wins over the folder.
  // A drawing IS a canvas — one kind covers boards and drawings, the same way
  // `note` covers bookmarks and articles; the renderer picks by file format.
  // (An `.excalidraw.md` carries no `kind:` — its frontmatter is
  // `excalidraw-plugin: parsed` — so there is nothing else to read it from.)
  if (isExcalidrawPath(path)) return "canvas";
  const top = path.split("/")[0];
  return KIND_BY_FOLDER[top] || "note";
}

/** `canvas/Board.excalidraw.md` → `Board`. Both extensions, not just `.md`. */
export function titleFromPath(path) {
  return String(path).split("/").pop().replace(/\.excalidraw\.md$/i, "").replace(/\.md$/, "");
}

function excerptOf(body) {
  return String(body).replace(/\s+/g, " ").trim().slice(0, EXCERPT);
}

function stamp(iso) {
  return iso.replace(/:/g, "-");
}

// ── backends ────────────────────────────────────────────────────────────────

export class MemoryBackend {
  constructor(files = {}) {
    this.files = new Map();          // path -> {data: Uint8Array, mtime: number}
    this.clock = 1;
    for (const [p, v] of Object.entries(files)) this.writeText(p, v);
  }
  #enc(s) { return new TextEncoder().encode(s); }
  async listAll() {
    return [...this.files.entries()]
      .filter(([p]) => !isIgnored(p))
      .map(([path, f]) => ({ path, mtime: f.mtime, size: f.data.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  async exists(path) { return this.files.has(path); }
  async stat(path) {
    const f = this.files.get(path);
    return f ? { mtime: f.mtime, size: f.data.length } : null;
  }
  async readBytes(path) {
    const f = this.files.get(path);
    if (!f) throw new Error(`ENOENT: ${path}`);
    return f.data;
  }
  async readText(path) { return new TextDecoder("utf-8", { fatal: true }).decode(await this.readBytes(path)); }
  async writeBytes(path, bytes) { this.files.set(path, { data: bytes, mtime: this.clock++ }); }
  async writeText(path, text) { await this.writeBytes(path, this.#enc(text)); }
  async move(from, to) {
    const f = this.files.get(from);
    if (!f) throw new Error(`ENOENT: ${from}`);
    this.files.set(to, f);
    this.files.delete(from);
  }
  async listDir(prefix) {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix + "/"));
  }
  async mkdirp() { /* directories are implicit in the memory backend */ }
  async remove(path) { this.files.delete(path); }
}

export class FSABackend {
  constructor(rootHandle) { this.root = rootHandle; }
  async #dir(parts, create = false) {
    let h = this.root;
    for (const p of parts) h = await h.getDirectoryHandle(p, { create });
    return h;
  }
  async #file(path, create = false) {
    const parts = path.split("/");
    const name = parts.pop();
    const dir = await this.#dir(parts, create);
    return dir.getFileHandle(name, { create });
  }
  async listAll() {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle.kind === "directory") {
          if (IGNORED_DIRS.includes(name) || name.startsWith(".")) continue;
          await walk(handle, path);
        } else {
          const f = await handle.getFile();
          out.push({ path, mtime: f.lastModified, size: f.size });
        }
      }
    };
    await walk(this.root, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  async exists(path) {
    try { await this.#file(path); return true; } catch { return false; }
  }
  async stat(path) {
    try {
      const f = await (await this.#file(path)).getFile();
      return { mtime: f.lastModified, size: f.size };
    } catch { return null; }
  }
  async readBytes(path) {
    const f = await (await this.#file(path)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  }
  async readText(path) {
    const f = await (await this.#file(path)).getFile();
    const buf = await f.arrayBuffer();
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  }
  async writeBytes(path, bytes) {
    const h = await this.#file(path, true);
    const w = await h.createWritable();      // temp file, swapped on close
    await w.write(bytes);
    await w.close();
  }
  async writeText(path, text) {
    await this.writeBytes(path, new TextEncoder().encode(text));
  }
  async move(from, to) {
    const bytes = await this.readBytes(from);
    await this.writeBytes(to, bytes);
    const parts = from.split("/");
    const name = parts.pop();
    (await this.#dir(parts)).removeEntry(name);
  }
  async listDir(prefix) {
    return (await this.listAll()).map((f) => f.path).filter((p) => p.startsWith(prefix + "/"));
  }
  async remove(path) {
    const parts = path.split("/");
    const name = parts.pop();
    (await this.#dir(parts)).removeEntry(name);
  }
  async mkdirp(path) { await this.#dir(path.split("/"), true); }
}

// ── writer election (5.10 / 5.23) ───────────────────────────────────────────

export const HEARTBEAT_MS = 1500;
export const PEER_TTL_MS = 4000;

/**
 * A peer that never says goodbye must be forgotten, or the lock outlives its
 * owner. The first version had neither half: `release()` was written but no
 * caller ever invoked it, and `peers` stored a timestamp that nothing read. A
 * peer id, once heard, was permanent for the life of the document — so a tab
 * that reloaded while the outgoing document was still alive to answer its
 * `hello` inherited a dead peer, and if that corpse's random id sorted lower
 * this tab was read-only forever. Every save came back `not-writer` with no
 * other tab open, and only a reload with a long enough gap — long enough that
 * nothing answered the `hello` — cleared it.
 *
 * So liveness is now proven continuously, two independent ways:
 *
 *   - `bye` on `pagehide`, so an orderly close or reload is instant; and
 *   - a heartbeat, so a crash, a discarded tab or a lost `bye` still expires.
 *
 * The probe direction matters. The heartbeat is a `ping` *this* tab sends, to
 * which every live tab replies `here` from its message handler — liveness is
 * never inferred from a peer's own timer. Chrome throttles timers in hidden
 * tabs to about one tick a minute but keeps delivering channel messages, so a
 * peer-driven heartbeat would have let a foreground reader evict a background
 * writer and give two tabs the lock at once. A tab whose timer is throttled
 * does not sweep either, which is exactly the safe failure.
 *
 * The sweep runs at the top of a tick, evicting against the *previous* ping's
 * replies: a live peer answers within milliseconds, so eviction needs roughly
 * two missed rounds and cannot flap the writer bit under ordinary jitter.
 */
export class WriterElection {
  constructor(channel, id = Math.random().toString(36).slice(2), opts = {}) {
    this.id = id;
    this.peers = new Map();
    this.isWriter = true;
    this.ch = channel;
    this.onChange = opts.onChange ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.ttlMs = opts.ttlMs ?? PEER_TTL_MS;
    this._setInterval = opts.setInterval ?? ((f, ms) => setInterval(f, ms));
    this._clearInterval = opts.clearInterval ?? ((t) => clearInterval(t));
    // Injected so the unload path is reachable in a test rather than only by
    // closing a real tab. Null in Node, where there is no window.
    this._target = opts.target ?? (typeof window !== "undefined" ? window : null);
    this._timer = null;
    this.released = false;
    /** Open only between `release()` and the document actually going away —
     *  see release(). Lets a closing tab finish the write it already began. */
    this.closing = false;
    if (this.ch) {
      this.ch.onmessage = (e) => this.#onMessage(e.data);
      this.#start();
      if (this._target && this._target.addEventListener) {
        // `pagehide` fires where `beforeunload` does and also where it does
        // not — a discarded or bfcached document — and unlike `beforeunload`
        // it does not make this tab ineligible for the bfcache.
        this._target.addEventListener("pagehide", () => this.release());
        // Restored from the bfcache: the document is live again after having
        // announced its own death, so it has to re-introduce itself.
        this._target.addEventListener("pageshow", (e) => { if (e && e.persisted) this.resume(); });
      }
    }
  }

  #start() {
    this.released = false;
    this.#say("hello");
    if (this._timer != null || !this.heartbeatMs) return;
    this._timer = this._setInterval(() => this.tick(), this.heartbeatMs);
    // Node's timers keep the process alive; a test must not hang on one.
    if (this._timer && typeof this._timer.unref === "function") this._timer.unref();
  }

  #say(type) {
    if (this.ch) this.ch.postMessage({ type, id: this.id });
  }

  #onMessage(msg) {
    if (!msg || msg.id === this.id || this.released) return;
    const reply = msg.type === "hello" || msg.type === "ping";
    if (reply || msg.type === "here") this.peers.set(msg.id, this.now());
    else if (msg.type === "bye") this.peers.delete(msg.id);
    // Elect before answering, never after: the reply is what tells a returning
    // tab it may take the lock, so this tab must already have let go of it.
    this.#elect();
    if (reply) this.#say("here");
  }

  /** One heartbeat: forget the peers that missed the last rounds, then probe. */
  tick() {
    if (this.released) return;
    const cutoff = this.now() - this.ttlMs;
    for (const [id, seen] of this.peers) if (seen < cutoff) this.peers.delete(id);
    this.#elect();
    this.#say("ping");
  }

  /** Lowest id wins — deterministic, no negotiation round trips. */
  #elect() {
    const was = this.isWriter;
    let lowest = this.id;
    for (const id of this.peers.keys()) if (id < lowest) lowest = id;
    this.isWriter = lowest === this.id;
    if (this.isWriter !== was && this.onChange) this.onChange(this.isWriter);
  }

  /**
   * Give up the claim: tell the other tabs, and stop pretending to be live.
   *
   * `onChange` deliberately does not fire. This runs during `pagehide`, when
   * the document is either about to die — nobody is left to read a banner — or
   * about to be frozen, where the mutation would be painted on restore.
   */
  release() {
    if (this.released) return;
    this.released = true;
    /* The departing tab keeps permission to finish its OWN last write.

       Saving is asynchronous and `release()` is not: the editor issues its
       final flush from `beforeunload`, the write suspends on its first
       `await`, this runs, and the write then wakes up to find the lock gone
       and is refused — losing exactly the keystrokes the flush existed to
       save. It failed silently, because nobody is reading a "Not saved"
       badge on a page that is closing.

       Only if this tab actually held the lock: a read-only second tab must
       not gain write permission by being closed. And the window shuts again
       in `resume()`, so a document that comes back from the bfcache cannot
       write against whoever took the lock while it was frozen. */
    this.closing = this.isWriter;
    this.isWriter = false;
    this.#say("bye");
    if (this._timer != null) { this._clearInterval(this._timer); this._timer = null; }
  }

  /**
   * Come back after a `release()` that turned out not to be the end.
   *
   * The peers are kept, not cleared: dropping them would hand this tab the
   * lock optimistically for the millisecond before a live peer answered the
   * `hello`. Their clocks are only reset so a freeze does not read as death —
   * one that really is dead still expires on the ordinary schedule.
   *
   * Nor does it elect. Whoever took the lock while this tab was frozen holds
   * it legitimately; the `hello` this sends demotes them first, and the claim
   * comes back on the next heartbeat. Waiting one beat costs nothing next to
   * two tabs briefly believing they may both write.
   */
  resume() {
    if (!this.released || !this.ch) return;
    // The final-flush window closes here: the document is live again, so any
    // further write must win the lock properly rather than inherit it.
    this.closing = false;
    const t = this.now();
    for (const id of this.peers.keys()) this.peers.set(id, t);
    this.#start();
  }
}

// ── connect (5.2 / 5.3) ─────────────────────────────────────────────────────
// The directory handle is persisted in IndexedDB so the grant survives reloads;
// re-picking is only needed when the browser downgrades the permission.
//
// Every browser dependency is injected, so all three permission states are
// reachable in a test rather than only by clicking through Chrome.

export const PERSIST_KEY = "vault-root";
export const FINGERPRINT_KEY = "vault-fingerprint";

/**
 * Spike S7 found that a stored handle does NOT reliably mean "the same vault":
 * a handle follows a rename, and — worse — a handle whose directory was deleted
 * and replaced by a new one of the same name will happily write into the
 * replacement, with no error and no re-prompt. A user who lost their vault and
 * made a fresh folder would have the app silently adopt it.
 *
 * So identity is checked against the vault's own contents, not the handle.
 */
export async function vaultFingerprint(backend) {
  let files;
  try {
    files = await backend.listAll();
  } catch {
    // Unreadable is not the same as "different" — say nothing rather than
    // raising a false alarm that would block a legitimate reconnect.
    return { marker: null, markdownCount: null, name: null, unknown: true };
  }
  const md = files.filter((f) => f.path.endsWith(".md"));
  let marker = null;
  for (const name of ["CONVENTION.md", "CLAUDE.md"]) {
    try {
      const [fm] = parse(await backend.readText(name));
      if (fm.id) { marker = `${name}:${fm.id}`; break; }
    } catch { /* absent is itself information */ }
  }
  return { marker, markdownCount: md.length, name: backend.root ? backend.root.name : null };
}

/** True when `now` plausibly describes the same vault as `then`. */
export function sameVault(then, now) {
  if (!then || !now || then.unknown || now.unknown) return true;   // no evidence either way
  if (then.marker && now.marker) return then.marker === now.marker;
  // No marker either side: fall back to "did it become unrecognisably different".
  if (then.markdownCount > 0 && now.markdownCount === 0) return false;
  return true;
}

// Crockford base32 — the ULID alphabet. I, L, O and U are excluded so they
// cannot be confused with 1, 1, 0 and V.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A real ULID: 10 chars of millisecond timestamp, 16 of randomness, sortable.
 *
 * The previous generator was `Math.random().toString(36).toUpperCase()`, whose
 * alphabet is 0-9A-Z — so it emitted the four letters ULID forbids. 71% of the
 * ids it produced were rejected by this project's own validator, meaning a few
 * pages created in the app were enough to make the vault fail VERIFY.
 */
export function newUlid(now = Date.now()) {
  let t = "", ms = now;
  for (let i = 0; i < 10; i++) { t = B32[ms % 32] + t; ms = Math.floor(ms / 32); }
  let r = "";
  const bytes = (globalThis.crypto && globalThis.crypto.getRandomValues)
    ? globalThis.crypto.getRandomValues(new Uint8Array(16))
    : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  for (let i = 0; i < 16; i++) r += B32[bytes[i] % 32];
  return t + r;
}

/**
 * What the user must be told after a vault is stood up, in priority order.
 *
 * SPEC §4 requires duplicates be surfaced "rather than silently choosing".
 * buildIndex already writes a precise message for each — naming both paths and
 * which one wins — but nothing consumed them: `window.SB_WARNINGS` was assigned
 * and read by no one, so one page could shadow another invisibly, showing up
 * only as a page count that did not match the file count.
 *
 * Pure and exported so the wording is testable without a DOM.
 */
export function vaultNotices(isWriter, warnings = []) {
  const out = [];
  if (!isWriter) out.push("Another tab has the vault open for editing. This tab is read-only.");
  if (warnings.length === 1) out.push(warnings[0]);
  else if (warnings.length > 1) out.push(`${warnings.length} vault warnings, including: ${warnings[0]}`);
  return out;
}

/**
 * Classify the outcome of an interactive reconnect, so the UI has one place to
 * branch and the branching is testable without a DOM or a real picker.
 *
 * Two cases were wrong when this lived inline in bridge.js:
 *   - AbortError (the user dismissed the picker) was reported as
 *     "Could not open that folder", blaming the folder for a decision.
 *   - `granted` with no vault — the S7 different-vault refusal — matched no
 *     branch at all and threw nothing, so its explanatory message was computed
 *     and silently discarded.
 */
export function reconnectOutcome(result, error) {
  if (error) {
    if (error.name === "AbortError") return { act: "nothing" };
    return { act: "banner", text: "Could not open that folder." };
  }
  if (result && result.state === "granted" && result.vault) return { act: "connect" };
  return {
    act: "banner",
    text: (result && result.message) || "That folder could not be opened as a vault.",
  };
}

export async function connectVault(deps) {
  const {
    store,                        // {get(key), set(key, value)}
    picker,                       // () => Promise<FileSystemDirectoryHandle>
    queryPermission,              // (handle) => 'granted'|'prompt'|'denied'
    requestPermission,            // (handle) => 'granted'|'prompt'|'denied'
    interactive = false,          // true only inside a user gesture
    cache = null,                 // last-known index, for read-only rendering
  } = deps;

  let handle = await store.get(PERSIST_KEY);

  if (!handle) {
    if (!interactive) {
      return { state: "prompt", vault: null, handle: null, cache,
               reason: "no stored handle; picking needs a user gesture" };
    }
    handle = await picker();
    await store.set(PERSIST_KEY, handle);
  }

  let state = await queryPermission(handle);
  if (state !== "granted" && interactive) state = await requestPermission(handle);

  if (state === "granted") {
    const backend = new FSABackend(handle);
    // S7: the handle alone does not prove this is the same vault.
    const now = await vaultFingerprint(backend);
    const then = await store.get(FINGERPRINT_KEY).catch(() => null);
    if (!sameVault(then, now)) {
      return { state, handle, vault: null, cache, readOnly: true,
               reason: "different-vault",
               message: "This folder is not the vault this app was connected to. "
                      + "Nothing has been written. Reconnect to adopt it deliberately.",
               expected: then, found: now };
    }
    await store.set(FINGERPRINT_KEY, now).catch(() => {});
    return { state, handle, vault: new Vault(backend, deps.vaultOpts || {}) };
  }
  // SPEC §7: a cold open must never show an empty shell. Render the cached
  // index read-only behind a reconnect banner.
  return { state, handle, vault: null, cache, readOnly: true };
}

// ── the vault ───────────────────────────────────────────────────────────────

export class Vault {
  constructor(backend, opts = {}) {
    this.be = backend;
    this.index = new Map();          // id -> entry
    this.byPath = new Map();         // path -> entry
    /* Paths that are not pages here but still own their name in the vault —
       today, every `.canvas`. Naming reads this alongside `byPath`, because a
       wikilink resolves against files, not against what this app can open. */
    this.reservedNames = new Set();
    this.warnings = [];
    /* The same findings as `warnings`, in a shape something can act on.
       A sentence in a banner is a dead end: "duplicate filename Untitled" told
       you a thing was wrong and left the fixing to a file manager. Each entry
       here names the type, the files, and — for a collision — which name is
       contested, which is everything the resolve dialog needs to offer a
       rename. The strings stay because the banner, the clipper and
       `vaultNotices` all read them. */
    this.problems = [];
    this.historyKeep = opts.historyKeep ?? HISTORY_KEEP;
    this.election = opts.election ?? { isWriter: true };
    this.now = opts.now ?? (() => new Date().toISOString().replace(/\.\d+Z$/, "+00:00"));
    this.newId = opts.newId ?? newUlid;
    this._mtimes = new Map();
  }

  /**
   * May this tab write?
   *
   * Normally: only the elected writer. Plus one narrow case — a tab that held
   * the lock and is now closing keeps permission long enough to finish the
   * write it already started. Saving is async and `release()` is not, so
   * without this the editor's final flush is issued while the lock is held
   * and lands after it is gone. See `WriterElection.release`.
   */
  mayWrite() {
    return !!(this.election.isWriter || this.election.closing);
  }

  /** Record one finding twice: as the sentence the banner shows, and as the
   *  object the resolve dialog acts on. Never one without the other. */
  #flag(text, problem) {
    this.warnings.push(text);
    this.problems.push({ ...problem, text });
  }

  // 5.5 / 5.12 / 5.13 / 5.16 / 5.17
  async buildIndex() {
    const files = await this.be.listAll();
    const seenIds = new Map();
    const nextIndex = new Map();
    const nextByPath = new Map();
    this.warnings = [];
    this.problems = [];
    this.reservedNames = new Set();   // rebuilt from disk, like the index
    let reread = 0;

    const canvases = new Set(files.filter((f) => f.path.endsWith(".canvas")).map((f) => f.path));
    const mdPaths = new Set(files.filter((f) => f.path.endsWith(".md")).map((f) => f.path));

    for (const f of files) {
      const isMd = f.path.endsWith(".md");
      const isCanvas = f.path.endsWith(".canvas");
      if (!isMd && !isCanvas) continue;

      /* A `.canvas` is not a page.
       *
       * It used to be one: a bare JSON Canvas got its own index entry and its
       * own row. Then the reader for it was deleted — one kind, one format,
       * one editor, and that editor is the board — which left a row you could
       * open only to be told to open it somewhere else. So it is not listed,
       * not opened, and not counted.
       *
       * It is still REMEMBERED, and that part is not optional. Obsidian
       * resolves `[[Sketches]]` against every file in the vault, so
       * `Sketches.canvas` owns that name whether or not this app can show it.
       * Forget it and the app writes `notes/Sketches.md` beside it and makes
       * every `[[Sketches]]` in the vault ambiguous — silently, in files this
       * app did not write. `reservedNames` is how naming still sees it, and
       * `rename`/`del` still carry a sidecar along with its page.
       */
      if (isCanvas) {
        // A sidecar beside its own `.md` is the documented pair, not a
        // collision — the page already owns that name, and reserving it again
        // would report every legacy board in the vault as ambiguous with
        // itself. Only a `.canvas` standing alone needs the reservation.
        const sibling = f.path.replace(/\.canvas$/, ".md");
        if (!mdPaths.has(sibling)) this.reservedNames.add(f.path);
        continue;
      }

      // 5.9 — reuse the cached entry when mtime is unchanged.
      const cached = this.byPath.get(f.path);
      if (cached && this._mtimes.get(f.path) === f.mtime) {
        nextIndex.set(cached.id, cached);
        nextByPath.set(f.path, cached);
        continue;
      }
      reread++;

      let text, entry;
      try {
        text = await this.be.readText(f.path);
      } catch (e) {
        // 5.17(b) — non-UTF-8. The walk must complete.
        entry = this.#stub(f, `unreadable: ${e.message}`);
        nextIndex.set(entry.id, entry); nextByPath.set(f.path, entry);
        this._mtimes.set(f.path, f.mtime);
        continue;
      }

      let fm = {}, body = text;
      let unparseable = null;
      try {
        [fm, body] = parse(text);
        // 5.17(c) — an unterminated `---` yields no frontmatter but must not throw.
        if (text.startsWith("---\n") && !Object.keys(fm).length) {
          unparseable = "unterminated frontmatter block";
        }
      } catch (e) {
        unparseable = `frontmatter: ${e.message}`;
        fm = {}; body = text;
      }

      const stamped = REQUIRED.every((k) => fm[k]);
      const id = fm.id || `path:${f.path}`;
      const fmTags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
      const isExcalidraw = isExcalidrawPath(f.path);
      entry = {
        id,
        // For a drawing the extension is authoritative: a stray `kind:` in the
        // frontmatter must not turn one into a note we would then render as
        // 300 characters of base64.
        kind: isExcalidraw ? "canvas" : (fm.kind || inferKind(f.path)),
        path: f.path,
        title: fm.title || titleFromPath(f.path),
        tags: [...new Set([...fmTags, ...extractInlineTags(body)])],
        aliases: Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : [],
        mentions: [...new Set([...String(body).matchAll(/!?\[\[([^\]|#]+)/g)].map((m) => m[1].trim()))],
        // The prose only. An excerpt is what a list row shows, and a topic
        // whose description is short would otherwise be described by whatever
        // was pasted into its attachments tray.
        excerpt: excerptOf(unescapeUser(
          isExcalidraw ? stripExcalidrawData(body) : splitSections(body).prose)),
        // The drawing's own words, kept OUT of the excerpt on purpose: the
        // excerpt is what a list row shows, and a row reading "Fold Gather Sew"
        // describes the picture rather than the page. Searchable, not visible.
        sceneText: isExcalidraw ? textOfExcalidraw(body) : "",
        // Indexed so "bookmarks" can be a list without opening every note:
        // a bookmark IS a note with a url, and the list must know which ones.
        //
        // `??`, not `||`: the PRESENCE of the key is the fact, which is why
        // every reader downstream asks `url != null`. Hoisting `url: ""` to
        // null flattened that distinction and dropped the one page that needs
        // it most — a bookmark with no link yet — out of the Bookmark list and
        // count while the page itself still opened with bookmark chrome.
        url: fm.url ?? null,
        /* Structural references, kept RAW — CONVENTION writes them as quoted
           wikilinks (`parent: "[[X]]"`) and resolving one needs the whole
           index, which does not exist yet halfway through the walk. `data.js`
           turns them into ids on the way out. Indexed rather than read per
           page because the parent's sub-page list is a scan: a child names
           its parent, and nothing names its children. */
        parent: fm.parent || null,
        children: Array.isArray(fm.children) ? fm.children
          : fm.children ? [fm.children] : [],
        updated: fm.updated || null,
        mtime: f.mtime,
        stamped,
        unparseable,
      };

      if (seenIds.has(id)) {
        // 5.12 — duplicate id. Warn naming both paths; get() resolves to the
        // lexicographically first path, deterministically.
        const other = seenIds.get(id);
        this.#flag(
          `duplicate id ${id}: ${other} and ${f.path} — get() resolves ${[other, f.path].sort()[0]}`,
          { type: "duplicate-id", id, paths: [other, f.path],
            resolves: [other, f.path].sort()[0] });
        if ([other, f.path].sort()[0] === other) {
          this._mtimes.set(f.path, f.mtime);
          nextByPath.set(f.path, entry);
          continue;
        }
      }
      seenIds.set(id, f.path);
      nextIndex.set(id, entry);
      nextByPath.set(f.path, entry);
      this._mtimes.set(f.path, f.mtime);
    }

    // Duplicate filenames. This is the collision that actually costs something:
    // Obsidian resolves `[[Name]]` by basename, so two files sharing one — in
    // any two folders, in either app — make every link to that name ambiguous.
    // Pages FIRST, then the reserved non-page files, so the warning names the
    // page as the one already holding the name. A `.canvas` stopped being a
    // page here but did not stop being a file Obsidian resolves against — read
    // only the index and `Untitled.canvas` beside `topics/Untitled.md` goes
    // unreported, which is the one collision the warning exists for.
    const byBase = new Map();
    for (const p of [...[...nextIndex.values()].map((e) => e.path), ...this.reservedNames]) {
      const base = basenameOf(p);
      const k = base.toLowerCase();
      if (byBase.has(k)) {
        this.#flag(
          `duplicate filename "${base}": ${byBase.get(k)} and ${p} — [[${base}]] is ambiguous`,
          { type: "duplicate-filename", name: base, paths: [byBase.get(k), p] });
      } else byBase.set(k, p);
    }

    // duplicate titles (SPEC §7) — cosmetic by comparison, and reported only
    // when the filenames differ, so one collision is never two warnings.
    const byTitle = new Map();
    for (const e of nextIndex.values()) {
      const k = (e.title || "").toLowerCase();
      const first = byTitle.get(k);
      if (first === undefined) { byTitle.set(k, e.path); continue; }
      if (basenameOf(first).toLowerCase() === basenameOf(e.path).toLowerCase()) continue;
      this.#flag(`duplicate title "${e.title}": ${first} and ${e.path}`,
        { type: "duplicate-title", title: e.title, paths: [first, e.path] });
    }

    /* A file the parser could not read is a problem the dialog must show — it
       is the one kind the app refuses to write over, so it is also the one a
       user can be stuck on for good. It is deliberately NOT a warning: the
       banner counts collisions, and a broken file needs a different sentence
       than "two files share a name". */
    for (const e of nextIndex.values()) {
      if (e.unparseable) {
        this.problems.push({ type: "unreadable", paths: [e.path], why: e.unparseable,
          text: `${e.path} could not be read: ${e.unparseable}` });
      }
    }

    for (const p of this.byPath.keys()) if (!nextByPath.has(p)) this._mtimes.delete(p);
    this.index = nextIndex;
    this.byPath = nextByPath;
    this.lastReread = reread;
    return { entries: nextIndex.size, reread, warnings: this.warnings };
  }

  #stub(f, why) {
    return {
      id: `path:${f.path}`, path: f.path, kind: inferKind(f.path),
      title: f.path.split("/").pop().replace(/\.md$/, ""),
      tags: [], aliases: [], mentions: [], excerpt: "",
      parent: null, children: [],
      updated: null, mtime: f.mtime, stamped: false, unparseable: why,
    };
  }

  list() { return [...this.index.values()]; }

  async get(id) {
    const e = this.index.get(id);
    if (!e) return null;
    if (e.bare) return { ...e, body: "", canvas: await this.be.readText(e.path) };
    const text = await this.be.readText(e.path);
    const [fm, body] = parse(text);
    // A canvas or inspo page keeps its geometry in a `.canvas` sibling, and only
    // the *bare* case attached it. So an ordinary board — the common one, two
    // files — reached the view with nothing to draw and rendered empty. SPEC §10
    // requires the app to render boards read-only, which is not the same as not
    // rendering them.
    const sibling = e.path.endsWith(".md") ? e.path.replace(/\.md$/, ".canvas") : null;
    const canvas = sibling && await this.be.exists(sibling)
      ? await this.be.readText(sibling) : null;
    // CONVENTION's five structural headings are not prose, so they are not
    // `body`: a caller that reads a page and writes it back — retitle, re-id,
    // restore — would otherwise hand the section text to `put()` as user
    // content and watch the escape backslash every heading in it. The prose
    // comes out unescaped as it always did; `sections` stays exactly as the
    // file has it, because that is the form every reader of it expects.
    const split = splitsSections(e.path) ? splitSections(body) : { prose: body, sections: "" };
    return { ...e, frontmatter: fm, body: unescapeUser(split.prose),
             sections: split.sections, raw: text,
             ...(canvas !== null && { canvas }) };
  }

  // 5.6 / 5.14 / 5.17 / 5.19 / 5.20 / 5.23
  async put(page) {
    if (!this.mayWrite()) {
      return { ok: false, reason: "not-writer", message: "another tab holds the write lock" };
    }
    // Resolve by PATH first when one is given. Resolving by id is wrong here: a
    // conflict copy keeps the original's id and sorts before it, so an id lookup
    // can hand back a different file than the one being written — and then the
    // conflict check compares against the wrong `updated` and silently passes.
    const entry = (page.path && this.byPath.get(page.path)) || this.index.get(page.id);
    const resolved = page.path || entry?.path;
    if (!resolved) return { ok: false, reason: "no-path" };

    if (entry?.unparseable) {
      return { ok: false, reason: "unparseable",
               message: `refusing to write over a file we could not parse: ${entry.unparseable}` };
    }

    // 5.15 — a bare `.canvas` gains its `.md` on the first write, exactly as the
    // index promises. Everything below serializes frontmatter + body, which is
    // not what a JSON Canvas holds: writing it *to* the `.canvas` replaced the
    // user's nodes and edges with a YAML header, and the geometry that prompted
    // the save was discarded in the same breath. Obsidian owns that file; we add
    // the sibling beside it and leave the JSON untouched. `get()` already reads
    // the pair, and rename() / trash() already move them together, so this is
    // the shape the rest of the vault was written for.
    const bare = resolved.endsWith(".canvas");
    const path = bare ? resolved.replace(/\.canvas$/, ".md") : resolved;

    /* Prevention, at the last gate every write passes through.
       `data.create` walks `freeStem` before it picks a path, so nothing the app
       offers should ever land here — but "should" is how `projects/X/X.md` came
       to be written without that walk, and how a name already owned by a bare
       `.canvas` became a second file answering to `[[Sketches]]`. A new file at
       a taken basename is refused by name, with the file that holds it named,
       rather than quietly making every link to that name ambiguous. Only NEW
       files: an existing one keeps its own name, collision or not, because
       refusing to save it would strand the user's edit over a problem they did
       not just cause. */
    if (!entry && !(await this.be.exists(path))) {
      // `basenameOf`, the same reading the duplicate-filename check uses — this
      // guard exists to stop exactly what that check reports.
      const base = basenameOf(path).toLowerCase();
      // A bare `.canvas` gaining its `.md` (5.15) is the documented pair, not a
      // collision: the sidecar reserved that name and this write is the page
      // that owns it arriving. Refusing here would make the redirect above
      // unreachable — which is what it did.
      const sidecar = path.replace(/\.md$/, ".canvas");
      const held = [...this.byPath.keys(), ...this.reservedNames]
        .find((p) => p !== path && p !== sidecar && basenameOf(p).toLowerCase() === base);
      if (held) {
        return { ok: false, reason: "name-taken", path, held,
                 message: `${held} already answers to [[${basenameOf(path)}]]` };
      }
    }

    // 5.19 — conflict check FIRST, so a refused write leaves no history.
    const onDisk = await this.be.stat(path);
    if (onDisk && entry) {
      // Obsidian is a text editor: it rewrites the body and leaves `updated`
      // exactly as it found it. Comparing only that field made every edit made
      // in Obsidian invisible here, so the next save from the app destroyed it
      // without a word — the one thing CONVENTION promises never happens.
      //
      // mtime moves on any write, whoever made it, so it is the check that
      // actually holds. `updated` stays as a second signal, for a backend whose
      // mtime is coarse or for a file re-saved within the same clock tick.
      let changed = entry.mtime != null && onDisk.mtime !== entry.mtime;
      if (!changed && entry.updated) {
        const [curFm] = parse(await this.be.readText(path));
        changed = !!(curFm.updated && curFm.updated !== entry.updated);
      }
      if (changed && !page.force) {
        return { ok: false, reason: "conflict", path,
                 message: "changed on disk — reload or overwrite" };
      }
      if (changed && page.force) {
        const day = this.now().slice(0, 10);
        let dest = path.replace(/\.md$/, ` (conflict ${day}).md`);
        let n = 2;
        while (await this.be.exists(dest)) {           // 5.18
          dest = path.replace(/\.md$/, ` (conflict ${day} ${n++}).md`);
        }
        await this.be.writeBytes(dest, await this.be.readBytes(path));
      }
    }

    // history AFTER the conflict gate (5.19), keyed by id so renames keep it
    if (onDisk) {
      const key = (page.id || entry?.id || path).replace(/[/:]/g, "_");
      const dir = `.history/${key}`;
      await this.be.writeBytes(`${dir}/${stamp(this.now())}.md`, await this.be.readBytes(path));
      const kept = (await this.be.listDir(dir)).sort();
      for (const old of kept.slice(0, Math.max(0, kept.length - this.historyKeep))) {
        await this.be.remove(old);
      }
    }

    // 5.14 — lazy stamping: exactly id, kind, created on first write, nothing else.
    const fm = { ...(page.frontmatter || {}) };
    // `path:` and `canvas:` are both synthetic ids the index minted for a file
    // that carried none. Neither is a ULID, so neither may reach disk.
    const synthetic = (v) => /^(path|canvas):/.test(String(v));
    if (!fm.id) fm.id = page.id && !synthetic(page.id) ? page.id : this.newId();
    if (!fm.kind) fm.kind = page.kind || inferKind(path);
    if (!fm.created) fm.created = this.now();
    if (!fm.title) fm.title = page.title || path.split("/").pop().replace(/\.md$/, "");
    fm.updated = this.now();

    /* The seam the structural sections need.
       `escapeUser` treats the body as user prose and backslashes any of
       CONVENTION's five headings in it — which is right, and is exactly why a
       section cannot be composed above this line. So the caller passes it
       separately and it is appended verbatim, already escaped where its own
       content needed escaping (see attachments.js).

       Omitting `sections` PRESERVES what is on disk. Most writers here —
       retitle, re-id, createTag — have no idea a page has an attachments tray,
       and a default of "drop it" would make every one of them a way to lose
       one. Passing `""` is how a caller says it means to clear them. */
    let sections = page.sections;
    if (sections === undefined) {
      sections = onDisk && splitsSections(path)
        ? splitSections(parse(await this.be.readText(path))[1]).sections : "";
    }
    const text = serialize(fm, joinBody(escapeUser(page.body ?? ""), sections));
    try {
      await this.be.writeText(path, text);
    } catch (e) {
      // Spike S6: a full volume throws QuotaExceededError from createWritable.
      // Surface it as a refusal — the history snapshot and the original file are
      // both already safe, so this is recoverable, not corruption.
      if (e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""))) {
        return { ok: false, reason: "quota", path,
                 message: "no space left — the file on disk is unchanged" };
      }
      throw e;
    }

    // Keep the index honest about what is now on disk, so the next write from
    // this same session does not read its own change as somebody else's and
    // refuse. Deliberately NOT `_mtimes`: that map is what buildIndex uses to
    // decide an entry can be reused unparsed, so seeding it here would make the
    // rebuild skip the file and serve back the values we just replaced.
    // Not for the bare case: `entry` still describes the `.canvas`, and stamping
    // the sibling's mtime onto it would make the next rebuild misjudge the JSON.
    // The caller rebuilds the index straight after, which is what picks up the
    // new `.md` and retires the synthetic `canvas:` entry.
    const after = await this.be.stat(path);
    if (after && entry && !bare) {
      entry.mtime = after.mtime;
      entry.updated = fm.updated;
    }
    return { ok: true, path, id: fm.id, bytes: text.length, ...(bare && { adopted: resolved }) };
  }

  /**
   * Move a page to a new path, taking its `.canvas` sibling along.
   *
   * The index is updated in place because the caller usually writes again right
   * after: FSA has no rename, so `move` is a copy-and-delete and the file at the
   * new path carries a *new* mtime that the 5.19 conflict gate would otherwise
   * read as somebody else's edit and refuse. `_mtimes` is deliberately dropped
   * rather than reseeded, so the next `buildIndex` rereads the file instead of
   * trusting a cached entry whose title we may just have changed.
   *
   * Refuses rather than overwrites: a name already on disk belongs to somebody.
   */
  async rename(id, toPath) {
    if (!this.mayWrite()) {
      return { ok: false, reason: "not-writer", message: "another tab holds the write lock" };
    }
    const e = this.index.get(id);
    if (!e) return { ok: false, reason: "unknown-id" };
    const from = e.path;
    if (toPath === from) return { ok: true, path: from, from };
    if (await this.be.exists(toPath)) return { ok: false, reason: "exists", path: toPath };

    const sib = from.endsWith(".md") ? from.replace(/\.md$/, ".canvas") : null;
    const toSib = sib && toPath.endsWith(".md") ? toPath.replace(/\.md$/, ".canvas") : null;
    const hasSib = sib ? await this.be.exists(sib) : false;
    if (hasSib && !toSib) return { ok: false, reason: "would-orphan-canvas", path: sib };
    if (hasSib && await this.be.exists(toSib)) return { ok: false, reason: "exists", path: toSib };

    await this.be.move(from, toPath);
    if (hasSib) await this.be.move(sib, toSib);

    this.byPath.delete(from);
    this._mtimes.delete(from);
    e.path = toPath;
    this.byPath.set(toPath, e);
    const after = await this.be.stat(toPath);
    if (after) e.mtime = after.mtime;
    return { ok: true, path: toPath, from, ...(hasSib && { canvas: toSib }) };
  }

  // 5.7 / 5.18
  async del(id) {
    const e = this.index.get(id);
    if (!e) return { ok: false, reason: "unknown-id" };

    // A canvas or inspo page is *two* files on disk: `<name>.md` and
    // `<name>.canvas`. Trashing only the markdown orphaned the canvas — it
    // stayed visible in Obsidian, and the next page created under that name
    // silently inherited someone else's board. Move the pair together, and
    // give both the same collision suffix so they stay paired in `.trash/`.
    const sib = e.path.endsWith(".md") ? e.path.replace(/\.md$/, ".canvas") : null;
    const hasSib = sib ? await this.be.exists(sib) : false;

    const suffixed = (p, s) => p.replace(/(\.[^./]+)$/, `${s}$1`);
    const at = (s) => ({
      md: `.trash/${suffixed(e.path, s)}`,
      canvas: hasSib ? `.trash/${suffixed(sib, s)}` : null,
    });

    let n = 2, dest = at("");
    while (await this.be.exists(dest.md)
        || (dest.canvas && await this.be.exists(dest.canvas))) {
      dest = at(` ${n++}`);
    }

    await this.be.move(e.path, dest.md);
    if (hasSib) await this.be.move(sib, dest.canvas);
    this.index.delete(id);
    this.byPath.delete(e.path);
    return { ok: true, trashed: dest.md, ...(hasSib && { trashedCanvas: dest.canvas }) };
  }

  /* Every overwrite has snapshotted to `.history/<id>/<stamp>.md` since 5.19
     and nothing has ever been able to list or read one — the same shape of
     invisibility `.trash/` had. These two make the second half of the write
     safety reachable.

     Keyed by id rather than path, so a rename keeps the history with the
     page it belongs to. */
  #historyDir(id) { return `.history/${String(id).replace(/[/:]/g, "_")}`; }

  async history(id) {
    const dir = this.#historyDir(id);
    let names = [];
    try { names = await this.be.listDir(dir); } catch (_) { return []; }
    return names
      .filter((n) => n.endsWith(".md"))
      .sort()
      .reverse()                       // newest first — that is what you want back
      .map((full) => ({
        path: full,
        // `<dir>/2026-08-15T17-04-02.md` → the stamp, which is the only
        // metadata a snapshot carries.
        stamp: full.split("/").pop().replace(/\.md$/, ""),
      }));
  }

  async readHistory(snapshotPath) {
    if (!String(snapshotPath).startsWith(".history/")) {
      return { ok: false, reason: "not-a-snapshot" };
    }
    try {
      const text = await this.be.readText(snapshotPath);
      // Parse here, where mdfile already lives. Handing the raw file to the
      // UI meant restoring pasted the snapshot's own `---` frontmatter block
      // into the page body — the id and kind of a past version, as prose.
      // parse() returns a TUPLE [frontmatter, body], not an object — reading
      // `.body` off it silently yielded undefined and the restore would have
      // written the whole file, frontmatter and all, into the page body.
      const [frontmatter, raw] = parse(text);
      // Split and unescape exactly as `get()` does. Restoring used to paste
      // the snapshot's escaped body straight back into the page — a version
      // with an attachments tray came back as `\## Attachments` in the prose,
      // and the tray itself did not come back at all.
      // A snapshot is named by stamp, not by extension, so the board case is
      // read from the marker CONVENTION gives it rather than from the path.
      const { prose, sections } = frontmatter["excalidraw-plugin"] != null
        ? { prose: raw, sections: "" } : splitSections(raw);
      return { ok: true, text, body: unescapeUser(prose), sections, frontmatter };
    } catch (e) {
      return { ok: false, reason: "unreadable", message: String(e.message || e) };
    }
  }

  /* Undo a del(). Takes exactly what del() handed back.
     `.trash/` has existed since 5.7 and nothing has ever been able to come
     back out of it — the safety was real and completely invisible, so from
     the user's side deleting was indistinguishable from destroying. This is
     a plain move back, refusing if something has since taken the old path so
     a restore can never overwrite a live file. */
  async untrash({ trashed, trashedCanvas, path, canvasPath } = {}) {
    if (!this.mayWrite()) return { ok: false, reason: "not-writer" };
    if (!trashed || !path) return { ok: false, reason: "nothing-to-restore" };
    if (!(await this.be.exists(trashed))) return { ok: false, reason: "gone-from-trash" };
    if (await this.be.exists(path)) return { ok: false, reason: "path-taken" };

    await this.be.move(trashed, path);
    if (trashedCanvas && canvasPath && await this.be.exists(trashedCanvas)) {
      await this.be.move(trashedCanvas, canvasPath);
    }
    await this.buildIndex();
    const restored = this.byPath.get(path);
    return { ok: true, path, id: restored ? restored.id : null };
  }

  async readBlob(path) { return this.be.readBytes(path); }
  async writeBlob(path, bytes) {
    if (!this.mayWrite()) return { ok: false, reason: "not-writer" };
    try {
      await this.be.writeBytes(path, bytes);
    } catch (e) {
      if (e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""))) {
        return { ok: false, reason: "quota", path, message: "no space left" };
      }
      throw e;
    }
    return { ok: true, path };
  }

  // 5.9 / 5.21
  async watchExternal() {
    const before = new Map([...this.byPath].map(([p, e]) => [p, e.mtime]));
    const r = await this.buildIndex();
    const after = new Map([...this.byPath].map(([p, e]) => [p, e.mtime]));
    const created = [...after.keys()].filter((p) => !before.has(p));
    const removed = [...before.keys()].filter((p) => !after.has(p));
    return { ...r, created, removed,
             changed: [...after].filter(([p, m]) => before.has(p) && before.get(p) !== m).map(([p]) => p) };
  }
}
