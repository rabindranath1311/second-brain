// Mirror the data layer into extension/vault.
//
// The clipper writes to the vault itself — an inspo item, an attachment, a
// bookmark note — and everything that makes those writes safe (the `.history`
// snapshot, the conflict gate, the `.trash` move, the byte-exact serializer)
// already exists in app/vault. A second implementation of the file format would
// be a second thing to keep true, and the one that drifted would be the one
// nobody was watching.
//
// A browser extension can only load files inside its own directory, so the
// modules are COPIED, byte for byte, and this script is what proves the copy is
// still a copy:
//
//     node scripts/sync-extension.mjs          # write
//     node scripts/sync-extension.mjs --check  # exit 1 if stale (CI)
//
// Same pattern as sync-convention.mjs and sync-demo.mjs. Edit app/vault; never
// edit extension/vault.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EXT_DIR = join(ROOT, "extension");

/**
 * What the clipper needs, and nothing else.
 *
 * Not `scaffold.js` (the clipper must never create a vault — it writes into one
 * the user already chose), not `bridge.js` (the app's boot, with a DOM in it),
 * not the generated mirrors, which are big and answer questions the clipper
 * does not ask.
 */
export const MIRRORED = [
  ["app/vault/attachments.js", "extension/vault/attachments.js"],
  ["app/vault/clip.js", "extension/vault/clip.js"],
  ["app/vault/dashboard.js", "extension/vault/dashboard.js"],
  ["app/vault/data.js", "extension/vault/data.js"],
  ["app/vault/excalidraw.js", "extension/vault/excalidraw.js"],
  ["app/vault/images.js", "extension/vault/images.js"],
  ["app/vault/inspo.js", "extension/vault/inspo.js"],
  ["app/vault/links.js", "extension/vault/links.js"],
  ["app/vault/mdfile.js", "extension/vault/mdfile.js"],
  ["app/vault/sections.js", "extension/vault/sections.js"],
  ["app/vault/vault.js", "extension/vault/vault.js"],
  // excalidraw.js imports it. The clipper never writes a drawing, but data.js
  // does not know that, and a mirror with a missing import is a broken mirror.
  ["app/vendor/lz-string.js", "extension/vendor/lz-string.js"],
  ["app/icons/icon-192.png", "extension/icons/icon-192.png"],
  ["app/icons/icon-512.png", "extension/icons/icon-512.png"],
];

/** [{from, to, stale}] — read once so --check and the write agree exactly. */
export function survey() {
  return MIRRORED.map(([from, to]) => {
    const src = readFileSync(join(ROOT, from));
    const dstPath = join(ROOT, to);
    let dst = null;
    try { dst = readFileSync(dstPath); } catch { /* not written yet */ }
    return { from, to, src, dstPath, stale: dst === null || !src.equals(dst) };
  });
}

/** Mirrored files that no longer have a source — a rename left them behind. */
export function orphans() {
  const kept = new Set(MIRRORED.map(([, to]) => to));
  const out = [];
  for (const dir of ["extension/vault", "extension/vendor"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const rel = `${dir}/${name}`;
      if (!kept.has(rel)) out.push(rel);
    }
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes("--check");
  const files = survey();
  const stale = files.filter((f) => f.stale);
  const extra = orphans();

  if (!stale.length && !extra.length) {
    console.log(`✓ extension/vault is in sync with app/vault — ${files.length} files`);
  } else if (check) {
    for (const f of stale) console.error(`✗ ${f.to} is stale`);
    for (const f of extra) console.error(`✗ ${f} has no source in app/`);
    console.error("run: node scripts/sync-extension.mjs");
    process.exit(1);
  } else {
    for (const f of stale) {
      mkdirSync(dirname(f.dstPath), { recursive: true });
      writeFileSync(f.dstPath, f.src);
      console.log(`  ${f.to}`);
    }
    for (const f of extra) { unlinkSync(join(ROOT, f)); console.log(`  removed ${f}`); }
    console.log(`✓ mirrored ${stale.length} file(s) into extension/`);
  }
}
