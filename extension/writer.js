// The half of the clipper that touches the vault — and only the half that
// genuinely needs a browser: the stored directory handle, the permission it
// carries, and standing up the app's own `Vault` over it.
//
// What to *write* is `applyCapture` in vault/clip.js, so that decision runs
// against a MemoryBackend under `node --test` instead of only against a folder
// in Chrome. Everything below is plumbing.
//
// The clipper stands up `Vault` and `Data` rather than reimplementing them, so
// a clipped item goes through the same serializer, the same `.history`
// snapshot, the same conflict gate and the same `attachments/` naming as
// anything the app writes. The mirror in extension/vault is maintained by
// scripts/sync-extension.mjs — edit app/vault, never this copy.
//
// The one thing the clipper may never do is *create* a vault: `scaffold.js` is
// deliberately not mirrored. Point it at a folder that is not a vault and it
// says so, rather than filling it with a convention nobody asked for.

import { Vault, FSABackend, vaultFingerprint, sameVault } from "./vault/vault.js";
import { Data } from "./vault/data.js";
import { applyCapture } from "./vault/clip.js";
import { getMeta, setMeta, HANDLE_KEY } from "./store.js";

const FINGERPRINT_KEY = "vault-fingerprint";

export async function storedHandle() {
  return getMeta(HANDLE_KEY);
}

export async function rememberHandle(handle) {
  await setMeta(HANDLE_KEY, handle);
  await setMeta(FINGERPRINT_KEY, null);   // a new folder gets a new identity
  return handle;
}

export async function forgetHandle() {
  await setMeta(HANDLE_KEY, null);
  await setMeta(FINGERPRINT_KEY, null);
}

/**
 * 'granted' | 'prompt' | 'denied' | 'none'.
 *
 * `request` may only be passed from a page with a user gesture — a service
 * worker has none, which is exactly why the queue exists: a clip made from the
 * context menu is kept until a click somewhere can pay for the permission.
 */
export async function permission(handle, { request = false } = {}) {
  if (!handle) return "none";
  const opts = { mode: "readwrite" };
  let state = await handle.queryPermission(opts);
  if (state !== "granted" && request) state = await handle.requestPermission(opts);
  return state;
}

/**
 * Ask for the grant, from a click, with nothing awaited first.
 *
 * This exists apart from `permission(handle, {request:true})` because that one
 * awaits `queryPermission` before asking — and an await inside a click handler
 * can outlive Chrome's transient user activation. When it does,
 * `requestPermission` rejects with a bare NotAllowedError instead of showing
 * the dialog, which is exactly how "I press Unlock and nothing happens" looks
 * from the outside. So: hold the handle already, call this synchronously, and
 * let the caller await the promise it returns.
 */
export function requestAccess(handle) {
  if (!handle) return Promise.resolve("none");
  return handle.requestPermission({ mode: "readwrite" });
}

/**
 * Open the vault for writing, or explain why not.
 *
 * The identity check is the app's: a stored handle follows a rename, and one
 * whose folder was deleted and replaced will happily write into the
 * replacement. So what is compared is the vault's own contents, not the handle.
 */
export async function openVault({ request = false } = {}) {
  const handle = await storedHandle();
  if (!handle) return { ok: false, reason: "no-vault" };
  const state = await permission(handle, { request });
  if (state !== "granted") return { ok: false, reason: "permission", state, handle };

  const be = new FSABackend(handle);
  const now = await vaultFingerprint(be);
  const then = await getMeta(FINGERPRINT_KEY);
  if (!sameVault(then, now)) {
    return { ok: false, reason: "different-vault", handle,
             message: "That folder is not the vault this clipper was connected to. "
                    + "Nothing was written — choose it again to adopt it deliberately." };
  }
  await setMeta(FINGERPRINT_KEY, now);

  const vault = new Vault(be);
  await vault.buildIndex();
  return { ok: true, handle, vault, data: new Data(vault), name: handle.name };
}

/**
 * Every page in the vault, flattened for the popup's "add to an existing page"
 * picker. Cached in the extension's own storage while the vault is open, so the
 * picker works before the folder has been unlocked — the alternative is a form
 * that cannot answer "which page?" until you have already fixed something else.
 */
export function pageList(ctx) {
  return ctx.vault.list()
    // `url` comes along because it is what separates a bookmark from a note —
    // the convention has one kind for both, and the picker offers one at a time.
    // `??`, not `||`: the PRESENCE of the key is the fact — a bookmark whose
    // address is still empty is a bookmark, and `|| null` filed it under
    // notes, in the one list whose whole job is telling the two apart.
    .map((e) => ({ id: e.id, title: e.title, path: e.path, kind: e.kind,
                   url: e.url ?? null, updated: e.updated }))
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
}

/** Every inspo page in the vault — what the popup offers as a target. */
export function walls(ctx) {
  return ctx.vault.list()
    .filter((e) => e.kind === "inspo")
    .map((e) => ({ title: e.title, path: e.path, updated: e.updated }))
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
}

export function writeCapture(ctx, capture, opts) {
  return applyCapture(ctx.data, ctx.vault, capture, opts);
}
