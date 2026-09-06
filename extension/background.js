// The clipper's service worker: menus, shortcuts, and the queue → vault pump.
//
// Two rules shape everything here.
//
// **Queue first, write second.** A capture is durable in IndexedDB before any
// attempt to write it. A service worker can be shut down between two lines, a
// vault folder can be on an unplugged disk, and Chrome hands out File System
// Access permission per session — none of which should ever cost the user the
// thing they just clipped.
//
// **A worker has no user gesture**, so it can never call `requestPermission`.
// When the grant has lapsed the clip stays queued and the badge says so; the
// permission is paid for by a click in the popup or the setup page, which then
// flushes everything at once.

import { enqueue, pending, drop, patch, count, settings, logWrite, recent, setMeta, getMeta } from "./store.js";
import { openVault, writeCapture, walls, pageList, storedHandle, permission } from "./writer.js";
import { readPageMeta, fetchImageInPage, selectRegion } from "./injected.js";

const WALLS_KEY = "walls";
const PAGES_KEY = "pages";
const PENDING_KEY = "pendingCapture";
const iso = () => new Date().toISOString().replace(/\.\d+Z$/, "+00:00");

// ── menus ───────────────────────────────────────────────────────────────────

// One item per thing you can point at, and every title names where it lands —
// the three destinations are the whole model, so the menu says them out loud
// rather than leaving the user to find out after the click.
//
// No hand-built parent: Chrome nests an extension's items under its own name
// as soon as more than one matches the context, so a right-click on an image
// is a single "Save image to Inspo" rather than a submenu holding one thing.
const MENUS = [
  { id: "clip-image", title: "Save image…", contexts: ["image"] },
  { id: "clip-link", title: "Save link…", contexts: ["link"] },
  { id: "clip-selection", title: "Save selection…", contexts: ["selection"] },
  { id: "clip-page", title: "Save this page…", contexts: ["page", "frame"] },
  { id: "clip-region", title: "Save a region…", contexts: ["page", "frame"] },
];

/** Which destination a menu item arrives pointing at. The form can be changed
 *  before saving — this is a starting position, not a decision. */
const MENU_DEST = {
  "clip-image": "inspo", "clip-region": "inspo",
  "clip-link": "bookmark", "clip-page": "bookmark",
  "clip-selection": "note",
};

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENUS) chrome.contextMenus.create(m);
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  buildMenus();
  // First install opens the setup page, because the picker needs a real page
  // and a real click — a popup closes the moment the folder dialog opens.
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
  buildMenus();
  // A new browser session is exactly when the folder grant has just lapsed, so
  // it is exactly when the badge has something to say.
  paintBadge().catch(() => {});
});

// ── the badge ───────────────────────────────────────────────────────────────

// The badge answers "will my next clip be written?" before it is made, not
// after. A lapsed folder grant with an empty queue used to look identical to a
// healthy clipper — you found out by clipping something and reading the
// failure. `queryPermission` needs no gesture, so the worker can just ask.
async function paintBadge(flash = null) {
  if (flash) {
    await chrome.action.setBadgeBackgroundColor({ color: flash === "ok" ? "#16a34a" : "#dc2626" });
    await chrome.action.setBadgeText({ text: flash === "ok" ? "✓" : "!" });
    setTimeout(() => { paintBadge().catch(() => {}); }, 2000);
    return;
  }
  const n = await count();
  const handle = await storedHandle();
  const state = await permission(handle);
  const ready = state === "granted";
  /* A capture the form never got to ask about. It is not in the queue — nothing
     will be written until somebody chooses a destination — so the count above
     cannot speak for it, and without its own mark the capture would sit there
     invisibly. */
  const asking = Boolean(await getMeta(PENDING_KEY));

  await chrome.action.setBadgeBackgroundColor({ color: asking ? "#2563eb" : "#d97706" });
  await chrome.action.setBadgeText({
    text: asking ? "?" : n ? String(n) : (ready ? "" : "•"),
  });
  await chrome.action.setTitle({
    title: asking ? "Canon Clip — click to choose where this goes"
      : !handle ? "Canon Clip — no vault connected yet"
      : !ready ? `Canon Clip — ${handle.name} is locked, click to unlock`
      : n ? `Canon Clip — ${n} waiting for ${handle.name}`
      : `Canon Clip — writing to ${handle.name}`,
  });
}

// ── capture ─────────────────────────────────────────────────────────────────

/** Ask the page about itself. Fails soft: a clip from a page that refuses
 *  injection still has its URL and its tab title. */
async function tabMeta(tab, imgSrc = null) {
  const fallback = { url: tab.url || "", title: tab.title || "", selection: "", alt: "", og: {} };
  if (!tab.id || !/^https?:/i.test(tab.url || "")) return fallback;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: readPageMeta,
      args: [imgSrc],
    });
    return (res && res.result) || fallback;
  } catch {
    return fallback;
  }
}

/** Image bytes, first from the worker, then — for anything hotlink-protected
 *  or cookie-gated — from inside the page itself. */
async function imageBytes(src, tabId) {
  if (/^data:/i.test(src)) {
    const blob = await (await fetch(src)).blob();
    return { blob, mime: blob.type };
  }
  try {
    const r = await fetch(src, { credentials: "omit" });
    if (r.ok) {
      const blob = await r.blob();
      if (blob.size) return { blob, mime: blob.type || r.headers.get("content-type") || "" };
    }
  } catch { /* fall through to the page */ }
  if (!tabId) return { error: "could not fetch that image" };
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId }, func: fetchImageInPage, args: [src],
    });
    const out = res && res.result;
    if (out && out.dataUrl) {
      const blob = await (await fetch(out.dataUrl)).blob();
      return { blob, mime: out.mime || blob.type };
    }
    return { error: (out && out.error) || "could not fetch that image" };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

/** A screenshot of the visible tab, cropped to `rect` if one is given. */
async function shoot(tab, rect = null) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const full = await (await fetch(dataUrl)).blob();
  if (!rect) return { blob: full, mime: "image/png" };
  const bmp = await createImageBitmap(full);
  // Scale from the viewport width the page reported, not devicePixelRatio:
  // browser zoom moves one and not the other, and a crop that trusts the wrong
  // one is off by a third with no way for the user to tell why.
  const scale = bmp.width / Math.max(1, rect.viewportWidth || bmp.width);
  const x = Math.max(0, Math.round(rect.x * scale));
  const y = Math.max(0, Math.round(rect.y * scale));
  const w = Math.max(1, Math.min(Math.round(rect.w * scale), bmp.width - x));
  const h = Math.max(1, Math.min(Math.round(rect.h * scale), bmp.height - y));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bmp, x, y, w, h, 0, 0, w, h);
  bmp.close();
  return { blob: await canvas.convertToBlob({ type: "image/png" }), mime: "image/png" };
}

/**
 * The picture a destination may carry, from the one word the popup sends.
 *
 *   none    no picture at all
 *   page    the image the page already advertises as its own (og:image)
 *   screen  the visible window, as it is
 *   region  a rectangle dragged out of the visible window
 *
 * Returns `null` for "none", `{blob, mime, src}` for bytes, or `{error}` /
 * `{cancelled}` — the caller reports which, because "you pressed Escape" and
 * "that image would not load" are not the same news.
 */
async function pictureFor(tab, picture, meta, imageSrc = null) {
  if (!picture || picture === "none") return null;
  // The image the user right-clicked. The only case where a picture is
  // genuinely *pointed at* rather than derived from the page or the screen.
  if (picture === "picked") {
    if (!imageSrc) return { error: "no image was picked" };
    const got = await imageBytes(imageSrc, tab.id);
    return got.error ? { error: got.error }
                     : { blob: got.blob, mime: got.mime, src: imageSrc };
  }
  if (picture === "page") {
    const src = meta && meta.og && meta.og.image;
    if (!src) return { error: "this page offers no image of its own" };
    const got = await imageBytes(src, tab.id);
    return got.error ? { error: got.error } : { blob: got.blob, mime: got.mime, src };
  }
  if (picture === "screen") return { ...(await shoot(tab)), src: null };
  if (picture === "region") {
    if (!/^https?:/i.test(tab.url || "")) return { error: "that page cannot be captured" };
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] }, func: selectRegion,
    });
    const rect = res && res.result;
    if (!rect) return { cancelled: true };
    return { ...(await shoot(tab, rect)), src: null };
  }
  return { error: `unknown picture: ${picture}` };
}

/**
 * Queue a capture, then try to write it. The return value describes both
 * halves, because "saved" and "queued until you unlock the folder" are
 * genuinely different outcomes and the UI says which.
 */
async function save(capture) {
  const rec = await enqueue(capture);
  await paintBadge();
  const out = await flush();
  if (out.wrote) await paintBadge("ok");
  else if (out.failed) await paintBadge("bad");
  return { queued: rec.id, ...out };
}

// ── the pump ────────────────────────────────────────────────────────────────

let flushing = null;

/** Write everything queued, oldest first. Never requests permission — see the
 *  file header — so it is safe to call from any event. */
export async function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    const q = await pending();
    if (!q.length) return { ok: true, wrote: 0, failed: 0, left: 0 };
    const ctx = await openVault();
    if (!ctx.ok) return { ok: false, reason: ctx.reason, message: ctx.message, left: q.length };

    // Cache the wall list and the page list while the vault is open, so the
    // popup can offer real names without paying for an index rebuild every time
    // it opens — and can still offer them while the folder is locked.
    await setMeta(WALLS_KEY, walls(ctx));
    await setMeta(PAGES_KEY, pageList(ctx));

    const s = await settings();
    let wrote = 0, failed = 0;
    for (const rec of q) {
      try {
        const r = await writeCapture(ctx, rec, {
          settings: s,
          onAsset: (assetPath) => patch(rec.id, { assetPath }),
        });
        if (r.ok) {
          await logWrite({ path: r.path, wall: r.wall, title: r.title || rec.title,
                           type: rec.type, skipped: r.skipped || null });
          await drop(rec.id);
          wrote++;
        } else {
          await patch(rec.id, { error: r.message || r.reason });
          failed++;
        }
      } catch (e) {
        await patch(rec.id, { error: String((e && e.message) || e) });
        failed++;
      }
    }
    await paintBadge();
    return { ok: true, wrote, failed, left: await count(),
             vault: ctx.name, pages: ctx.vault.list().length };
  })();
  try { return await flushing; } finally { flushing = null; }
}

// ── the actions the UI and the menus share ──────────────────────────────────

// Two layers, on purpose.
//
// **The three verbs** — `saveNote`, `saveBookmark`, `saveInspo` — are what the
// popup calls, one per destination. The user chose the destination before the
// capture existed, so each verb states its own `target` and never guesses.
//
// **The five clippers** below them are what the right-click menu and the
// keyboard shortcuts call: there the user pointed at a thing rather than
// choosing a place, so each carries the destination its menu item promised.
//
// `fields` is what the popup had on screen — the note, and the `#tags` in it. A
// clip from the context menu simply has none, which is why every one of these
// takes it last and defaults it away.

/**
 * Save what the form describes.
 *
 * One verb for all three destinations, because the form is one form: the user
 * chose where it goes and then edited the fields that destination has. The
 * differences that remain are which picture is fetched and which builder in
 * vault/clip.js writes the file — and that second one is decided there, not
 * here, by the `target` this sets.
 */
async function saveCapture(tab, dest = "bookmark", form = {}) {
  const m = await tabMeta(tab, form.imageSrc || null);
  const pic = await pictureFor(tab, form.picture, m, form.imageSrc);
  if (pic && pic.cancelled) return { ok: false, reason: "cancelled" };
  if (pic && pic.error) { await paintBadge("bad"); return { ok: false, reason: pic.error }; }
  if (dest === "inspo" && !pic) return { ok: false, reason: "a wall card needs a picture" };

  const url = form.url || m.url || tab.url;
  return save({
    type: dest === "inspo" ? (form.picture === "picked" ? "image" : "screenshot") : dest,
    target: dest === "inspo" ? "wall" : dest,
    url, pageUrl: m.url || tab.url,
    title: form.title != null ? form.title : (m.title || tab.title || ""),
    og: m.og || {}, alt: m.alt || "",
    // Only when asked for: a highlight is evidence the user chose to keep, not
    // something the page volunteered.
    text: form.highlight ? (form.selection || m.selection || "") : "",
    ...(pic && { blob: pic.blob, mime: pic.mime, src: pic.src }),
    ...(form.appendTo && { appendTo: form.appendTo }),
    ...(form.wall && { wall: form.wall }),
    note: form.note || "", tags: form.tags || "",
    ...(form.author != null && { author: form.author }),
    ...(form.description != null && { description: form.description }),
    ...(form.siteName != null && { siteName: form.siteName }),
    capturedAt: iso(),
  });
}

async function clipPage(tab, target = "bookmark", fields = {}) {
  const m = await tabMeta(tab);
  return save({
    type: "page", target, url: m.url || tab.url, pageUrl: m.url || tab.url,
    title: m.title || tab.title || "", og: m.og || {}, capturedAt: iso(), ...fields,
  });
}

async function clipLink(tab, url, target = "bookmark", fields = {}) {
  const m = await tabMeta(tab);
  return save({
    // No title on purpose: a link picked out of a context menu has no name
    // anyone chose, and clip.js names it from the url better than `title: url`
    // would — that filename would be the whole href, slashes and all.
    type: "link", target, url, pageUrl: m.url || tab.url,
    title: "", og: {}, capturedAt: iso(), ...fields,
  });
}

async function clipSelection(tab, text, target = "note", fields = {}) {
  const m = await tabMeta(tab);
  const said = text || m.selection || "";
  return save({
    type: "selection", target, url: m.url || tab.url, pageUrl: m.url || tab.url,
    title: m.title || tab.title || "", text: said, caption: said,
    og: m.og || {}, capturedAt: iso(), ...fields,
  });
}

async function clipImage(tab, src, target = "wall", fields = {}) {
  const m = await tabMeta(tab, src);
  const got = await imageBytes(src, tab.id);
  if (got.error) { await paintBadge("bad"); return { ok: false, reason: got.error }; }
  return save({
    type: "image", target, src, mime: got.mime, blob: got.blob,
    url: m.url || tab.url, pageUrl: m.url || tab.url,
    title: m.title || tab.title || "", alt: m.alt || "", capturedAt: iso(), ...fields,
  });
}

async function clipShot(tab, { region = false, target = "wall" } = {}, fields = {}) {
  const pic = await pictureFor(tab, region ? "region" : "screen", null);
  if (pic.cancelled) return { ok: false, reason: "cancelled" };
  if (pic.error) return { ok: false, reason: pic.error };
  const m = await tabMeta(tab);
  return save({
    type: "screenshot", target, mime: pic.mime, blob: pic.blob,
    src: null, url: m.url || tab.url, pageUrl: m.url || tab.url,
    title: m.title || tab.title || "", capturedAt: iso(), ...fields,
  });
}

/**
 * A right-click opens the form, prefilled with what was pointed at.
 *
 * The popup cannot be handed arguments, so the capture-in-waiting is written
 * where the popup will look for it and `openPopup()` is asked to show it. That
 * call is Chrome 127+ and can still be refused — a window that is not focused,
 * a policy — so the fallback is the old behaviour: save it immediately with the
 * destination the menu item named, and flash the badge to say it happened. A
 * menu item that silently does nothing is worse than one that saves without
 * asking.
 */
/* The write that is putting `pending` on disk, so `takePending` can wait for it
   without `openForm` having to await it first. See below for why that matters. */
let pendingWrite = Promise.resolve();

/**
 * Put the capture in waiting and open the form over it.
 *
 * `chrome.action.openPopup()` must be called INSIDE the user gesture that a
 * context-menu click or a keyboard command gives us, and an MV3 service worker
 * loses that activation the moment it awaits anything at all. `await setMeta()`
 * first — a single IndexedDB write — was enough to lose it: `openPopup()` threw
 * "not called from a user gesture", the catch swallowed it, and the caller fell
 * through to saving with a guessed destination. Every "Save image…" and "Save
 * selection…" wrote a file without asking, which is the one thing the ellipsis
 * in those labels promises it will not do.
 *
 * So the write is STARTED and deliberately not awaited, and the popup waits for
 * it instead.
 */
function openForm(pending) {
  pendingWrite = setMeta(PENDING_KEY, pending);
  if (!chrome.action.openPopup) return pendingWrite.then(() => false);
  return chrome.action.openPopup().then(
    () => true,
    () => pendingWrite.then(() => false),
  );
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  const dest = MENU_DEST[info.menuItemId];
  if (!dest) return;
  const picture = info.menuItemId === "clip-image" ? "picked"
    : info.menuItemId === "clip-region" ? "region" : "none";
  try {
    const opened = await openForm({
      dest, picture, tabId: tab.id,
      imageSrc: info.srcUrl || null,
      url: info.linkUrl || null,
      selection: info.selectionText || "",
      highlight: Boolean(info.selectionText),
      at: Date.now(),
    });
    if (opened) return;                       // the popup takes it from here
    /* The form could not open — an older Chrome, a policy, a lost gesture.
       The capture STAYS in waiting rather than being written to a destination
       nobody chose. It used to fall through to `clipImage`/`clipSelection`
       here, which silently guessed `inspo` for a picture and `notes/` for a
       quote; a clipper that saves somewhere you did not pick is worse than one
       that waits, because you do not find out until you go looking. The badge
       says there is something to finish, and clicking the icon opens the form
       with this capture already in it. */
    await pendingWrite;
    await paintBadge();
  } catch (e) {
    await paintBadge("bad");
    console.error("Canon Clip:", e);
  }
});

/* The shortcuts ask too. They used to go straight to `clipPage`/`clipShot`,
   so Alt+Shift+C filed a bookmark and Alt+Shift+S filed a picture to a wall
   without a word — the same silent guess the menus made, on the path where it
   is least expected, because a keystroke gives you no menu label to read
   first. A command is a user gesture, so the form opens from here as well. */
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) return;
  const dest = MENU_DEST[command];
  if (!dest) return;
  try {
    const opened = await openForm({
      dest, picture: command === "clip-region" ? "region" : "none",
      tabId: tab.id, imageSrc: null, url: null,
      selection: "", highlight: false, at: Date.now(),
    });
    if (opened) return;
    await pendingWrite;
    await paintBadge();
  } catch (e) {
    await paintBadge("bad");
    console.error("Canon Clip:", e);
  }
});

// ── what the popup and the setup page ask for ───────────────────────────────

async function state() {
  const handle = await storedHandle();
  return {
    vault: {
      name: handle ? handle.name : null,
      permission: await permission(handle),
    },
    settings: await settings(),
    pending: (await pending()).map((r) => ({
      id: r.id, type: r.type, title: r.title, url: r.url,
      error: r.error || null, queuedAt: r.queuedAt,
    })),
    walls: (await getMeta(WALLS_KEY)) || [],
    pages: (await getMeta(PAGES_KEY)) || [],
    recent: await recent(),
  };
}

const HANDLERS = {
  state,
  saveCapture: ({ tab, dest, form }) => saveCapture(tab, dest, form),
  /** What a right-click left for the popup, taken rather than read: a pending
   *  capture is for the next popup that opens, not for every one after it. */
  takePending: async () => {
    // `openForm` starts this write without awaiting it, so that opening the
    // popup still counts as happening inside the user's click. The popup asks
    // for the capture within milliseconds, so waiting for the write here is
    // what keeps the two in order.
    await pendingWrite;
    const pending = await getMeta(PENDING_KEY);
    if (pending) { await setMeta(PENDING_KEY, null); await paintBadge(); }
    return { ok: true, pending: pending || null };
  },
  flush: () => flush(),
  saveNote: ({ tab, picture, highlight, fields }) =>
    saveNote(tab, { picture, highlight }, fields),
  saveBookmark: ({ tab, fields }) => saveBookmark(tab, fields),
  saveInspo: ({ tab, picture, fields }) => saveInspo(tab, { picture }, fields),
  clipPage: ({ tab, target, fields }) => clipPage(tab, target, fields),
  clipLink: ({ tab, url, target, fields }) => clipLink(tab, url, target, fields),
  clipSelection: ({ tab, text, target, fields }) => clipSelection(tab, text, target, fields),
  clipImage: ({ tab, src, target, fields }) => clipImage(tab, src, target, fields),
  clipShot: ({ tab, region, target, fields }) => clipShot(tab, { region, target }, fields),
  meta: ({ tab }) => tabMeta(tab),
  dropOne: async ({ id }) => { await drop(id); await paintBadge(); return { ok: true }; },
  /**
   * Open the vault and report what is there — the honest answer to "is my
   * folder actually connected?", which no amount of permission state can give.
   * A grant says Chrome will let us read the folder; only reading it says the
   * folder is the vault, and how much of it there is.
   */
  check: async () => {
    const started = Date.now();
    const ctx = await openVault();
    if (!ctx.ok) {
      return { ok: false, reason: ctx.reason, message: ctx.message,
               name: ctx.handle ? ctx.handle.name : null };
    }
    const list = ctx.vault.list();
    await setMeta(WALLS_KEY, walls(ctx));
    await setMeta(PAGES_KEY, pageList(ctx));
    return {
      ok: true, name: ctx.name, pages: list.length,
      walls: list.filter((e) => e.kind === "inspo").length,
      notes: list.filter((e) => e.kind === "note").length,
      ms: Date.now() - started,
    };
  },
  refreshWalls: async () => {
    const ctx = await openVault();
    if (!ctx.ok) return { ok: false, reason: ctx.reason };
    const list = walls(ctx);
    await setMeta(WALLS_KEY, list);
    await setMeta(PAGES_KEY, pageList(ctx));
    return { ok: true, walls: list };
  },
  badge: () => paintBadge(),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = HANDLERS[msg && msg.type];
  if (!fn) return false;
  Promise.resolve(fn(msg))
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((e) => sendResponse({ ok: false, reason: String((e && e.message) || e) }));
  return true;                     // the response is async
});

paintBadge().catch(() => {});
