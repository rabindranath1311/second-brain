// The popup: one property list, aimed by the destination at the top of it.
//
// The order is the design, and it is the same order every time:
//
//   1. where it goes        Note · Bookmark · Inspo
//   2. what it is           title, source, author, description, site, note,
//                           tags, mentions — one continuous list, one row shape
//   3. the picture          the only thing here that is not typed
//   4. which file it joins  a new page, or the bottom of one you already have
//   5. save                 anchored to the bottom, never scrolled away
//
// Destinations differ only in which rows they use. Inspo has no title and no
// byline because a wall item has neither — it is a picture with a caption — but
// the rows it does have look exactly like everyone else's.
//
// Every value on screen was written by the page, which is why every one is
// editable: a title is a filename here, and `(6) Home` is a filename nobody
// wants. The line under it shows the name the file will get, and says when that
// name is taken — the alternative is owning three pages called `Canon Vault 2`.
//
// No writing happens here. The popup asks the service worker, because the queue
// has to be written by whoever is still alive when the popup closes, and a
// popup closes the moment you look away from it.

const $ = (id) => document.getElementById(id);

/** Talk to the worker; a dead worker becomes an answer, never a silent button. */
async function send(type, extra = {}) {
  try {
    const r = await chrome.runtime.sendMessage({ type, ...extra });
    return r ?? { ok: false, reason: "the background worker did not answer" };
  } catch (e) {
    return { ok: false, reason: "worker",
             message: "The clipper's background worker is not responding — "
                    + "reload it at chrome://extensions." };
  }
}

const DEST_KEY = "lastDest";

const wallName = (s) => ($("wall") && $("wall").value.trim())
  || (s && s.settings && s.settings.wall) || "Interface Inspiration";

/**
 * What each destination is: the rows it shows, the picture it can carry, and
 * which pages it will let you add to.
 *
 * `accepts` is the answer to "add to a page — which pages?". A note joins a
 * note, a bookmark joins a bookmark, a picture joins a wall. Offering all of
 * them everywhere was offering to append a wall item to a bookmark, which
 * parses as nothing on either side.
 */
const DEST = {
  note: {
    verb: "Save note", folder: "notes/",
    where: () => "→ notes/ — a page you can write on",
    rows: ["title", "source", "author", "description", "site", "note", "tags", "mentions"],
    picture: "optional", highlight: true, noteLabel: "note",
    accepts: (p) => p.kind === "note" && p.url == null, acceptsWhat: "notes",
  },
  bookmark: {
    verb: "Save bookmark", folder: "notes/",
    where: () => "→ notes/ — the site kept as a card",
    rows: ["title", "source", "author", "description", "site", "note", "tags", "mentions"],
    picture: "none", highlight: false, noteLabel: "note",
    accepts: (p) => p.kind === "note" && p.url != null, acceptsWhat: "bookmarks",
  },
  inspo: {
    verb: "Save to wall", folder: "inspo/",
    where: (s) => `→ inspo/${wallName(s)}`,
    rows: ["note", "tags", "mentions", "source"],
    picture: "required", highlight: false, noteLabel: "caption",
    accepts: (p) => p.kind === "inspo", acceptsWhat: "walls",
  },
};

const ROW_IDS = {
  title: "row-title", source: "row-source", author: "row-author",
  description: "row-description", site: "row-site", note: "row-note",
  tags: "row-tags", mentions: "row-mentions",
};

let tab = null;
let meta = null;
let state = null;
let pending = null;
let dest = "bookmark";
let picture = "none";
let mode = "new";          // "new" | "append"
let chosen = null;         // the page an append is aimed at
let pickedImage = null;    // the src of an image a right-click pointed at
let mentions = [];         // page titles this capture links to
/* Is there anything new to save?
   The form used to sit there fully loaded after a save — same title, same
   note, same target — with Save straight back to enabled and Enter still
   bound to it from every single-line field. So the second press filed the
   same clip again, and the popup gave no sign that the first one had landed
   beyond one line of status text. Clearing the form is half the answer;
   this is the other half, because a blanked form still saves a duplicate
   bookmark of the page you are standing on. Save is armed when there is
   something new in the form, and a save disarms it. */
let armed = true;
let busy = false;          // a write is in the air
/* Some pages Chrome will not let an extension read at all. That used to be
   enforced by poking `disabled` on the button once, during init — and any
   later repaint (the page list arriving, a destination change) put it back.
   It is a state, so it lives with the other two. */
let savable = true;

/* The Save button's whole state, in one place: what it says and whether it
   can fire. "Saved" rather than a dead "Save note" — a disabled button with
   its old label on it looks broken, and this one is not broken, it is done. */
function paintSave() {
  const d = DEST[dest];
  $("save").disabled = busy || !armed || !savable;
  $("save").textContent = armed ? d.verb : "Saved";
  $("save").title = armed ? "" : "Already saved — change something to save again";
}

/** Anything the user typed or toggled means there is something new again. */
function rearm() {
  if (armed) return;
  armed = true;
  paintSave();
}

function status(text, tone = "") {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${tone}`;
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; }
}

function openSetup(hash = "") {
  if (hash) chrome.tabs.create({ url: chrome.runtime.getURL(`vault.html${hash}`) });
  else chrome.runtime.openOptionsPage();
  window.close();
}

/** The vault chip is the honest one-glance answer to "will this be saved?" —
 *  and when the answer is no, the banner below says why and fixes it. */
function paintVault() {
  const chip = $("vault-chip");
  const banner = $("vault-banner");
  const v = state.vault || {};

  if (!v.name) {
    chip.textContent = "Connect vault";
    chip.className = "chip warn";
    banner.classList.remove("hidden");
    $("banner-title").textContent = "No vault connected";
    $("banner-why").textContent = "Clips are kept safely here until you pick a folder.";
    $("banner-do").textContent = "Connect";
    banner.dataset.hash = "";
    return;
  }
  if (v.permission !== "granted") {
    chip.textContent = `${v.name} — locked`;
    chip.className = "chip warn";
    banner.classList.remove("hidden");
    $("banner-title").textContent = `${v.name} is locked`;
    $("banner-why").textContent = "Chrome drops folder access between sessions. One click restores it.";
    $("banner-do").textContent = "Unlock";
    banner.dataset.hash = "#unlock";
    return;
  }
  chip.textContent = v.name;
  chip.className = "chip";
  banner.classList.add("hidden");
}

/** Saves that have not landed. The count, the first reason, and the retry. */
function paintWaiting() {
  const items = state.pending || [];
  $("waiting").classList.toggle("hidden", !items.length);
  if (!items.length) return;
  $("waiting-what").textContent = items.length === 1
    ? "1 unfinished save" : `${items.length} unfinished saves`;
  const failed = items.find((r) => r.error);
  $("waiting-why").textContent = failed ? failed.error
    : "Kept here until the vault can be written.";
}

/** Saves that did land. Three of them: enough to answer "did that work?", not
 *  so many that the form is pushed off the screen by its own history. */
function paintRecent() {
  const items = (state.recent || []).slice(0, 3);
  $("recent-box").classList.toggle("hidden", !items.length);
  const box = $("recent");
  box.textContent = "";
  for (const r of items) {
    const row = document.createElement("div");
    row.className = "item";
    const what = document.createElement("div");
    what.className = "grow truncate";
    what.textContent = r.title || r.path || "";
    const where = document.createElement("div");
    where.className = "tiny muted truncate mono";
    where.style.maxWidth = "150px";
    where.textContent = r.skipped ? `already in ${r.path}` : r.path || "";
    row.append(what, where);
    box.appendChild(row);
  }
}

function seg(box, key, value) {
  for (const b of box.querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset[key] === value);
  }
}

/**
 * The filename this title will get, and whether something already owns it.
 *
 * The vault's own rule, applied early: strip what a filesystem refuses, and if
 * the name is taken anywhere in the vault — not just in this folder, because
 * that is how `[[Wikilinks]]` resolve — a number is appended. Saying so here
 * turns a surprise into a decision.
 */
function paintName() {
  const d = DEST[dest];
  const hint = $("name-hint");
  const relevant = d.rows.includes("title") && mode === "new";
  hint.classList.toggle("hidden", !relevant);
  if (!relevant) return;
  const raw = $("title").value.trim();
  const stem = raw.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  if (!stem) {
    hint.textContent = `${d.folder}Note ${new Date().toISOString().slice(0, 10)}.md`;
    hint.className = "prop-hint";
    return;
  }
  const taken = (state.pages || []).some(
    (p) => String(p.title || "").toLowerCase() === stem.toLowerCase());
  hint.textContent = taken
    ? `${d.folder}${stem} 2.md — “${stem}” is taken`
    : `${d.folder}${stem}.md`;
  hint.className = taken ? "prop-hint is-taken" : "prop-hint";
}

/** A page list, filtered and drawn. Shared by the two searches. */
function drawHits(box, hits, onPick, empty) {
  box.textContent = "";
  if (!hits.length) {
    box.appendChild(Object.assign(document.createElement("div"),
      { className: "item muted tiny", textContent: empty }));
    return;
  }
  for (const p of hits) {
    const row = document.createElement("button");
    row.className = "item pick";
    row.type = "button";
    const t = document.createElement("span");
    t.className = "grow truncate";
    t.textContent = p.title;
    const k = document.createElement("span");
    k.className = "tiny muted";
    k.textContent = p.url != null ? "bookmark" : p.kind;
    row.append(t, k);
    row.addEventListener("click", () => onPick(p));
    box.appendChild(row);
  }
}

/* The walls the vault actually has, offered to the `wall` field.
   The <datalist> has been in the markup since the field existed and nothing
   ever filled it: the names were cached on every flush, the input advertised
   them with `list="walls"`, and the dropdown was empty every time. So naming
   a wall meant remembering it exactly, and one typo made a second wall
   instead of adding to the first — which is the one mistake this field is
   shaped to prevent. */
function paintWalls() {
  const dl = $("walls");
  dl.textContent = "";
  for (const w of state.walls || []) {
    const o = document.createElement("option");
    o.value = w.title;
    dl.appendChild(o);
  }
}

/* Why the list is empty, when it is — and it is never "no pages by that name"
   unless there were pages to look through. A blank list under a blank reason
   is how "I cannot save to an existing page" starts: the folder is locked, or
   the cached list has not been read yet, and the form said neither. */
function pickEmpty(d, q, pool) {
  const v = (state && state.vault) || {};
  if (!v.name) return "Connect a vault above and your pages appear here.";
  if (v.permission !== "granted") return "Unlock the vault above to see your pages.";
  if (!(state.pages || []).length) return "Reading your vault…";
  if (!pool.length) return `No ${d.acceptsWhat} in the vault yet.`;
  return q ? `No ${d.acceptsWhat} by that name.` : "";
}

/* Typing narrows; typing nothing shows the most recently touched, because the
   page you want to add to is usually the page you were just in. `pageList` is
   already sorted newest-first, so this is a slice, not a sort. */
function paintPicks() {
  const d = DEST[dest];
  const q = $("pick").value.trim().toLowerCase();
  const pool = (state.pages || []).filter(d.accepts);
  const hits = (q ? pool.filter((p) => String(p.title || "").toLowerCase().includes(q)) : pool)
    .slice(0, 6);
  drawHits($("pick-results"), hits, (p) => {
    chosen = p;
    $("pick").value = "";
    armed = true;
    paintForm();
  }, pickEmpty(d, q, pool));
}

/** Mentions may point anywhere — a link is not an append, and the graph is not
 *  filtered by kind. */
function paintMentionSearch() {
  const q = $("mention").value.trim().toLowerCase();
  if (!q) { $("mention-results").textContent = ""; return; }
  const hits = (state.pages || [])
    .filter((p) => String(p.title || "").toLowerCase().includes(q))
    .filter((p) => !mentions.includes(p.title))
    .slice(0, 5);
  drawHits($("mention-results"), hits, (p) => {
    mentions = [...mentions, p.title];
    $("mention").value = "";
    armed = true;
    paintForm();
  }, "No page by that name.");
}

function paintChips() {
  const box = $("mention-chips");
  box.textContent = "";
  box.classList.toggle("hidden", !mentions.length);
  for (const name of mentions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip mention-chip";
    chip.title = "Remove";
    chip.textContent = `[[${name}]] ✕`;
    chip.addEventListener("click", () => {
      mentions = mentions.filter((m) => m !== name);
      armed = true;
      paintForm();
    });
    box.appendChild(chip);
  }
}

/** Repaint everything that follows from the destination and the mode. */
function paintForm() {
  const d = DEST[dest];
  seg($("dest"), "dest", dest);
  seg($("mode"), "mode", mode);
  $("dest-where").textContent = d.where(state);
  $("note-label").textContent = d.noteLabel;
  $("mode-new").textContent = dest === "inspo" ? "A wall" : "New page";

  $("props").classList.toggle("is-inspo", dest === "inspo");
  // One list, one rule: a row is on screen when this destination has that row,
  // and a title is not a thing you give to a page that already exists.
  for (const [row, id] of Object.entries(ROW_IDS)) {
    const on = d.rows.includes(row) && !(row === "title" && mode === "append");
    $(id).classList.toggle("hidden", !on);
  }

  const has = Boolean(meta && meta.selection);
  $("highlight-row").classList.toggle("hidden", !d.highlight);
  $("highlight").disabled = !has;
  $("highlight-label").textContent = has
    ? `Include “${meta.selection.slice(0, 34)}${meta.selection.length > 34 ? "…" : ""}”`
    : "Include the highlighted text — nothing is selected";

  // The picture.
  $("picture-row").classList.toggle("hidden", d.picture === "none");
  $("picture").querySelector('[data-pic="none"]').classList
    .toggle("hidden", d.picture === "required");
  $("picture").querySelector('[data-pic="picked"]').classList
    .toggle("hidden", !pickedImage);
  const noPreview = !(meta && meta.og && meta.og.image);
  const prev = $("picture").querySelector('[data-pic="page"]');
  prev.disabled = noPreview;
  prev.title = noPreview ? "This page declares no preview image" : "";

  if (d.picture === "none") picture = "none";
  if (d.picture === "required" && picture === "none") {
    picture = pickedImage ? "picked" : noPreview ? "screen" : "page";
  }
  if (picture === "page" && noPreview) picture = pickedImage ? "picked" : "screen";
  if (picture === "picked" && !pickedImage) picture = "screen";
  seg($("picture"), "pic", picture);

  const src = picture === "picked" ? pickedImage
    : picture === "page" ? (meta && meta.og && meta.og.image) : null;
  $("pic-preview").hidden = !src;
  if (src) $("pic-preview").src = src;
  $("picture-hint").textContent =
    picture === "region" ? "the popup closes so you can drag"
    : picture === "screen" ? "the visible window — scroll first"
    : picture === "page" ? "the image the site advertises"
    : picture === "picked" ? "the image you right-clicked"
    : "";

  // Where it lands.
  $("wall-row").classList.toggle("hidden", dest !== "inspo" || mode === "append");
  $("pick-row").classList.toggle("hidden", mode !== "append");
  $("pick").placeholder = `Search your ${d.acceptsWhat}…`;
  if (chosen && !d.accepts(chosen)) chosen = null;   // the destination moved
  $("pick-chosen").textContent = chosen ? `→ ${chosen.path}`
    : (mode === "append" ? `Pick one of your ${d.acceptsWhat} above.` : "");
  $("pick-chosen").className = chosen ? "tiny ok" : "tiny warn";

  paintWalls();
  paintPicks();
  paintMentionSearch();
  paintChips();
  paintName();
  paintSave();
}

function paint() {
  paintVault();
  paintWaiting();
  paintRecent();
  paintForm();
}

async function refresh() {
  state = await send("state");
  paint();
}

/* The cached page list is a snapshot from the last connect, Check or flush, so
   anything made in the app since then was missing from "add to a page" — which
   is most of what you would want to add to. This re-reads the folder and
   repaints, deliberately WITHOUT being awaited: the popup opens on the cache
   and corrects itself a moment later, rather than holding the form shut behind
   a directory walk. A locked or missing vault is not an error here — the
   picker's own empty line already says so. */
function refreshPagesSoon() {
  send("refreshPages").then((r) => {
    if (!r || r.ok === false || !state) return;
    state.pages = r.pages || state.pages;
    state.walls = r.walls || state.walls;
    paintForm();
  }).catch(() => {});
}

/** The page's own account of itself, into the fields that hold it. Used on
 *  open and again after a save, so the form comes back as a fresh capture of
 *  the page you are still standing on rather than as the one you just filed. */
function prefillFromPage() {
  const m = meta && meta.ok !== false ? meta : null;
  $("title").value = (m && m.title) || (tab && tab.title) || "";
  $("title").placeholder = "";
  $("source").value = (m && m.url) || (tab && tab.url) || "";
  $("author").value = (m && m.og && m.og.author) || "";
  $("description").value = (m && m.og && m.og.description) || "";
  $("siteName").value = (m && m.og && m.og.siteName) || host(tab && tab.url);
}

/**
 * Back to a blank slate, after something was filed.
 *
 * The fields the PAGE supplied come back; the fields YOU supplied — the note,
 * the tags, the links, the picture, the page an append was aimed at — are
 * cleared, because those described the capture that just went. Saving the
 * same page twice on purpose still works: type the second note and Save arms
 * itself again. It just costs a deliberate keystroke instead of nothing.
 */
function resetAfterSave() {
  // A right-click capture and a picked image are consumed by the save that
  // used them; keeping either would attach it to the next clip as well.
  pending = null;
  pickedImage = null;
  chosen = null;
  mode = "new";
  mentions = [];
  picture = "none";
  for (const id of ["note", "tags", "pick", "mention"]) $(id).value = "";
  $("highlight").checked = false;
  prefillFromPage();
  armed = false;
  paintForm();
  // The next thing typed belongs in the note, not in a title that is already
  // correct — a second clip from one page is almost always a second thought.
  $("note").focus();
}

/** Everything on screen, as the worker's `saveCapture` wants it. */
function form() {
  const d = DEST[dest];
  const has = (row) => d.rows.includes(row);
  return {
    title: has("title") ? $("title").value.trim() : "",
    note: $("note").value.trim(),
    tags: $("tags").value.trim(),
    mentions,
    picture: d.picture === "none" ? "none" : picture,
    imageSrc: pickedImage,
    highlight: d.highlight && $("highlight").checked && !$("highlight").disabled,
    selection: (meta && meta.selection) || (pending && pending.selection) || "",
    ...(has("source") && { url: $("source").value.trim() }),
    ...(has("author") && { author: $("author").value.trim() }),
    ...(has("description") && { description: $("description").value.trim() }),
    ...(has("site") && { siteName: $("siteName").value.trim() }),
    ...(mode === "append" && chosen && { appendTo: chosen.id }),
    ...(mode === "new" && dest === "inspo" && { wall: $("wall").value.trim() }),
  };
}

function report(r) {
  if (!r || r.ok === false) {
    if (r && r.reason === "cancelled") { status("Cancelled."); return; }
    if (r && r.reason === "no-vault") {
      status("Kept — connect a vault above and it is written.", "warn"); return;
    }
    if (r && (r.reason === "permission" || r.reason === "different-vault")) {
      status("Kept — unlock the vault above and it is written.", "warn"); return;
    }
    status(`Not saved: ${(r && (r.message || r.reason)) || "unknown"}`, "bad");
    return;
  }
  if (r.wrote) {
    const last = (state.recent || [])[0];
    status(last && last.path
      ? `${last.skipped ? "Already in" : "Saved to"} ${last.path}` : "Saved to the vault.", "ok");
  } else if (r.failed) status("Saved here, but the write failed — see below.", "bad");
  else status("Saved here — waiting for the vault.", "warn");
}

async function act(fn) {
  status("Working…");
  busy = true;
  paintSave();
  let r;
  try {
    r = await fn();
  } catch (e) {
    status(String((e && e.message) || e), "bad");
    busy = false;
    await refresh();
    return;
  }
  /* Queued IS filed: the capture is in the worker's queue and will be written
     the moment the folder is reachable, so pressing Save again would queue a
     second copy — a locked vault is exactly when a duplicate is easiest to
     make and hardest to notice. Anything that never reached the queue (a
     cancelled region drag, a picture that could not be fetched) leaves the
     form alone, because nothing was saved and the user still wants it. */
  busy = false;
  if (r && r.queued) resetAfterSave();
  await refresh();
  report(r);
}

async function save() {
  /* Enter saves from every single-line field in this form, so the disabled
     button is only half the guard — the other half is here, or a stray Return
     after a save files the whole thing again with nothing changed. */
  if (busy || !armed || !savable) return;
  if (mode === "append" && !chosen) {
    status(`Pick the ${DEST[dest].acceptsWhat.replace(/s$/, "")} it should be added to.`, "warn");
    $("pick").focus();
    return;
  }
  const f = form();
  if (f.picture === "region") {        // the drag needs the popup gone
    send("saveCapture", { tab, dest, form: f });
    window.close();
    return;
  }
  await act(() => send("saveCapture", { tab, dest, form: f }));
}

// ── wiring ──────────────────────────────────────────────────────────────────

$("vault-chip").addEventListener("click", () => openSetup());
$("banner-do").addEventListener("click", () => openSetup($("vault-banner").dataset.hash || ""));
$("open-history").addEventListener("click", () => openSetup());

$("dest").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-dest]");
  if (!b) return;
  dest = b.dataset.dest;
  chrome.storage.local.set({ [DEST_KEY]: dest });
  armed = true;
  paintForm();
});

$("mode").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  mode = b.dataset.mode;
  armed = true;
  paintForm();
  if (mode === "append") $("pick").focus();
});

$("picture").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pic]");
  if (!b || b.disabled) return;
  picture = b.dataset.pic;
  armed = true;
  paintForm();
});

/* Typing or toggling anything is "there is something new here" — including in
   the two searches, where the act of looking for a page to append to is the
   start of the next capture. Capture phase, so a field that stops the event
   still re-arms. */
document.addEventListener("input", rearm, true);
document.addEventListener("change", rearm, true);

$("title").addEventListener("input", paintName);
$("pick").addEventListener("input", paintPicks);
$("mention").addEventListener("input", paintMentionSearch);
$("wall").addEventListener("input", () => { $("dest-where").textContent = DEST[dest].where(state); });
$("save").addEventListener("click", save);
$("flush").addEventListener("click", () => act(() => send("flush")));

// Enter saves from any single-line field. The two searches keep it for their
// own first result, because that is what Enter means in a search box.
for (const id of ["title", "source", "author", "description", "siteName", "note", "tags"]) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
  });
}
for (const [id, box] of [["pick", "pick-results"], ["mention", "mention-results"]]) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const first = $(box).querySelector("button.pick");
    if (first) first.click();
  });
}

(async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const stored = await chrome.storage.local.get(DEST_KEY);
  const remembered = DEST[stored[DEST_KEY]] ? stored[DEST_KEY] : null;
  if (remembered) dest = remembered;

  // A right-click left a capture in waiting: it names the destination, and for
  // an image it names the picture too.
  const got = await send("takePending");
  pending = (got && got.pending) || null;
  if (pending && (!tab || pending.tabId === tab.id)) {
    if (DEST[pending.dest]) dest = pending.dest;
    if (pending.imageSrc) pickedImage = pending.imageSrc;
    if (pending.picture) picture = pending.picture;
  } else {
    pending = null;
  }

  await refresh();
  refreshPagesSoon();
  if (!/^https?:/i.test(tab.url || "")) {
    status("This page cannot be saved — Chrome blocks extensions here.", "warn");
    savable = false;
    paintSave();
    return;
  }

  meta = await send("meta", { tab });
  if (meta && meta.ok !== false) {
    // The page's own account of itself, prefilled and editable.
    prefillFromPage();
    // A link picked out of a context menu is its own address, not this page's.
    if (pending && pending.url) $("source").value = pending.url;
    if (meta.selection) {
      $("highlight").checked = true;
      if (!remembered && !pending) dest = "note";
    }
    // A link picked out of a context menu is its own page, not this one.
    if (pending && pending.url) {
      $("title").value = "";
      $("title").placeholder = "Named from the link if you leave this blank";
    }
    if (pickedImage && meta.alt) $("note").value = meta.alt;
  }
  if (state.settings && state.settings.wall) $("wall").value = state.settings.wall;
  paintForm();
  ($("row-title").classList.contains("hidden") ? $("note") : $("title")).focus();
})();
