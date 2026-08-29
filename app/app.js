/* Canon Vault — terminal/brutalist research-lab UI, wired to the real vault.

   Screens and rendering only. There is no backend: every value on screen comes
   from app/vault/, which reads the folder the user picked through the File
   System Access API. `fetch()` to an origin appears zero times in this file and
   must stay that way — see CONTRIBUTING.md.

   No mock content — a sparse vault renders honest empty states.
   Zero deps, no build step. */

'use strict';

/* ── hyperscript ──────────────────────────────────────────────────────── */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const key in props) {
      const val = props[key];
      if (val == null || val === false) continue;
      if (key === 'className') el.className = val;
      else if (key === 'style' && typeof val === 'object') {
        // Object.assign can't set CSS custom properties (--x) — they need
        // setProperty. Split so inline `--k-c` / `--ft` style vars actually apply.
        for (const sk in val) {
          if (sk.startsWith('--')) el.style.setProperty(sk, val[sk]);
          else el.style[sk] = val[sk];
        }
      }
      else if (key === 'html') el.innerHTML = val;
      else if (key === 'value') el.value = val;
      else if (key === 'checked') el.checked = !!val;
      else if (key === 'onClick') {
        el.addEventListener('click', val);
        // A <div onclick> is unreachable without a mouse. Rows, cards, tiles
        // and chips are all built that way here, so the fix belongs in the
        // factory rather than at 14 call sites that would drift apart.
        // Native controls already do this; only the improvised ones need it.
        if (!/^(button|a|input|select|textarea|label)$/i.test(tag)
            && props.role == null && props.tabIndex == null) {
          if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
          if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
          el.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            // Space scrolls the page by default, which is never what a
            // focused row is asking for.
            e.preventDefault();
            el.click();
          });
        }
      }
      // onChange means `input` here on purpose: every field in this app wants
      // per-keystroke updates, not the native change-on-commit.
      else if (key === 'onInput' || key === 'onChange') el.addEventListener('input', val);
      /* Everything else spelled `onSomething` binds the lowercase event.
         It used to be a list of eight named cases falling through to
         setAttribute, so an unlisted one — `onPaste`, `onBlur` — did not
         throw, did not warn, and did not work: it stringified the function
         into an HTML attribute and the handler simply never ran. A factory
         that silently drops a listener is a bug generator. */
      else if (/^on[A-Z]/.test(key) && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      }
      else el.setAttribute(key, val);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

/* ── API ──────────────────────────────────────────────────────────────── */
// There is no backend. Every call below is computed locally from the vault by
// app/vault/data.js, which bridge.js exposes as window.SB_DATA before app.js
// loads. Task 6.1.
const SB = {
  data() {
    if (!window.SB_DATA) throw new Error('vault not connected');
    return window.SB_DATA;
  },
};
/* ── shared atoms ─────────────────────────────────────────────────────── */
/* ── Confirm modal ──────────────────────────────────────────────
   Promise-based replacement for browser confirm(). Lives in-app, can
   be themed, supports Enter/Escape, and looks like the rest of the UI.
   Returns true if confirmed, false if cancelled.

   Usage:
     if (!await confirmDialog({title:'Delete?', confirmLabel:'Delete', danger:true})) return;
*/
function confirmDialog(opts = {}) {
  const { title = 'Are you sure?', body = '', confirmLabel = 'Confirm',
          cancelLabel = 'Cancel', danger = false } = opts;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey, true);
      bg.remove();
      resolve(!!ok);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.stopPropagation(); finish(true); }
    };
    const bg = h('div', { className: 'modal-bg confirm-bg',
      onClick: (e) => { if (e.target === bg) finish(false); } });
    bg.appendChild(h('div', { className: 'modal confirm-modal' + (danger ? ' confirm-danger' : '') },
      h('div', { className: 'modal-hd' },
        h('b', null, title),
        h('button', { className: 'sb-twk-x', onClick: () => finish(false) }, '✕')),
      h('div', { className: 'modal-body' },
        body ? h('div', { className: 'confirm-body' }, body) : null,
        h('div', { className: 'confirm-actions' },
          h('button', { className: 'side-action', onClick: () => finish(false) }, cancelLabel),
          h('button', {
            className: 'btn-primary' + (danger ? ' btn-danger' : ''),
            onClick: () => finish(true),
          }, confirmLabel)))));
    document.body.appendChild(bg);
    document.addEventListener('keydown', onKey, true);
    asDialog(bg);
    // Then override where focus lands: on a confirm, the answer is the button,
    // so Enter works the moment the dialog appears.
    const confirmBtn = bg.querySelector('.btn-primary');
    if (confirmBtn) confirmBtn.focus();
  });
}

/* 10.8: at zero pages the dashboard used to render three dashed "nothing here"
   boxes stacked on top of each other, which reads as broken rather than new.
   A fresh vault gets one clear next action instead. */
function FirstRunPanel(onCreate) {
  return h('div', { className: 'first-run' },
    h('h2', { className: 'first-run-h' }, 'Your vault is empty — and that is the right start.'),
    h('p', { className: 'first-run-p' },
      'Everything here is a plain markdown file in the folder you picked. ',
      'Obsidian can open the same files, and so can your agent. Nothing is uploaded.'),
    h('button', { className: 'btn-primary first-run-cta', onClick: onCreate }, '+ write your first page'),
    h('div', { className: 'first-run-alt' },
      h('b', null, 'Already have notes? '),
      'Drop markdown files into the folder — the app indexes them as they are and ',
      'never rewrites a file it did not create.'),
    // Per-kind colour dots, salvaged from uncommitted work in the main
    // checkout: the folder list is the kinds, so it wears the kinds' colours.
    h('ul', { className: 'first-run-list' },
      h('li', { className: 'frk-note' }, h('b', null, 'notes/'), ' anything read as prose'),
      h('li', { className: 'frk-topic' }, h('b', null, 'topics/'), ' a hub you keep coming back to'),
      h('li', { className: 'frk-canvas' }, h('b', null, 'canvas/'), ' a board, arranged in Obsidian'),
      h('li', { className: 'frk-inspo' }, h('b', null, 'inspo/'), ' visual reference')));
}

/* An empty state is the first thing a new vault shows on most screens, so it
   is the app's first impression more often than the dashboard is. This one
   used to be grey text in a dashed box — technically informative, and it read
   like a validation error. The monogram behind it turns the same information
   into a considered blank page, and `action` gives the state a way out
   instead of describing one. */
/* ── toast ──────────────────────────────────────────────────────────────
   One transient message with an optional single action. Exists because
   `.trash/` and `.history/` have always been there and the interface never
   mentioned either: the app was safer than it looked, which is the wrong
   direction for a tool holding the only copy of your notes. */
let _toastTimer = null;
function toast(message, opts = {}) {
  const { actionLabel, onAction, tone, ms = actionLabel ? 8000 : 3200 } = opts;
  document.querySelectorAll('.cv-toast').forEach((n) => n.remove());
  clearTimeout(_toastTimer);

  const el = h('div', { className: 'cv-toast' + (tone ? ' cv-toast-' + tone : ''), role: 'status' },
    h('span', { className: 'cv-toast-msg' }, message));
  if (actionLabel && onAction) {
    el.appendChild(h('button', {
      className: 'cv-toast-action',
      onClick: async () => { el.remove(); clearTimeout(_toastTimer); await onAction(); },
    }, actionLabel));
  }
  el.appendChild(h('button', {
    className: 'cv-toast-x', title: 'Dismiss', 'aria-label': 'Dismiss',
    onClick: () => { el.remove(); clearTimeout(_toastTimer); },
  }, '\u2715'));
  document.body.appendChild(el);
  // An undo offer gets longer than a bare confirmation — you need time to
  // realise you did not mean it.
  _toastTimer = setTimeout(() => el.remove(), ms);
  return el;
}

/* Pick a snapshot. Deliberately plain — a list of times, newest first, and
   nothing else, because a snapshot carries no other metadata. */
/* Make an overlay behave like a dialog.
 *
 * There are four modals in the app and each was hand-built: a `.modal-bg` with
 * a `.modal` inside it, appended to the body. None of them was a dialog in any
 * sense a keyboard or a screen reader could tell. Opening Create with ⌘N left
 * focus on `<body>`, so reaching the first card meant tabbing in from the top
 * of the document — through the whole sidebar, behind an overlay you cannot
 * see past — and Tab walked straight back out the other side into the page the
 * modal was covering. Nothing announced a dialog had opened, and closing one
 * dropped focus at the top of the page rather than back on the control you
 * used to open it.
 *
 * One helper, called at each of the four sites. It is safe to call again on
 * the same open overlay — `render()` rebuilds the create modal's element on
 * every keystroke in the project-name field, and stealing focus back each time
 * would be worse than never taking it.
 */
const FOCUSABLE_SEL =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function asDialog(bg, { onEscape, label, restore } = {}) {
  const dialog = bg.querySelector('.modal') || bg;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  // Name it from its own heading when it has one, so the name cannot drift.
  const hd = dialog.querySelector('.modal-hd b');
  if (hd && !dialog.id) {
    hd.id = hd.id || ('modal-hd-' + (asDialog._n = (asDialog._n || 0) + 1));
    dialog.setAttribute('aria-labelledby', hd.id);
  } else if (label) {
    dialog.setAttribute('aria-label', label);
  }

  const focusables = (root) =>
    [...(root || dialog).querySelectorAll(FOCUSABLE_SEL)].filter((e) => e.offsetParent !== null);

  // Remember the opener once per opening, not once per re-render.
  if (!asDialog._restore) asDialog._restore = restore || document.activeElement;
  if (!bg.contains(document.activeElement)) {
    /* The body first, then anywhere. In DOM order the first focusable is the
       ✕ in the header, and landing a keyboard user on Close is answering a
       question they did not ask — they opened this to do the thing inside. */
    const body = dialog.querySelector('.modal-body');
    ((body && focusables(body)[0]) || focusables()[0] || dialog).focus();
  }

  const onKey = (e) => {
    if (!document.body.contains(bg)) return;         // observer will clean up
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault(); e.stopPropagation(); onEscape(); return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) { e.preventDefault(); dialog.focus(); return; }
    const first = f[0], last = f[f.length - 1];
    const inside = dialog.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault(); first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);

  // Give focus back to whatever opened this, once the overlay is really gone.
  const obs = new MutationObserver(() => {
    if (document.body.contains(bg)) return;
    obs.disconnect();
    document.removeEventListener('keydown', onKey, true);
    /* A function, not an element, when the opener will not survive: render()
       rebuilds the whole tree, so the button that opened the create modal is
       a different object by the time it closes and focusing the old one is a
       no-op on a detached node. */
    const back = typeof asDialog._restore === 'function' ? asDialog._restore() : asDialog._restore;
    asDialog._restore = null;
    if (back && document.body.contains(back)) { try { back.focus(); } catch (_) {} }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return dialog;
}

function historyDialog(snaps, title) {
  return new Promise((resolve) => {
    const close = (v) => {
      bg.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    const pretty = (stamp) => String(stamp).replace('T', '  ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
    const bg = h('div', {
      className: 'modal-bg',
      onClick: (e) => { if (e.target === bg) close(null); },
    },
      h('div', { className: 'modal confirm-modal' },
        h('div', { className: 'modal-hd' },
          h('b', null, 'Version history'),
          h('button', { className: 'sb-twk-x', onClick: () => close(null) }, '\u2715')),
        h('div', { className: 'modal-body' },
          h('p', { className: 'history-lede' },
            String(snaps.length),
            snaps.length === 1 ? ' earlier version of ' : ' earlier versions of ',
            h('b', null, title), ', kept in ', h('code', null, '.history/'), '.'),
          h('div', { className: 'history-list' },
            snaps.map((sn) => h('button', {
              className: 'history-row', onClick: () => close(sn),
            },
              h('span', { className: 'history-when' }, pretty(sn.stamp)),
              h('span', { className: 'history-go' }, 'Restore')))))));
    document.body.appendChild(bg);
    document.addEventListener('keydown', onKey, true);
    asDialog(bg);
  });
}

/* ── the vault's problems, and the buttons that fix them ────────────────────
 *
 * The banner said: 8 vault warnings, including: duplicate filename "Untitled":
 * canvas/Untitled.md and inspo/Untitled.md — [[Untitled]] is ambiguous.
 *
 * Every word of that is true and none of it helps. It names two files in an app
 * that reads and writes exactly those files, and then asks the user to go and
 * sort it out somewhere else. So the same finding now arrives as a list you can
 * act on: one row per problem, the files under it, and the fix beside each —
 * rename, re-id, retitle — running here, through the same write path, `.history`
 * snapshot and all.
 *
 * The dialog re-reads the vault after every fix, so the list shrinks as you work
 * and you are never guessing whether the last button did anything.
 */
function problemsDialog() {
  const data = window.SB_DATA;
  if (!data || typeof data.vaultProblems !== 'function') {
    toast('The data layer is not standing — reload the app.', { tone: 'error' });
    return;
  }
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey, true);
    // Whatever was renamed is a different file now: the screen behind this is
    // showing the old names until it is told otherwise.
    render();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

  const list = h('div', { className: 'prob-list' });
  const lede = h('p', { className: 'prob-lede' });

  const TITLES = {
    'duplicate-filename': (p) => ['Two files answer to ', h('code', null, `[[${p.name}]]`)],
    'duplicate-id': (p) => ['Two files carry the id ', h('code', null, p.id)],
    'duplicate-title': (p) => ['Two pages are titled ', h('b', null, p.title)],
    unreadable: (p) => ['This file could not be read'],
  };
  const WHY = {
    'duplicate-filename': 'Obsidian resolves a wikilink by filename, so every link to '
      + 'that name is ambiguous — in this app and in Obsidian both. Rename either one.',
    'duplicate-id': 'The id is what the app opens a page by, so one of these two is '
      + 'unreachable. Give it an id of its own; nothing else about it changes.',
    'duplicate-title': 'Nothing breaks — the two are still separate files. It is only '
      + 'hard to tell them apart in a list.',
    unreadable: 'The app refuses to write over a file it cannot parse, so this one is '
      + 'read-only until the frontmatter is fixed — in Obsidian, or by your agent.',
  };

  const paint = () => {
    const problems = data.vaultProblems();
    clear(list);
    clear(lede);
    if (!problems.length) {
      lede.appendChild(document.createTextNode('Nothing to fix — every page has a name of its own.'));
      list.appendChild(h('div', { className: 'prob-empty' }, 'All clear.'));
      return;
    }
    lede.appendChild(document.createTextNode(
      `${problems.length} thing${problems.length === 1 ? '' : 's'} to settle. `
      + 'Each fix is written straight into the vault, and the old version is kept in .history/.'));

    problems.forEach((p) => {
      const rows = h('div', { className: 'prob-files' });
      const row = h('div', { className: 'prob' },
        h('div', { className: 'prob-hd' }, ...(TITLES[p.type] || (() => [p.text]))(p)),
        h('div', { className: 'prob-why' }, WHY[p.type] || ''),
        rows);

      (p.files || []).forEach((f) => {
        const line = h('div', { className: 'prob-file' },
          h('code', { className: 'prob-path' }, f.path));
        /* A broken file gets no Rename button. It is not the name that is
           wrong, and offering the one fix that cannot help is worse than
           offering none — the frontmatter has to be repaired in something that
           will open it, which is Obsidian or an agent. */
        if (p.type === 'unreadable') {
          line.appendChild(h('span', { className: 'prob-note' }, p.why || ''));
          const url = obsidianUrl(f.path);
          if (url) line.appendChild(h('a', { className: 'btn prob-do', href: url }, 'Open in Obsidian'));
          rows.appendChild(line);
          return;
        }
        if (!f.fixable) {
          line.appendChild(h('span', { className: 'prob-note' },
            f.path.endsWith('.canvas')
              ? 'an Obsidian canvas — rename the other one'
              : 'not editable from here'));
          rows.appendChild(line);
          return;
        }
        if (p.type === 'duplicate-id') {
          line.appendChild(h('button', {
            className: 'btn prob-do',
            onClick: (e) => run(e.currentTarget, () => data.newIdFor(f.path),
              'New id written — ' + f.path),
          }, 'Give it a new id'));
          rows.appendChild(line);
          return;
        }
        // Rename and retitle are the same shape: a field prefilled with a name
        // that is already free, so the common case is one click.
        const isTitle = p.type === 'duplicate-title';
        const input = h('input', {
          className: 'set-input prob-input',
          value: isTitle ? f.title : f.suggest,
          'aria-label': (isTitle ? 'New title for ' : 'New filename for ') + f.path,
        });
        const go = h('button', {
          className: 'btn prob-do',
          onClick: (e) => run(e.currentTarget, () => isTitle
            ? data.retitle(f.path, input.value)
            : data.renameFile(f.path, input.value),
            (r) => isTitle ? `Retitled — ${input.value}` : `Renamed to ${r.path}`),
        }, isTitle ? 'Retitle' : 'Rename');
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
        line.appendChild(input);
        line.appendChild(go);
        rows.appendChild(line);
      });

      list.appendChild(row);
    });
  };

  /* One place where a fix is run, because every one of them can be refused —
     the new name is taken too, the file changed on disk, another tab holds the
     write lock — and a refusal that is not said out loud is the bug this whole
     dialog exists to end. */
  const run = async (btn, fn, said) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Working…';
    try {
      const r = await fn();
      if (!r || r.ok === false) {
        toast((r && (r.message || r.reason)) || 'That did not work', { tone: 'error' });
        return;
      }
      toast(typeof said === 'function' ? said(r) : said);
      paint();
    } catch (e) {
      toast('That did not work — ' + e.message, { tone: 'error' });
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  };

  const bg = h('div', {
    className: 'modal-bg',
    onClick: (e) => { if (e.target === bg) close(); },
  },
    h('div', { className: 'modal prob-modal' },
      h('div', { className: 'modal-hd' },
        h('b', null, 'Vault problems'),
        h('button', { className: 'sb-twk-x', onClick: close }, '\u2715')),
      h('div', { className: 'modal-body' }, lede, list)));
  paint();
  document.body.appendChild(bg);
  document.addEventListener('keydown', onKey, true);
  asDialog(bg);
}

/* The banner raises this from bridge.js, which cannot see app.js at all. */
window.addEventListener('sb:resolve-vault', () => {
  if (!document.querySelector('.prob-modal')) problemsDialog();
});

/* The shape of what is coming, instead of the word "loading".
 *
 * Seven screens printed a centred grey "loading…" — which tells you the app
 * is not broken and nothing else. A skeleton says how much is coming and in
 * what arrangement, so the layout does not jump when it lands, and the wait
 * reads as the page assembling rather than as the page being absent.
 *
 * Rows for a table, cards for a grid, lines for prose. The widths are varied
 * on purpose: a stack of identical bars reads as a loading graphic, and a
 * ragged right edge reads as text that has not arrived yet.
 */
const _SKEL_W = [92, 74, 86, 61, 80, 70, 88, 66];
function Skeleton(shape = 'rows', n = 6) {
  const wrap = h('div', { className: 'skel skel-' + shape, 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    const cell = h('div', { className: 'skel-cell' });
    cell.style.setProperty('--i', String(i));
    if (shape === 'rows') {
      cell.appendChild(h('span', { className: 'skel-bar skel-mark' }));
      const t = h('span', { className: 'skel-bar skel-title' });
      t.style.width = _SKEL_W[i % _SKEL_W.length] + '%';
      cell.appendChild(t);
      cell.appendChild(h('span', { className: 'skel-bar skel-when' }));
    } else if (shape === 'cards') {
      cell.appendChild(h('span', { className: 'skel-bar skel-card-t' }));
      const l = h('span', { className: 'skel-bar skel-card-l' });
      l.style.width = _SKEL_W[(i + 3) % _SKEL_W.length] + '%';
      cell.appendChild(l);
    } else {
      const l = h('span', { className: 'skel-bar' });
      l.style.width = _SKEL_W[i % _SKEL_W.length] + '%';
      cell.appendChild(l);
    }
    wrap.appendChild(cell);
  }
  // A screen reader gets a word; the eye gets the shape.
  wrap.appendChild(h('span', { className: 'sr-only', role: 'status' }, 'Loading…'));
  return wrap;
}

function EmptyState(msg, sub, action) {
  return h('div', { className: 'empty-state' },
    h('span', { className: 'empty-state-mark' }, brandMark()),
    h('div', { className: 'empty-state-msg' }, msg),
    sub ? h('div', { className: 'empty-state-sub' }, sub) : null,
    action || null);
}
function basename(slug) { return String(slug).split('/').pop(); }

/* 6.6: hand off to Obsidian. The vault name comes from the folder the user
   picked (bridge.js), so nothing here is hardcoded — SPEC §14. Returns null
   when we have no vault name, so callers can hide the affordance rather than
   render a link that cannot work. */
function obsidianUrl(vaultPath) {
  const vault = window.SB_VAULT_NAME || '';
  if (!vault || !vaultPath) return null;
  return 'obsidian://open?vault=' + encodeURIComponent(vault)
       + '&file=' + encodeURIComponent(vaultPath);
}

/* ── local data access + kind registry ────────────────────────────────── */

/* A feature that no longer exists. Named and thrown rather than silently
   returning nothing, so a missed call site is loud (task 6.8). */
function gone(what, why) {
  return Promise.reject(new Error(`${what} is gone — ${why}`));
}

/* The one place a legacy path string still reaches the data layer: a couple of
   list screens are parameterised by path. Translate rather than route. */
function pathToQuery(path) {
  const [, qs = ''] = String(path).split('?');
  const q = new URLSearchParams(qs);
  return {
    q: q.get('q') || '', kind: q.get('kind') || '', tag: q.get('tag') || '',
    mention: q.get('mention') || '',
    limit: q.get('limit') ? parseInt(q.get('limit'), 10) : 200,
  };
}

/* ── Page cache ─────────────────────────────────────────────────────
   Caches full page objects so navigating back to a recently-viewed page is
   instant. Bumped on save (commit) and invalidated on create/delete.
   30s TTL keeps it from drifting too long under heavy editing in other tabs. */
const _pageCache = new Map();  // id → { page, ts }
const PAGE_CACHE_TTL_MS = 5 * 60_000;  // 5 minutes — long enough that nav feels instant
function cacheGetPage(id) {
  const e = _pageCache.get(id);
  if (!e) return null;
  if (Date.now() - e.ts > PAGE_CACHE_TTL_MS) { _pageCache.delete(id); return null; }
  return e.page;
}
function cacheSetPage(p) {
  // Only ever cache a FULL page. List results carry the 300-char excerpt in
  // `body`; caching one made the page view render a truncated, whitespace-
  // collapsed body — which silently swallowed the `## Thread` section of any
  // page longer than the excerpt.
  if (p && p.id && p.bodyIsFull !== false) {
    _pageCache.set(p.id, { page: p, ts: Date.now() });
    noteTabTitle(p.id, p.title || p.slug);
  }
}

/* A tab is how you find a page again, so it has to say the page's name.
   The label was read from this cache alone — and the cache is empty on the
   render that opens the page, so a freshly opened tab said "Page · 01KVZA"
   until something unrelated happened to re-render the strip, and a reloaded
   window said it forever. The name is recorded on the tab instead: it
   persists with the tab, and it is patched into the strip in place rather
   than through render(), because this runs inside a load. */
function noteTabTitle(id, title) {
  if (!title || typeof app === 'undefined' || !app.tabs) return;
  let changed = false;
  for (const t of app.tabs) {
    if (t.route === 'page' && t.openPageId === id && t.title !== title) {
      t.title = title; changed = true;
    }
  }
  if (!changed) return;
  persistTabs();
  const nodes = document.querySelectorAll('.tabs .tab .tab-label');
  app.tabs.forEach((t, i) => { if (nodes[i]) nodes[i].textContent = tabLabel(t); });
}
function cacheInvalidatePage(id) { _pageCache.delete(id); }

async function getPageCached(id) {
  const cached = cacheGetPage(id);
  if (cached) return cached;
  const p = await SB.data().page(id);
  cacheSetPage(p);
  return p;
}
async function v2GetPagesBatch(ids) {
  if (!ids || !ids.length) return [];
  const needed = [];
  const cached = {};
  for (const id of ids) {
    const c = cacheGetPage(id);
    if (c) cached[id] = c;
    else needed.push(id);
  }
  if (needed.length) {
    try {
      const { items } = await SB.data().batch(needed);
      (items || []).forEach((p) => { cacheSetPage(p); cached[p.id] = p; });
    } catch (_) { /* fall through with what we have */ }
  }
  return ids.map((id) => cached[id]).filter(Boolean);
}

/* ── Tag + mention autocomplete ───────────────────────────────────
   Tags: pulled from /api/v2/tags (1-minute client cache). The list filters
   client-side as the user types. Pressing Enter on an empty highlight
   *creates* a new tag with the raw input.
   Mentions: live-search /api/v2/mentions/suggest?q=, returns page objects.
   Pressing Enter on a highlight inserts the page id. */
let _tagsCache = null;
let _tagsCacheTs = 0;
async function fetchAllTags() {
  if (_tagsCache && Date.now() - _tagsCacheTs < 60_000) return _tagsCache;
  try {
    const r = await SB.data().tags();
    _tagsCache = r.tags || [];
    _tagsCacheTs = Date.now();
  } catch (_) { _tagsCache = _tagsCache || []; }
  return _tagsCache;
}
function invalidateTagsCache() { _tagsCache = null; }

/* The ten tag hues, named so the picker can label them. The CSS owns the
   actual colours (`.tag-h0` … `.tag-h9`); this is only the vocabulary. */
const TAG_HUES = ['Lime', 'Amber', 'Rose', 'Violet', 'Sky',
                  'Emerald', 'Fuchsia', 'Orange', 'Slate', 'Teal'];

/* Chosen colours are a display preference, not vault content — they live in
   `sb.prefs` beside the theme, never in the markdown. Two reasons: most tags
   have no `tags/<name>.md` to write to, so colouring one would mean creating
   a file the user never asked for; and Obsidian has no way to render the key
   if we did. The vault stays notes, and nothing here is lost if it is dropped.

   Read through a cache: a 200-row table with four tags a row would otherwise
   parse localStorage 800 times per paint. */
let _tagColorsCache = null;
function tagColorMap() {
  if (!_tagColorsCache) _tagColorsCache = loadPrefs().tagColors || {};
  return _tagColorsCache;
}
function setTagColor(tag, idx) {
  const p = loadPrefs();
  const next = { ...(p.tagColors || {}) };
  const key = String(tag).toLowerCase();
  // null means "back to automatic" — the key is deleted rather than set to a
  // sentinel, so a tag never carries a stored value it no longer uses.
  if (idx == null) delete next[key]; else next[key] = idx;
  p.tagColors = next;
  savePrefs(p);
  _tagColorsCache = null;
}

/* A tag's emoji, if it has been given one.
   Rides the same store as its colour and for the same reason: it is how the
   tag LOOKS, not what the tag IS. The vault's copy of a tag is the word in
   `#tag` and the page in `tags/`, and neither gains a decoration field — an
   Obsidian user or an agent reading the file sees exactly what it saw
   before. Two clients can disagree about a colour or a glyph with no
   consequence; they cannot disagree about the word. */
let _tagEmojiCache = null;
function tagEmojiMap() {
  if (!_tagEmojiCache) _tagEmojiCache = loadPrefs().tagEmoji || {};
  return _tagEmojiCache;
}
function tagEmoji(t) {
  return tagEmojiMap()[String(t).toLowerCase()] || null;
}
function setTagEmoji(tag, glyph) {
  const p = loadPrefs();
  const next = { ...(p.tagEmoji || {}) };
  const key = String(tag).toLowerCase();
  // Only the first grapheme: a chip has room for one mark, and a pasted
  // string of six would blow the row height out.
  const g = [...String(glyph || '').trim()][0] || '';
  if (!g) delete next[key]; else next[key] = g;
  p.tagEmoji = next;
  savePrefs(p);
  _tagEmojiCache = null;
}

/* A tag chip: pill, sans, its own mark, and no × unless removal is offered.
   It was a 3px-radius box in JetBrains Mono with a permanent cross — mono
   said "machine text" about a word the user chose, and a delete control on
   every chip made a row of labels read as a row of buttons. */
function TagChip(t, opts = {}) {
  const { onClick = null, onRemove = null, extra = '', on = false } = opts;
  const glyph = tagEmoji(t);
  const chip = h('span', {
    className: 'tag-chip ' + tagHue(t) + (onRemove ? ' rm' : '')
      + (on ? ' is-on' : '') + (extra ? ' ' + extra : ''),
  },
    // The mark: the tag's emoji if it has one, otherwise a dot in its hue.
    // Never nothing — the chips line up on their glyph either way.
    glyph ? h('span', { className: 'tag-chip-e' }, glyph)
          : h('span', { className: 'tag-chip-d' }),
    h('span', { className: 'tag-chip-t' }, t));
  if (onClick) {
    chip.classList.add('tag-chip-click');
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.tag-chip-x')) return;
      onClick(e);
    });
  }
  if (onRemove) {
    chip.appendChild(h('button', {
      className: 'tag-chip-x', title: 'Remove #' + t, 'aria-label': 'Remove #' + t,
      onClick: (e) => { e.stopPropagation(); onRemove(e); },
    }, '×'));
  }
  return chip;
}

/* A mention, resolved for display.
   `page.mentions` stores whatever links a page: a title, a path, or — when
   the picker adds one — the target's id, which is the only form that
   survives a rename. An id is correct to STORE and unreadable to SHOW, and
   the header was showing it: a chip reading `01KVNOTJG0K41729ADK1…` next to
   five real names. The stored value is untouched; only the label changes. */
function resolveMention(mn) {
  const raw = String(mn || '');
  const idx = _pageIndexCache || {};
  const byId = idx[raw];
  if (byId) return { label: byId.title, id: raw, kind: byId.kind };
  // Not an id: a title or a path. Show the last segment without its
  // extension, which is what the link would have been written as.
  const stem = raw.split('/').pop().replace(/\.(md|canvas)$/i, '');
  const hit = Object.entries(idx)
    .find(([, v]) => String(v.title).toLowerCase() === stem.toLowerCase());
  return { label: stem, id: hit ? hit[0] : null, kind: hit ? hit[1].kind : null };
}

/* ── A mention is a wikilink in the body ────────────────────────────────────
   `page.mentions` is not a stored field. `buildIndex` derives it from the
   `[[...]]` in the text on every rebuild, so a link pushed onto that array and
   nowhere else was gone by the next load — which is precisely what "Link a
   page" did: it drew a chip, and the file never heard about it.

   The text transforms live in `vault/links.js` beside the rest of wikilink
   handling, where they are testable in Node and mirrored into the clipper. */

/** The links module. Read through a call rather than captured at module load:
 *  `bridge.js` publishes it on `window` and the order there is its business. */
const _links = () => window.SB_LINKS;

/* A mention chip: the same pill as a tag, wearing its target's kind instead
   of a hue. The two were different shapes in different fonts — a mono box
   with a permanent × beside a sans pill — which made one row of links read
   as two kinds of thing. */
function MentionChip(mn, opts = {}) {
  const { onClick = null, onRemove = null } = opts;
  const t = resolveMention(mn);
  const m = t.kind ? (KIND_META[t.kind] || {}) : {};
  const chip = h('span', { className: 'mention-chip' + (onRemove ? ' rm' : ''), title: String(mn) },
    h('span', { className: 'mention-chip-i', style: m.color ? { color: m.color } : null },
      icon(m.icon || 'link-2')),
    h('span', { className: 'mention-chip-t' }, t.label));
  if (onClick && t.id) {
    chip.classList.add('mention-chip-click');
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.mention-chip-x')) return;
      onClick(e);
    });
  }
  if (onRemove) {
    chip.appendChild(h('button', {
      className: 'mention-chip-x', title: 'Remove this link',
      'aria-label': 'Remove link ' + t.label,
      onClick: (e) => { e.stopPropagation(); onRemove(e); },
    }, '×'));
  }
  return chip;
}

/* A tag's colour: the one you picked, or failing that one derived from its
   name — so the same tag wears the same hue in a chip row, the cloud and
   inline prose, with no registry to keep in sync. A hash collision just means
   two tags share a colour, which is fine: the hue is a scent, not an
   identifier, and now it is also overridable. */
function tagHue(t) {
  const s = String(t);
  const picked = tagColorMap()[s.toLowerCase()];
  if (Number.isInteger(picked) && picked >= 0 && picked < TAG_HUES.length) {
    return 'tag-h' + picked;
  }
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return 'tag-h' + (x % TAG_HUES.length);
}
async function searchTags(q, exclude) {
  const all = await fetchAllTags();
  const needle = (q || '').toLowerCase();
  const ex = new Set((exclude || []).map((t) => t.toLowerCase()));
  return all
    .filter((t) => !ex.has(t.tag.toLowerCase()) && t.tag.toLowerCase().includes(needle))
    .slice(0, 8);
}
async function searchMentions(q, exclude) {
  const text = (q || '').trim();
  if (!text) return [];
  try {
    const r = await SB.data().suggestMentions(text);
    const ex = new Set(exclude || []);
    return (r.items || []).filter((it) => !ex.has(it.id));
  } catch (_) { return []; }
}

/* ── One picker, for tags and for pages ────────────────────────────────
   Tagging used to look different in every place it happened: an inline
   field with its own dropdown in the page header, a bare `<input list=…>`
   on an inspo card, and a space-separated `#a #b` text box in Arrange.
   Three behaviours, three keyboard contracts, and only one of them could
   create a tag that did not exist yet.

   This is the single one. It is the shape the tools that do this well use
   — Jira's label field, Notion's multi-select: a small panel anchored to
   whatever you clicked, a search box already focused, a list you can walk
   with the arrow keys, and a "Create" row that is a REAL row in that list
   rather than a special case you can only reach with the mouse.

   It picks tags or pages depending on `search`; everything else — layout,
   keys, dismissal, the create affordance — is identical, because to the
   person using it the two are the same gesture aimed at different things.

   Returns a close() so a caller can dismiss it (the expanded card does). */
function openPicker(anchor, opts) {
  const {
    placeholder = 'Search…', search, onPick, onCreate = null,
    createLabel = (t) => `Create “${t}”`, hint = null, multi = true,
  } = opts;

  document.querySelectorAll('.pk-pop').forEach((n) => n.__close && n.__close());

  const pop = h('div', { className: 'pk-pop', role: 'dialog' });
  const input = h('input', {
    className: 'pk-input', placeholder, autocomplete: 'off', spellcheck: 'false',
    'aria-label': placeholder,
  });
  const list = h('div', { className: 'pk-list', role: 'listbox' });
  pop.append(h('div', { className: 'pk-search' }, icon('search'), input), list);
  if (hint) pop.appendChild(h('div', { className: 'pk-hint' }, hint));

  let rows = [];          // [{ kind:'item'|'create', row?, text? }]
  let hi = 0;
  let timer = null;

  const close = () => {
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    pop.remove();
    if (opts.onClose) opts.onClose();
  };
  pop.__close = close;

  /* Anchored to the trigger, flipped up when there is no room below, and
     nudged back inside the viewport horizontally. Fixed-position so it is
     not clipped by the `overflow: hidden` on .page-main. */
  function place() {
    const r = anchor.getBoundingClientRect();
    const w = 260, maxH = 320;
    let left = Math.min(r.left, window.innerWidth - w - 12);
    left = Math.max(12, left);
    const below = window.innerHeight - r.bottom;
    pop.style.width = w + 'px';
    pop.style.left = left + 'px';
    if (below < 200 && r.top > below) {
      pop.style.top = 'auto';
      pop.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      pop.style.maxHeight = Math.min(maxH, r.top - 16) + 'px';
    } else {
      pop.style.bottom = 'auto';
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.maxHeight = Math.min(maxH, below - 16) + 'px';
    }
  }

  function paintHi() {
    [...list.children].forEach((el, i) => {
      const on = i === hi;
      el.classList.toggle('is-hl', on);
      el.setAttribute('aria-selected', String(on));
      if (on && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    });
  }

  async function refresh() {
    const q = input.value.trim();
    let items = [];
    try { items = (await search(q)) || []; } catch (_) { items = []; }
    rows = items.map((row) => ({ kind: 'item', row }));
    // The create row is a row. Reachable by arrow key, highlighted like any
    // other, and only offered when it would not duplicate an existing one.
    if (onCreate && q && !items.some((i) => String(i.label).toLowerCase() === q.toLowerCase())) {
      rows.push({ kind: 'create', text: q });
    }
    hi = rows.length ? 0 : -1;
    clear(list);
    if (!rows.length) {
      list.appendChild(h('div', { className: 'pk-empty' },
        q ? 'Nothing matches' : 'Type to search'));
      return;
    }
    rows.forEach((r, i) => {
      const el = r.kind === 'create'
        ? h('div', { className: 'pk-row pk-row-create', role: 'option' },
            h('span', { className: 'pk-row-g' }, icon('plus')),
            h('span', { className: 'pk-row-l' }, createLabel(r.text)))
        : h('div', { className: 'pk-row', role: 'option' },
            r.row.swatch
              ? h('span', { className: 'pk-swatch ' + r.row.swatch })
              : h('span', { className: 'pk-row-g', style: r.row.color ? { color: r.row.color } : null },
                  icon(r.row.icon || 'tag')),
            h('span', { className: 'pk-row-l' }, markedText(r.row.label, q)),
            r.row.hint ? h('span', { className: 'pk-row-h' }, r.row.hint) : null);
      el.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      el.addEventListener('mouseenter', () => { hi = i; paintHi(); });
      list.appendChild(el);
    });
    paintHi();
    place();
  }

  async function choose(i) {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'create') { await onCreate(r.text); }
    else { await onPick(r.row); }
    if (!multi) { close(); return; }
    input.value = '';
    input.focus();
    refresh();
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 90); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (rows.length) { hi = (hi + 1) % rows.length; paintHi(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) { hi = (hi - 1 + rows.length) % rows.length; paintHi(); } }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hi); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });

  const onDocDown = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const onDocKey = (e) => { if (e.key === 'Escape' && document.contains(pop)) close(); };
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onDocKey, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);

  document.body.appendChild(pop);
  place();
  input.focus();
  refresh();
  return close;
}

/** The trigger that opens a picker. One shape wherever something is added to
 *  a chip row, so "add a tag" and "link a page" are visibly the same move. */
function chipAdd(glyph, label, open) {
  const btn = h('button', {
    className: 'chip-add', title: label, 'aria-label': label,
    onClick: (e) => { e.stopPropagation(); open(btn); },
  }, icon(glyph), h('span', { className: 'chip-add-l' }, label));
  return btn;
}

/** Rows for the tag picker: every tag in the vault, minus the ones already on. */
function tagRows(exclude) {
  const ex = new Set((exclude || []).map((t) => String(t).toLowerCase()));
  return async (q) => {
    let all = [];
    try { all = (SB.data().tags().tags || []); } catch (_) {}
    const needle = String(q || '').toLowerCase();
    return all
      .filter((t) => !ex.has(t.tag.toLowerCase()) && t.tag.toLowerCase().includes(needle))
      .slice(0, 40)
      .map((t) => ({ key: t.tag, label: t.tag, swatch: tagHue(t.tag),
                     hint: t.count ? String(t.count) : null }));
  };
}

/** Rows for the page picker — the same shell, pages instead of tags. */
function pageRows(exclude) {
  return async (q) => {
    const ex = new Set(exclude || []);
    let items = [];
    try { items = ((await SB.data().suggestMentions(q || '')).items || []); } catch (_) {}
    return items.filter((it) => !ex.has(it.id)).slice(0, 40).map((it) => ({
      key: it.id, label: it.title, id: it.id,
      icon: (metaForPage(it).icon || 'file-text'),
      color: metaForPage(it).color, hint: metaForPage(it).label,
    }));
  };
}

function AutocompleteInput(opts) {
  const { placeholder, fetchSuggestions, onPick, renderItem, allowCreate } = opts;
  const wrap = h('div', { className: 'ac-wrap' });
  const input = h('input', { className: 'chip-input ac-input', placeholder });
  const dropdown = h('div', { className: 'ac-dropdown' });
  let suggestions = [];
  let highlighted = -1;
  let debounceTimer = null;
  let closed = true;

  function open() { closed = false; dropdown.style.display = 'block'; }
  function close() { closed = true; dropdown.style.display = 'none'; }
  close();

  async function refresh() {
    const q = input.value;
    suggestions = await fetchSuggestions(q);
    highlighted = suggestions.length ? 0 : -1;
    clear(dropdown);
    if (!suggestions.length && !(allowCreate && q.trim())) { close(); return; }
    if (allowCreate && q.trim() && !suggestions.some((s) => (s.tag || s.title || '').toLowerCase() === q.trim().toLowerCase())) {
      const createRow = h('div', { className: 'ac-item ac-item-create',
        onMouseDown: (e) => { e.preventDefault(); pickCreate(q.trim()); },
      }, h('span', { className: 'ac-create-marker' }, '+'), 'create "', q.trim(), '"');
      dropdown.appendChild(createRow);
    }
    suggestions.forEach((it, idx) => {
      dropdown.appendChild(h('div', {
        className: 'ac-item' + (idx === highlighted ? ' ac-item-hl' : ''),
        onMouseDown: (e) => { e.preventDefault(); pickIdx(idx); },
        onMouseEnter: () => { highlighted = idx; refreshHighlight(); },
      }, renderItem(it)));
    });
    open();
  }
  function refreshHighlight() {
    dropdown.querySelectorAll('.ac-item').forEach((el, i) => {
      // Account for the "create" row offset (it's not in suggestions[])
      const hasCreateRow = dropdown.firstChild && dropdown.firstChild.classList.contains('ac-item-create');
      const offset = hasCreateRow ? 1 : 0;
      el.classList.toggle('ac-item-hl', i === highlighted + offset);
    });
  }
  function pickIdx(idx) {
    if (idx < 0 || idx >= suggestions.length) return;
    onPick({ existing: suggestions[idx] });
    input.value = ''; close();
  }
  function pickCreate(raw) {
    if (!raw) return;
    onPick({ created: raw });
    input.value = ''; close();
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 120);
  });
  input.addEventListener('focus', () => { refresh(); });
  input.addEventListener('keydown', (e) => {
    if (closed && e.key !== 'Enter' && e.key !== 'ArrowDown') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (closed) refresh();
      if (suggestions.length) {
        highlighted = (highlighted + 1) % suggestions.length;
        refreshHighlight();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length) {
        highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
        refreshHighlight();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < suggestions.length) pickIdx(highlighted);
      else if (allowCreate && input.value.trim()) pickCreate(input.value.trim());
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', () => {
    // Defer so mousedown on a dropdown row fires first
    setTimeout(close, 150);
  });

  wrap.appendChild(input);
  wrap.appendChild(dropdown);
  return wrap;
}


/* ── Icons — inlined lucide (shadcn's icon set) ─────────────────────────
   Path markup vendored so the no-build rule holds. Rendered through a span
   wrapper via innerHTML because h() has no SVG namespace support. Icons
   inherit `currentColor` and size via font-size (1em). */
const LUCIDE = {
  'panel-left-close': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  'panel-left-open':  '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  'link-2':      '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left':  '<path d="m15 18-6-6 6-6"/>',
  'chevron-down':  '<path d="m6 9 6 6 6-6"/>',
  'history':     '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'check':       '<path d="M20 6 9 17l-5-5"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'download':    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'braces':      '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  'trash-2':     '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'home':        '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'files':       '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l5 5v9a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/>',
  'message-circle': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  'waypoints':   '<circle cx="12" cy="4.5" r="2.5"/><path d="m10.2 6.3-3.9 3.9"/><circle cx="4.5" cy="12" r="2.5"/><path d="M7 12h10"/><circle cx="19.5" cy="12" r="2.5"/><path d="m13.8 17.7 3.9-3.9"/><circle cx="12" cy="19.5" r="2.5"/>',
  'shapes':      '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  'pilcrow':     '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  'file-text':   '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'bookmark':    '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  'sticky-note': '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l7-7V5a2 2 0 0 0-2-2Z"/><path d="M15 22v-5a2 2 0 0 1 2-2h5"/>',
  'image':       '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'user-round':  '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  'users-round': '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
  'folder':      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'tag':         '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  'at-sign':     '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  'pen-line':    '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  'feather':     '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  'circle-user': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>',
  'settings':    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'arrow-down-up': '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  'database':    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  'search':      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'plus':        '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'x':           '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'sparkles':    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
};
function icon(name, cls) {
  return h('span', {
    className: 'lucide' + (cls ? ' ' + cls : ''),
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name] || ''}</svg>`,
  });
}

/* ── Brand ──────────────────────────────────────────────────────────────
   The CV monogram and the CANON-VAULT wordmark, inlined from the source
   artwork in app/icons/. Inlined rather than <img src>'d because the
   deployed CSP blocks an external request and there is no build step to
   inline one at ship time.

   Both are OUTLINED — filled paths, not live strokes. That is what makes
   them hold up from 16px to 512px: there is no stroke width to scale down
   into a sub-pixel smear, which is exactly what made the earlier
   stroke-based placeholder look washed out in a favicon.

   The single fill is `currentColor`, so one asset serves both themes — the
   source exports carry `fill="black"`, which is invisible on the dark
   ground, and that substitution is the only edit made to them.

   TO UPDATE: re-export from app/icons/mark.svg and app/icons/wordmark.svg,
   swap the path data below, and keep each viewBox in sync with its file.
   app/vault/bridge.js holds a second copy for the first-run screen. */
const BRAND_MARK_VB = '0 0 144 100';
const BRAND_MARK = `<path d="M49.6426 11.3103C58.0084 10.2422 66.4938 11.9487 73.7959 16.1687C79.489 19.4587 84.2172 24.1354 87.5654 29.7243C89.1394 32.3521 87.7727 35.6274 84.9463 36.8083C82.1207 37.9888 78.9145 36.6121 77.1885 34.0827C72.2514 26.8472 63.9417 22.0965 54.5215 22.0964C39.3753 22.0964 27.0967 34.375 27.0967 49.5212C27.0967 64.6673 39.3753 76.946 54.5215 76.946C61.1452 76.9459 67.2197 74.5962 71.959 70.6862C74.3225 68.7365 77.7872 68.3119 80.1709 70.237C82.5557 72.1631 82.9517 75.6935 80.7031 77.7771C75.9253 82.2042 70.0782 85.3689 63.6933 86.9343C55.5022 88.9424 46.8782 88.2067 39.1455 84.8405C31.4128 81.4742 24.998 75.6632 20.8867 68.2995C16.7755 60.9358 15.1949 52.4258 16.3867 44.0769C17.5787 35.7279 21.4779 28.0009 27.4853 22.0817C33.4929 16.1626 41.2768 12.3784 49.6426 11.3103ZM118.446 34.2038C120.06 31.4092 123.681 30.5291 126.397 32.2712C128.903 33.8786 129.734 37.1532 128.297 39.7605L104.945 82.1384C102.861 85.9205 97.4132 85.8849 95.3789 82.0759L82.4726 57.9099C80.797 54.7724 77.4572 52.8875 73.9053 53.0749L64.3369 53.5788C62.7427 57.431 58.9497 60.1421 54.5215 60.1423C48.6556 60.1423 43.9004 55.387 43.9004 49.5212C43.9004 43.6553 48.6556 38.9001 54.5215 38.9001C59.1359 38.9003 63.0619 41.8435 64.5273 45.9548H82.7578C86.0319 45.9549 89.0572 47.7014 90.6943 50.5368L99.8555 66.404L118.446 34.2038Z" fill="currentColor"/>`;

const BRAND_WORD_VB = '0 0 1712 91';
const BRAND_WORD = `<path d="M58.9241 90.7148C22.4681 90.7148 0 73.4966 0 45.327C0 17.3398 22.8178 0 58.487 0C81.8294 0 100.276 7.6052 108.581 20.4428C109.98 22.4505 110.679 24.5191 110.679 26.3444C110.679 30.5425 106.745 33.2195 100.713 33.2195C95.555 33.2195 92.1455 31.5159 89.6976 27.6829C83.8401 18.2525 72.3875 13.3243 58.6619 13.3243C36.9806 13.3243 23.0801 25.736 23.0801 45.327C23.0801 65.0396 36.8932 77.3905 58.7493 77.3905C73.1744 77.3905 84.2773 73.0099 90.0473 63.762C92.3203 60.1723 95.2053 58.7121 100.101 58.7121C106.308 58.7121 110.592 61.5717 110.592 65.7089C110.592 67.7167 109.893 69.5419 108.494 71.6105C100.451 83.5355 82.5288 90.7148 58.9241 90.7148Z" fill="currentColor"/> <path d="M181.228 90.2889C174.321 90.2889 169.862 87.4902 169.862 83.0487C169.862 81.8319 170.3 80.1283 171.349 78.2422L207.98 8.94371C211.039 3.10292 216.11 0.425891 224.328 0.425891C232.633 0.425891 237.704 2.98124 240.851 8.88287L277.569 78.2422C278.619 80.25 279.056 81.6494 279.056 83.0487C279.056 87.3076 274.335 90.2889 267.778 90.2889C261.658 90.2889 258.249 88.3419 256.238 83.6571L247.933 66.8649H200.811L192.505 83.5355C190.407 88.2811 187.085 90.2889 181.228 90.2889ZM206.144 54.4532H242.425L224.503 16.9748H223.891L206.144 54.4532Z" fill="currentColor"/> <path d="M354.762 90.2889C347.943 90.2889 343.834 87.3685 343.834 82.3795V8.51782C343.834 3.46797 348.292 0.425891 355.549 0.425891C360.532 0.425891 363.592 1.64272 367.264 5.11069L426.013 62.971H426.8V8.33529C426.8 3.34629 430.909 0.425891 437.64 0.425891C444.459 0.425891 448.481 3.34629 448.481 8.33529V82.4403C448.481 87.4293 444.372 90.2889 437.028 90.2889C431.87 90.2889 428.898 89.1329 425.313 85.6041L366.389 27.6829H365.602V82.3795C365.602 87.3685 361.494 90.2889 354.762 90.2889Z" fill="currentColor"/> <path d="M574.719 90.7148C537.913 90.7148 514.833 73.3141 514.833 45.3878C514.833 17.4615 537.913 0 574.719 0C611.437 0 634.517 17.4615 634.517 45.3878C634.517 73.3141 611.437 90.7148 574.719 90.7148ZM574.719 77.3296C597.187 77.3296 611.524 64.9179 611.524 45.3878C611.524 25.7968 597.187 13.3851 574.719 13.3851C552.163 13.3851 537.913 25.7968 537.913 45.3878C537.913 64.9179 552.163 77.3296 574.719 77.3296Z" fill="currentColor"/> <path d="M711.797 90.2889C704.978 90.2889 700.869 87.3685 700.869 82.3795V8.51782C700.869 3.46797 705.327 0.425891 712.584 0.425891C717.567 0.425891 720.627 1.64272 724.298 5.11069L783.048 62.971H783.835V8.33529C783.835 3.34629 787.944 0.425891 794.675 0.425891C801.494 0.425891 805.516 3.34629 805.516 8.33529V82.4403C805.516 87.4293 801.407 90.2889 794.063 90.2889C788.905 90.2889 785.933 89.1329 782.348 85.6041L723.424 27.6829H722.637V82.3795C722.637 87.3685 718.528 90.2889 711.797 90.2889Z" fill="currentColor"/> <path d="M884.369 60.3548C878.424 60.3548 873.966 57.7995 873.966 53.6014C873.966 49.4033 878.424 46.848 884.369 46.848H923.885C929.917 46.848 934.289 49.4033 934.289 53.6014C934.289 57.7995 929.917 60.3548 923.885 60.3548H884.369Z" fill="currentColor"/> <path d="M1045.58 90.2889C1037.18 90.2889 1032.38 87.7944 1029.14 81.7102L991.461 12.0466C990.587 10.5256 990.237 9.06539 990.237 7.66604C990.237 3.34629 994.958 0.425891 1001.95 0.425891C1007.81 0.425891 1011.39 2.25114 1013.23 6.38836L1045.66 72.4015H1046.19L1078.54 6.26668C1080.46 2.12945 1083.69 0.425891 1089.55 0.425891C1096.37 0.425891 1101.09 3.34629 1101.09 7.48351C1101.09 8.88287 1100.65 10.2822 1099.87 11.7424L1061.93 81.7711C1058.78 87.7944 1053.97 90.2889 1045.58 90.2889Z" fill="currentColor"/> <path d="M1157.04 90.2889C1150.13 90.2889 1145.67 87.4902 1145.67 83.0487C1145.67 81.8319 1146.11 80.1283 1147.16 78.2422L1183.79 8.94371C1186.85 3.10292 1191.92 0.425891 1200.14 0.425891C1208.45 0.425891 1213.52 2.98124 1216.66 8.88287L1253.38 78.2422C1254.43 80.25 1254.87 81.6494 1254.87 83.0487C1254.87 87.3076 1250.15 90.2889 1243.59 90.2889C1237.47 90.2889 1234.06 88.3419 1232.05 83.6571L1223.74 66.8649H1176.62L1168.32 83.5355C1166.22 88.2811 1162.9 90.2889 1157.04 90.2889ZM1181.96 54.4532H1218.24L1200.31 16.9748H1199.7L1181.96 54.4532Z" fill="currentColor"/> <path d="M1369.91 90.7148C1338 90.7148 1318.07 77.4513 1318.07 58.2862V8.57866C1318.07 3.40713 1322.36 0.425891 1329.35 0.425891C1336.43 0.425891 1340.63 3.40713 1340.63 8.57866V56.8869C1340.63 68.8726 1351.21 77.0254 1369.91 77.0254C1388.62 77.0254 1399.29 68.8726 1399.29 56.8869V8.57866C1399.29 3.40713 1403.49 0.425891 1410.57 0.425891C1417.56 0.425891 1421.76 3.40713 1421.76 8.57866V58.2862C1421.76 77.4513 1401.91 90.7148 1369.91 90.7148Z" fill="currentColor"/> <path d="M1503.76 89.2546C1496.76 89.2546 1492.48 86.2125 1492.48 81.1018V8.57866C1492.48 3.40713 1496.76 0.425891 1503.76 0.425891C1510.84 0.425891 1515.04 3.40713 1515.04 8.57866V75.9911H1563.38C1569.5 75.9911 1573.7 78.5465 1573.7 82.6228C1573.7 86.6992 1569.59 89.2546 1563.38 89.2546H1503.76Z" fill="currentColor"/> <path d="M1661.56 90.2889C1654.56 90.2889 1650.37 87.3076 1650.37 82.1361V14.7237H1621.52C1615.4 14.7237 1611.2 12.1683 1611.2 8.09193C1611.2 4.01554 1615.31 1.4602 1621.52 1.4602H1701.68C1707.89 1.4602 1712 4.01554 1712 8.09193C1712 12.1683 1707.8 14.7237 1701.68 14.7237H1672.83V82.1361C1672.83 87.3076 1668.64 90.2889 1661.56 90.2889Z" fill="currentColor"/>`;

function brandMark(cls) {
  return h('span', {
    className: 'brand-mark' + (cls ? ' ' + cls : ''),
    html: `<svg viewBox="${BRAND_MARK_VB}" fill="currentColor" aria-hidden="true">${BRAND_MARK}</svg>`,
  });
}
function brandWord(cls) {
  return h('span', {
    className: 'brand-word' + (cls ? ' ' + cls : ''),
    html: `<svg viewBox="${BRAND_WORD_VB}" fill="currentColor" aria-hidden="true">${BRAND_WORD}</svg>`,
  });
}

const KIND_META = {
  'note':     { label: 'Note',     icon: 'file-text', glyph: '§', color: 'var(--k-mdwn)',   hint: 'Anything read as prose. A bookmark, a quote, an article — the chrome follows the frontmatter.' },
  'canvas':   { label: 'Canvas',   icon: 'shapes', glyph: '▦', color: 'var(--k-canvas)',  hint: 'A JSON Canvas file. Obsidian’s format and Obsidian’s to edit — this app links out to it rather than rendering it.' },
  'topic':    { label: 'Topic',    icon: 'pilcrow', glyph: '¶', color: 'var(--k-topic)',   hint: 'A text page for a subject you want to think through.' },
  'markdown': { label: 'Markdown', icon: 'file-text', glyph: '§', color: 'var(--k-mdwn)',   hint: 'A rendered markdown article — section headers, pulled quotes, related, contradicts. Beautiful long-form.' },
  'bookmark': { label: 'Bookmark', icon: 'bookmark', glyph: '↗', color: 'var(--k-book)',   hint: 'A URL with context, tags, and connections.' },
  'snippet':  { label: 'Snippet',  icon: 'sticky-note', glyph: '∙', color: 'var(--k-snip)',   hint: 'A quick thought. Mature it into anything later.' },
  'inspo':    { label: 'Inspo',    icon: 'image', glyph: '◫', color: 'var(--k-desg)',    hint: 'A page of inspiration items — local images or pasted links, each with caption and tags.' },
  'project':  { label: 'Project',  icon: 'folder', glyph: '⚐', color: 'var(--k-proj)',   hint: 'A folder that holds pages. Not a kind — a container for the others.' },
  'wproject': { label: 'Project',  glyph: '⚑', color: 'var(--k-proj)',   hint: 'A work / design project — holds its IA, flows, components and tokens. Separate from personal projects.' },
};
function kindIcon(kind, cls) {
  const meta = KIND_META[kind];
  return icon(meta && meta.icon ? meta.icon : 'file-text', cls);
}
// `kind: canvas` covers two file formats that behave nothing alike here: a
// `.canvas` board is Obsidian's, read-only; a `.excalidraw.md` drawing is ours,
// fully editable. Showing both under one "Canvas" pill was the single most
// confusing thing about the model — you could not tell from the page whether
// your edits would be kept. This is the one place that decides, so the header,
// the lists and the project view cannot drift apart.
/* "Board" is this word now. It named the `.canvas` reader until that was
   removed; with one spatial editor left there is no second thing to
   distinguish it from, and "Board" is what people call the surface. The
   `.canvas` files still in vaults take the name of their actual format below —
   JSON Canvas — which is more accurate than "Board" ever was for a file this
   app cannot edit. Two things must never both be called Board. */
const DRAWING_META = {
  label: 'Board', icon: 'shapes', glyph: '✎', color: 'var(--k-canvas)',
  hint: 'A drawing surface — shapes, arrows, handwriting. Saved as Excalidraw, edited here and in Obsidian.',
};
function isDrawingPath(path) { return /\.excalidraw\.md$/i.test(String(path || '')); }
/* Registered under its facet name so every `KIND_META[k]` lookup — the nav,
   tab labels, kind cards — resolves the Board facet without a special case.
   Same OBJECT as DRAWING_META, so identity comparisons keep working. */
KIND_META.drawing = DRAWING_META;
/** The chrome for a page, splitting `canvas` by file format. */
function metaForPage(p) {
  /* `projects/X/X.md` is a folder note. Whatever `kind:` it carries on disk,
     the app renders it as the project — a container listing what is inside
     it — and it used to wear a "Topic" pill above that, which is the label
     contradicting the chrome. Same rule as the bookmark below, and the same
     bargain: the derived facet takes the pill, the stored kind keeps the
     count, and Projects tallies separately. */
  if (p && /^projects\/([^/]+)\/\1\.md$/.test(String(p.path || ''))) return KIND_META.project;
  if (p && p.kind === 'canvas' && isDrawingPath(p.path)) return DRAWING_META;
  /* A note carrying a url IS a bookmark as far as the reader is concerned:
     the sidebar files it under Bookmark, the page renders the bookmark
     chrome. It used to keep saying "Note" on its own kind pill, because
     bookmark is a derived facet rather than a stored kind — a true fact
     about the data model that the user has no reason to know. The label
     follows the chrome, decided here, once. */
  /* `url` at the top level, not just `meta.url`: a full page object carries
     it under meta, an index entry from `pages()` carries it hoisted — and
     `data.js` derives the whole bookmark facet from the hoisted one. Reading
     only meta.url meant every bookmark in every list was still a "Note". */
  /* And `!= null` rather than truthy, the same test `noteChrome` and the
     bookmark facet make: a note whose url is the empty string is a bookmark
     with no link in it yet, and it wore a "Note" pill in the very list that
     had filed it under Bookmark. */
  const url = p && (p.url != null ? p.url : (p.meta && p.meta.url));
  if (p && p.kind === 'note' && url != null) return KIND_META.bookmark;
  return KIND_META[p && p.kind] || KIND_META.note;
}
// "by kind" capture types.
// SPEC §5: 13 kinds collapsed to 4. The old markdown/bookmark/snippet entries
// stay in KIND_META only as a fallback for a stranger's vault; they are not
// offered anywhere, because `note` chrome is decided by frontmatter (§5).
/* `canvas` is absent on purpose, and it is the one entry whose absence needs
   explaining: it was the Board row. The app has one spatial editor now, so
   Board is neither a row you can browse nor a thing you can create — a nav row
   offering a kind the app cannot make or edit is an offer it cannot keep.
   Boards already in a vault are not hidden: they keep the Board pill from
   `metaForPage`, they are searched and linked like any page, and opening one
   says whose format it is. `drawing` below is the whole of the canvas kind the
   app owns. */
const KIND_ORDER = ['note', 'bookmark', 'topic', 'drawing', 'inspo'];
// Work-mode (design architecture) kinds. Same store + same mention/tag graph
// as the personal kinds above; only the surface (nav, home, create) differs.

/* A kind marker.
   This used to be a bordered, tinted, labelled box on every row — six of them
   down a column already headed "Kind", each one a little rectangle competing
   with the title beside it. In a table the column says what the value means,
   so the marker only has to say WHICH, and a coloured icon does that faster
   than a word does. `withLabel` is for the places that have no column header
   to lean on. */
/* Takes the PAGE, not its `kind` string. It used to take the string, and both
   call sites had a page in hand and passed `p.kind` — so a bookmark wore the
   note icon and announced itself as "Note", and a drawing wore the board icon
   and said "Board", in the two tables where you meet most of your vault.
   metaForPage is the one place that decides; this now asks it. */
function KindChip(page, opts = {}) {
  const p = (page && typeof page === 'object') ? page : { kind: page };
  const meta = metaForPage(p) || { label: p.kind, color: 'var(--muted)' };
  const glyph = icon(meta.icon || 'file-text');
  if (!opts.withLabel) {
    return h('span', {
      className: 'kind-mark' + (opts.large ? ' lg' : ''),
      style: { '--k-c': meta.color },
      title: meta.label,
      'aria-label': meta.label,
    }, glyph);
  }
  return h('span', {
    className: 'kind-chip' + (opts.large ? ' lg' : ''),
    style: { '--k-c': meta.color },
    title: meta.hint,
  },
    h('span', { className: 'kind-chip-g' }, glyph),
    h('span', null, meta.label));
}

/* Inline #hashtags found in a body (code stripped). Obsidian-style, nested with /. */
const _INLINE_TAG_RE = /(?:(?<=\s)|(?<=^))#([A-Za-z0-9_][A-Za-z0-9_/\-]*)/gm;
function extractInlineTags(body) {
  if (!body) return [];
  const scan = String(body).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const seen = new Set(); const out = [];
  let m;
  _INLINE_TAG_RE.lastIndex = 0;
  while ((m = _INLINE_TAG_RE.exec(scan))) {
    const low = m[1].toLowerCase();
    if (!seen.has(low)) { seen.add(low); out.push(m[1]); }
  }
  return out;
}

/* Wrap #hashtags in already-rendered HTML as chips (skips code/pre/headings). */
function decorateHashtags(rootEl) {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.closest('code, pre, a, h1, h2, h3, h4, .hashtag')) return NodeFilter.FILTER_REJECT;
      return /#[A-Za-z0-9_][A-Za-z0-9_/\-]*/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let last = 0;
    const text = node.nodeValue;
    const re = /(^|\s)#([A-Za-z0-9_][A-Za-z0-9_/\-]*)/g;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length;
      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
      frag.appendChild(h('span', { className: 'hashtag ' + tagHue(m[2]) }, '#' + m[2]));
      last = start + 1 + m[2].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

/* Cached id → {title, kind, slug} map for resolving [[id]] mentions to titles. */
let _pageIndexCache = null;
async function getPageIndex(force) {
  if (_pageIndexCache && !force) return _pageIndexCache;
  try {
    const { items } = await SB.data().pages({ limit: 10000 });
    const map = {};
    (items || []).forEach((p) => {
      map[p.id] = { title: p.title || p.slug || p.id.slice(0, 8), kind: p.kind, slug: p.slug };
    });
    _pageIndexCache = map;
    return map;
  } catch (_) {
    return _pageIndexCache || {};
  }
}
function invalidatePageIndex() { _pageIndexCache = null; }

/* A vault-relative path → the indexed page at it, or null. JSON Canvas `file`
   nodes address by path, unlike wikilinks (which go basename → alias → path),
   so this is a plain lookup and deliberately not `resolveWikilink`. */
function pageByPath(path) {
  const want = String(path || '').replace(/^\.?\//, '').toLowerCase();
  if (!want) return null;
  const entries = (window.SB_VAULT && window.SB_VAULT.list()) || [];
  return entries.find((e) => String(e.path || '').toLowerCase() === want) || null;
}

/* 6.10: turn wikilinks in rendered HTML into clickable links, resolved the way
   Obsidian resolves them — basename → aliases → relative path, case-insensitive.
   Handles [[T]], [[T|display]], [[T#heading]] and ![[file]] embeds. A link is
   only marked `.broken` when it genuinely resolves to nothing. */
function decorateMentions(rootEl) {
  const L = window.SB_LINKS;
  const entries = (window.SB_VAULT && window.SB_VAULT.list()) || [];
  if (!L) return;

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || p.closest('code, pre, a, .mention-link')) return NodeFilter.FILTER_REJECT;
      return /!?\[\[[^\]\n]+\]\]/.test(node.nodeValue)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  for (const node of targets) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const link of L.findWikilinks(text)) {
      if (link.start > last) frag.appendChild(document.createTextNode(text.slice(last, link.start)));
      last = link.end;

      if (link.embed && L.isEmbeddableFile(link.target)) {
        frag.appendChild(renderVaultEmbed(link.target));
        continue;
      }
      const hit = L.resolveWikilink(link.target, entries);
      const label = link.display || (hit ? hit.title : link.target);
      /* A resolved link reads like the page it goes to: the kind's own icon
         in the kind's own colour, then the title in body ink with a quiet
         underline. The old arrow glyph said "this is a link" louder than it
         said where to; the icon answers both at once. */
      const meta = hit ? metaForPage(hit) : null;
      frag.appendChild(h('span', {
        className: 'mention-link' + (hit ? '' : ' broken'),
        title: hit ? (meta.label + ' · ' + hit.path) : 'unresolved — no file of that name',
        onClick: () => { if (hit) openPage(hit.id); },
      },
        hit ? h('span', { className: 'mention-link-i',
          style: { color: meta.color || 'var(--muted)' } },
          icon(meta.icon || 'file-text')) : null,
        h('span', { className: 'mention-link-t' },
          label + (link.heading ? ' §' + link.heading : ''))));
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

/* 6.11: an ![[image]] embed reads bytes from the vault and shows them through an
   object URL. Revoked when the element leaves the document, so browsing a long
   grid does not leak blobs. */
/* A board image lives in the vault, not behind a URL. The old `'/' + asset`
   assumed a server was there to serve it; with the files on local disk that
   request just 404s and every image node renders blank. Resolve it the same
   way `renderVaultEmbed` does — read the bytes, mint an object URL, and hand
   it to the same revocation bookkeeping. */
/* An object URL minted from a typeless Blob works for PNG and JPEG because the
   browser sniffs the magic bytes — and fails silently for SVG, which has none
   worth sniffing and is refused as an <img> source without an explicit type.
   So the type comes from the extension. */
const MIME_FOR = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
};
function imageBlob(bytes, path) {
  const ext = String(path).split('.').pop().toLowerCase();
  const type = MIME_FOR[ext];
  return type ? new Blob([bytes], { type }) : new Blob([bytes]);
}

function vaultImage(assetPath, props = {}) {
  const img = h('img', { loading: 'lazy', alt: '', ...props });
  const vault = window.SB_VAULT;
  if (!vault || !assetPath) return img;
  vault.readBlob(assetPath)
    .then((bytes) => {
      const url = URL.createObjectURL(imageBlob(bytes, assetPath));
      img.src = url;
      img.dataset.objectUrl = url;
      registerObjectUrl(img, url);
    })
    .catch(() => { img.classList.add('vault-embed-missing'); });
  return img;
}

function renderVaultEmbed(target) {
  if (/\.canvas$/i.test(target)) {
    const href = obsidianUrl('canvas/' + target);
    return h('span', { className: 'vault-embed vault-embed-canvas' },
      '▦ ', href ? h('a', { href }, target) : target);
  }
  const img = h('img', { className: 'vault-embed vault-embed-img', alt: target });
  const vault = window.SB_VAULT;
  if (vault) {
    vault.readBlob('attachments/' + target)
      .then((bytes) => {
        const url = URL.createObjectURL(imageBlob(bytes, target));
        img.src = url;
        img.dataset.objectUrl = url;
        registerObjectUrl(img, url);
      })
      .catch(() => { img.replaceWith(h('span', { className: 'mention-link broken' }, target)); });
  }
  return img;
}

/* Object-URL bookkeeping: revoke as soon as the element is detached, so
   create count minus revoke count equals what is actually mounted. */
const _objectUrls = new Set();
function registerObjectUrl(el, url) {
  _objectUrls.add(url);
  if (typeof MutationObserver === 'undefined') return;
  const obs = new MutationObserver(() => {
    if (!document.contains(el)) {
      URL.revokeObjectURL(url);
      _objectUrls.delete(url);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

/* "1 projects". Ten places counted things and each decided for itself whether
   to bother with the plural; most did not. One helper, so the app stops
   sounding like a database report. `many` defaults to `one + "s"`. */
function nOf(n, one, many) {
  const k = Number(n) || 0;
  return k + ' ' + (k === 1 ? one : (many || one + 's'));
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d ago`;
    return d.toISOString().slice(0, 10);
  } catch (_) { return ''; }
}


// Personal mode — the original capture/wiki surface.
const NAV = [
  { group: 'navigate', label: 'navigate', items: [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'pages', label: 'All pages', icon: 'files' },
  ] },
  { group: 'kinds', label: 'by kind', items: KIND_ORDER.map((k) => ({
    id: 'kind:' + k, kind: k, label: KIND_META[k].label, icon: KIND_META[k].icon,
  })) },
  { group: 'projects', label: 'projects', items: [
    { id: 'projects', label: 'Projects', icon: 'folder' },
  ] },
  { group: 'tagging', label: 'tagging', items: [
    { id: 'tags', label: 'Tags', icon: 'tag' },
  ] },
  { group: 'system', label: 'system', items: [
    { id: 'about-me', label: 'About me', icon: 'circle-user' },
    /* The clipper is a thing you install, not a preference, so it gets a row
       of its own — buried in Settings it was unfindable. It has no route of
       its own: `focus` sends you to Settings and flashes the panel there,
       rather than splitting one explanation across two screens. */
    { id: 'settings', focus: 'clipper', label: 'Clipper', icon: 'download' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ] },
];



// ── TabBarSearch — always-visible search input in the top bar.
// Live page-search dropdown as you type; Enter without selecting drops
// into the Ask flow so it handles both "find a page" and "ask the AI"
// in a single input. ⌘K focuses this input from anywhere.
function TabBarSearch() {
  const wrap = h('div', { className: 'tab-search', title: 'Search pages · ⌘K' });
  // Named searchGlyph, not `icon` — a local by that name would shadow the
  // global icon() helper for this whole function.
  const searchGlyph = h('span', { className: 'tab-search-glyph' }, icon('search'));
  const input = h('input', {
    className: 'tab-search-input',
    placeholder: 'search',
    autocomplete: 'off',
  });
  const results = h('div', { className: 'tab-search-results', style: { display: 'none' } });
  let activeIdx = -1;
  let lastItems = [];
  let timer = null;

  const close = () => { results.style.display = 'none'; activeIdx = -1; };

  const renderItems = (items) => {
    clear(results);
    lastItems = items;
    if (!items.length) {
      const askHint = (input.value || '').trim();
      results.appendChild(h('div', { className: 'tab-search-empty' },
        askHint
          ? h('div', null, 'No page matches "', h('b', null, askHint), '".')
          : 'Type to search pages by title, body or tag.'));
      return;
    }
    items.forEach((p, i) => {
      results.appendChild(h('a', {
        className: 'tab-search-result' + (i === activeIdx ? ' active' : ''),
        href: '#page/' + p.id,
        onMouseDown: (e) => {
          // mousedown (not click) so blur doesn't fire first and hide the row.
          e.preventDefault();
          close();
          input.value = '';
          openPageTab(p.id);
        },
        onMouseEnter: () => { activeIdx = i; },
      },
        // Was the raw `p.kind` — lowercase "note" beside a Note icon, and
        // "canvas" for a drawing. One resolver, sentence case like everywhere.
        h('span', { className: 'tab-search-kind' },
          icon(metaForPage(p).icon || 'file-text'), ' ', metaForPage(p).label),
        // Marked in the title too: plenty of results match there and nowhere
        // else, and those showed no highlight at all.
        h('span', { className: 'tab-search-title' },
          markedText(p.title || p.slug || '(untitled)', input.value)),
        /* A window around the match, with the match marked — the snippet used
           to be the head of the page, so a result could show you nothing of
           why it was a result. Where the hit is a tag or an alias and not the
           text, the snippet says so, because otherwise the row looks like a
           mistake: `pages()` matches title, tags, aliases and excerpt, and
           two of those four were invisible. */
        (() => {
          const q = (input.value || '').trim().toLowerCase();
          const [b, m, a] = snippetAround(p.body, input.value, 80);
          if (!m && q && !String(p.title || '').toLowerCase().includes(q)) {
            const tag = (p.tags || []).find((t) => String(t).toLowerCase().includes(q));
            const alias = (p.aliases || []).find((x) => String(x).toLowerCase().includes(q));
            if (tag) {
              return h('span', { className: 'tab-search-snippet' },
                'tagged ', h('span', { className: 'tag-chip ' + tagHue(tag) }, markedText(tag, input.value)));
            }
            if (alias) {
              return h('span', { className: 'tab-search-snippet' },
                'also called ', markedText(alias, input.value));
            }
            // A drawing matched on a word inside the picture. The excerpt is
            // the back-of-note prose and does not contain it, so without this
            // the row shows the wrong text or none at all.
            const scene = String(p.sceneText || '');
            if (scene.toLowerCase().includes(q)) {
              const [sb, sm, sa] = snippetAround(scene, input.value, 70);
              return h('span', { className: 'tab-search-snippet' },
                icon(DRAWING_META.icon), ' in the drawing: ',
                sb, sm ? h('mark', null, sm) : null, sa);
            }
          }
          return h('span', { className: 'tab-search-snippet' },
            b, m ? h('mark', null, m) : null, a);
        })()));
    });
  };

  const doSearch = async (q) => {
    try {
      const data = await SB.data().pages({ q, limit: 8 });
      const items = data.items || data || [];
      results.style.display = 'block';
      renderItems(items);
    } catch (_) { close(); }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { close(); return; }
    timer = setTimeout(() => doSearch(q), 140);
  });
  input.addEventListener('focus', () => {
    if (lastItems.length || input.value.trim()) results.style.display = 'block';
  });
  input.addEventListener('blur', () => {
    // Small delay so click handlers on results fire before we hide.
    setTimeout(() => close(), 140);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(lastItems.length - 1, activeIdx + 1);
      renderItems(lastItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(-1, activeIdx - 1);
      renderItems(lastItems);
    } else if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      if (activeIdx >= 0 && lastItems[activeIdx]) {
        close();
        input.value = '';
        openPageTab(lastItems[activeIdx].id);
      } else {
        close();
        input.value = '';
        submitSearch(q);   // → the full list, filtered
      }
    } else if (e.key === 'Escape') {
      input.value = '';
      close();
      input.blur();
    }
  });

  wrap.appendChild(searchGlyph);
  wrap.appendChild(input);
  wrap.appendChild(results);
  return wrap;
}

// ── TabBar (top of the app — Notion-style multi-tab work surface) ───────
function TabBar(tabs, activeTabId, onSwitch, onClose, onNew) {
  return h('div', { className: 'tabbar' },
    // Monogram only. In app chrome the name is dead weight — you know which
    // app you are in by the time you have opened a vault, and the tab strip
    // needs the width more than the identity does. The full lockup stays on
    // the first-run screen, which is the one place the name is doing work.
    /* The brand cell spans the sidebar's width so the rule between chrome
       and content runs unbroken — but that left an 18px mark alone in 244px
       of nothing. The collapse control lives here now: it belongs to the
       sidebar, it sits at the sidebar's edge, and the space was already
       paid for. */
    h('div', { className: 'tab-brand' },
      h('a', {
        className: 'tab-brand-link', href: '#home', title: 'Canon Vault v0.6',
        'aria-label': 'Canon Vault — home',
        onClick: (e) => { e.preventDefault(); setRoute('home'); },
      }, brandMark()),
      h('button', {
        className: 'nav-collapse',
        title: app.navCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
        'aria-label': app.navCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
        onClick: () => { setNavCollapsed(!app.navCollapsed); render(); },
      }, icon(app.navCollapsed ? 'panel-left-open' : 'panel-left-close'))),
    TabBarSearch(),
    h('div', { className: 'tabs', role: 'tablist' },
      ...tabs.map((t) => h('div', {
        className: 'tab' + (t.id === activeTabId ? ' tab-active' : ''),
        role: 'tab',
        'aria-current': t.id === activeTabId ? 'true' : 'false',
        onClick: () => onSwitch(t.id),
        // Middle-click closes (browser convention).
        onAuxClick: (e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } },
      },
        h('span', { className: 'tab-label' }, tabLabel(t)),
        tabs.length > 1 ? h('button', {
          className: 'tab-close', title: 'close (middle-click works too)',
          onClick: (e) => { e.stopPropagation(); onClose(t.id); },
        }, '×') : null,
      )),
      h('button', { className: 'tab-add', title: 'New tab (⌘T)', onClick: onNew }, '+')));
}

// ── BreadcrumbRow ───────────────────────────────────────────────────────
// Sits below the tab bar, above page content. Pure breadcrumbs — search +
// status indicators live elsewhere now.
function BreadcrumbRow(crumbs) {
  return h('div', { className: 'crumb-row' },
    crumbs.map((c, i) => {
      const label = typeof c === 'string' ? c : c.label;
      const target = typeof c === 'string' ? null : c.route;
      const isLast = i === crumbs.length - 1;
      return [
        i > 0 ? h('span', { className: 'sep' }, '/') : null,
        isLast
          ? h('b', null, label)
          : target
            ? h('a', { className: 'crumb-link', href: '#' + target,
                onClick: (e) => { e.preventDefault(); setRoute(target); } }, label)
            : h('span', null, label),
      ];
    }));
}

// ── SearchPanel — quick-search modal triggered by the sidebar search icon (or ⌘K) ─
function SearchPanel(onClose) {
  const wrap = h('div', { className: 'search-overlay', onClick: (e) => { if (e.target === wrap) onClose(); } });
  const panel = h('div', { className: 'search-panel' });
  const resultsBox = h('div', { className: 'search-results' });
  let searchTimer = null;
  let lastResults = [];

  const renderResults = (items) => {
    clear(resultsBox);
    if (!items.length) {
      resultsBox.appendChild(h('div', { className: 'search-empty' },
        'No page matches.'));
      return;
    }
    items.forEach((p) => {
      resultsBox.appendChild(h('a', {
        className: 'search-result',
        href: '#page/' + p.id,
        onClick: (e) => { e.preventDefault(); onClose(); openPageTab(p.id); },
      },
        h('span', { className: 'search-result-kind' }, p.kind),
        h('span', { className: 'search-result-title' }, p.title || '(untitled)'),
        h('span', { className: 'search-result-snippet' }, firstLineOf(p.body, 80))));
    });
  };

  const doSearch = async (q) => {
    try {
      const { items } = await SB.data().pages({ q, limit: 10 });
      lastResults = items || [];
      renderResults(lastResults);
    } catch (_) {
      clear(resultsBox);
    }
  };

  const input = h('input', {
    className: 'search-input', autofocus: 'true',
    placeholder: 'Search pages…',
    onInput: (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value.trim();
      if (!q) { clear(resultsBox); return; }
      searchTimer = setTimeout(() => doSearch(q), 150);
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        const q = e.target.value.trim();
        onClose();
        submitSearch(q);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
  });

  panel.appendChild(input);
  panel.appendChild(resultsBox);
  wrap.appendChild(panel);
  // Focus the input on the next tick so autofocus actually works post-mount.
  setTimeout(() => input.focus(), 0);
  return wrap;
}


function Sidebar(route, setRoute, kindCounts, onCreate, offline, lastSynced) {
  const order = KIND_ORDER;
  /* KIND_ORDER is the NAV, not the set of kinds — `bookmark` is a derived
     facet (a note carrying a url), so summing the facet counts counted every
     bookmark twice. The sidebar said "15 pages" while the dashboard said
     "14 pages total", two numbers for the same vault and the louder one
     wrong. The real total comes from the store. */
  const total = (app.stats && app.stats.pages_total != null)
    ? app.stats.pages_total
    : order.reduce((n, k) => n + ((kindCounts || {})[k] || 0), 0);
  const groupLabel = (g) => g.group === 'kinds'
    ? `by kind — ${total} pages`
    : g.label;
  // Drag handle on the sidebar's right edge, and a collapse toggle. Same
  // shape as the activity log's resizer so both rails behave identically.
  const resize = h('div', { className: 'nav-resize', title: 'Drag to resize' });
  resize.addEventListener('pointerdown', (e) => startNavResize(e, resize));
  resize.addEventListener('dblclick', () => { app.navW = 244; applyNavW();
    try { localStorage.setItem('sb.navW', '244'); } catch (_) {} });

  return h('div', { className: 'nav' },
    resize,
    // ── top: Create button (search lives in the top tab bar now) ────────
    // Work mode is project-first: this makes a new project (the container),
    // not a lone design page.
    h('div', { className: 'nav-create' },
      h('button', {
        className: 'btn-create',
        onClick: onCreate,
        title: 'Create new page  (⌘N)',
        'data-tour': 'create',
      },
        h('span', { className: 'btn-create-plus' }, icon('plus')),
        h('span', { className: 'nav-lbl' }, 'Create new')),
      ),

    // ── nav groups (scrollable) ─────────────────────────────────────────
    h('div', { className: 'nav-scroll' },
      NAV.map((g) => h('div', null,
        h('div', { className: 'nav-section' }, groupLabel(g)),
        g.items.map((it) => {
          const c = it.kind ? (kindCounts || {})[it.kind] : null;
          const meta = it.kind ? KIND_META[it.kind] : null;
          return h('div', {
            className: `nav-item ${g.group === 'kinds' ? 'nav-cat' : ''}`,
            /* `!it.focus` — Clipper and Settings share a route, and without
               this both rows light up whenever either is open. */
            'aria-current': route === it.id && !it.focus ? 'true' : 'false',
            // A stable handle for the tour to point at. Keyed on the route id
            // rather than the label, so translating or renaming a row cannot
            // silently unanchor a step.
            'data-tour': 'nav:' + (it.focus || it.id),
            onClick: (e) => {
              if (it.href) { window.open(it.href, '_blank', 'noopener,noreferrer'); return; }
              // Set before the route change: the screen reads it while rendering.
              if (it.focus) app._settingsFocus = it.focus;
              if (e.metaKey || e.ctrlKey) { newTab(it.id, null, { switchTo: true }); return; }
              setRoute(it.id);
            },
            /* Was 'click · ⌘-click to open in new tab' on all eleven rows: a
               tooltip that pops over the primary navigation on every hover,
               says the same generic thing each time, and teaches nothing
               after the first. A row's tooltip is its own name, and only
               when the label is not already sitting next to the icon.
               The aria-label is unconditional — collapsed, the label is
               `display: none` and the icon would name nothing. */
            title: app.navCollapsed ? it.label : null,
            'aria-label': it.label,
            style: meta ? { '--k-c': meta.color } : null,
          },
            h('span', { className: 'nav-icon' + (meta ? ' kind-glyph' : '') },
              icon(it.icon || (meta && meta.icon) || 'file-text')),
            h('span', { className: 'nav-lbl' }, it.label),
            it.href ? h('span', { className: 'ct' }, '↗') : h('span', { className: 'ct' }, c != null ? String(c) : ''));
        })))),

    /* ── bottom: is the vault there, and is my work on disk ──────────────
       Nothing else. The colour-mode swatches used to sit here, on the theory
       that appearance is a whim and a whim buried two clicks deep never gets
       used. It is a preference, and preferences live in Settings — where the
       swatches went, unchanged, because a swatch is still a better answer to
       "what will this look like" than the word "midnight" is.

       No gear either: "Settings" already sits in the SYSTEM group four rows
       up, and the popover it opened had been reduced to one control plus a
       link to the very screen that nav row goes to. */
    h('div', { className: 'nav-foot' },
      h('div', { className: 'nav-status-row' },
        h('span', { className: 'dot', style: offline ? { background: 'var(--signal-alert)' } : null }),
        h('span', { className: 'nav-status-label' }, offline ? 'vault unavailable' : 'vault ready')),
      h('div', { className: 'nav-status-row' },
        h('span', { className: 'nav-status-label nav-status-sync' },
          offline ? 'not saved' : ('saved ' + (lastSynced || 'just now'))))));
}

/* A row of real colour chips. Each paints its own page + ink, so the control
   previews the mode instead of naming it. System gets a split chip — half
   light, half dark — which reads as "whichever your OS is" without a label. */
function ThemePicker() {
  const current = app.t.theme || 'system';
  return h('div', {
    className: 'theme-picker', role: 'radiogroup', 'aria-label': 'Colour mode',
  },
    ...THEMES.map((t) => {
      const on = current === t.id;
      const chip = h('button', {
        className: 'theme-chip' + (on ? ' on' : '') + (t.id === 'system' ? ' theme-chip-system' : ''),
        role: 'radio', 'aria-checked': String(on),
        title: t.label + (t.id === 'system' ? ' — follows your OS' : ''),
        'aria-label': t.label,
        onClick: () => setTweak('theme', t.id),
      });
      if (t.swatch) {
        chip.style.setProperty('--chip-bg', t.swatch[0]);
        chip.style.setProperty('--chip-ink', t.swatch[1]);
      }
      return chip;
    }));
}

/* Where the clipper lives. The only URL this app owns — everything else it
   links to is either a page in the vault or a link the user saved. It has to
   be one: the extension ships with the repo and not with the deploy, so a
   hosted instance can point at it but cannot hand it over. */
const CLIPPER_HELP = 'https://github.com/rabindranath1311/canon-vault/tree/main/extension';
/* Why not one click? Chrome killed inline installation in 2018. The only
   one-click path left is a Web Store listing, and a self-hosted `.crx` is
   enterprise-policy-only. So the honest offer is: hand over the files, and
   be very clear about the three steps that follow.

   The zip is built HERE, in the page, from a mirror of `extension/` (see
   scripts/sync-clipper.mjs). GitHub can only zip a whole repository, which
   is the app and the docs and the demo vault as well — everything except
   what was asked for. A release asset would be a second artefact to keep in
   step with the code. Building it locally means the download is exactly the
   `extension/` of the deploy you are standing in, and it still works with
   the network off. */
const CLIPPER_EXT_PAGE = 'chrome://extensions';
/* The one folder name the user has to recognise twice — in their downloads
   and in Chrome's folder picker — so it is defined once. */
const CLIPPER_DIR = 'canon-vault-clipper';

/* The other half of onboarding.
 *
 * The front door explains the decision; this is what happens after it. A
 * vault opens on a dashboard, and on the first run that dashboard is either
 * empty (a folder we just scaffolded) or full of files the app has never
 * shown anyone (a folder we just adopted) — and in both cases the app had
 * nothing to say about what to do next, or about the two other programs that
 * are now looking at the same folder.
 *
 * Shown once, dismissible, and never in the demo: the demo's own banner
 * already says what it is, and "make your first page" is a poor invitation
 * when the page will not survive a reload.
 */
function WelcomeCard(onCreate) {
  const prefs = loadPrefs();
  if (prefs.welcomeSeen || window.SB_DEMO) return null;

  const dismiss = () => {
    const p = loadPrefs(); p.welcomeSeen = true; savePrefs(p);
    card.style.height = card.offsetHeight + 'px';
    requestAnimationFrame(() => { card.classList.add('welcome-out'); });
    setTimeout(() => card.remove(), 320);
  };

  const step = (n, title, body, action) => h('li', { className: 'welcome-step' },
    h('span', { className: 'welcome-n' }, String(n)),
    h('div', { className: 'welcome-step-b' },
      h('h3', { className: 'welcome-step-t' }, title),
      h('p', { className: 'welcome-step-d' }, body),
      action || null));

  const steps = [step(1, 'Make something',
    'Every kind is one picker away — a note, a bookmark, a topic, a drawing, a wall.',
    h('div', { className: 'welcome-step-slot' },
      h('button', { className: 'welcome-go', onClick: onCreate }, 'Create a page', icon('arrow-right')),
      // The tour does not auto-run while this card is up (see maybeStartTour),
      // so this is the only way to reach it on a first real vault.
      h('button', {
        className: 'welcome-go', onClick: () => startTour(0),
      }, 'Take the tour', icon('arrow-right'))))];

  // Only offered when we know the vault's name — otherwise the link is a guess.
  const vault = window.SB_VAULT_NAME || '';
  if (vault) {
    steps.push(step(2, 'Open the same folder in Obsidian',
      'Not an export. The very same files, live in both apps at once.',
      h('a', {
        className: 'welcome-go',
        href: 'obsidian://open?vault=' + encodeURIComponent(vault),
      }, 'Open in Obsidian', h('span', { className: 'welcome-ext' }, '↗'))));
  }

  // AGENTS.md exists in a vault this app scaffolded; an adopted one may not
  // have it, and offering a link to a page that is not there is worse than
  // saying the plain thing.
  const agents = h('div', { className: 'welcome-step-slot' });
  steps.push(step(vault ? 3 : 2, 'Hand the folder to your agent',
    'The file convention is public, so a coding agent can read and write this vault the way you do.',
    agents));

  // The fourth client. It is a real link out rather than a button because the
  // clipper is not part of this deploy — `vercel.json` serves app/ and nothing
  // else — so somebody on a hosted instance has no copy of it to install, and
  // a button that could only say "clone the repo" would be a worse link.
  steps.push(step(vault ? 4 : 3, 'Clip the web into it',
    'A Chrome extension: right-click an image, drag a region out of a page, keep a link or '
    + 'a quotation. Images land on an inspo wall, pages become bookmarks — written straight '
    + 'into this folder, through the same safety net as anything here.',
    h('a', {
      className: 'welcome-go', href: CLIPPER_HELP, target: '_blank', rel: 'noopener',
    }, 'Get the clipper', h('span', { className: 'welcome-ext' }, '↗'))));
  // A missing page RESOLVES null here rather than rejecting, so the fallback
  // has to be in both branches — putting it only in .catch() left the step
  // with no action line at all on any vault the app did not scaffold.
  const noAgentsPage = () => agents.appendChild(h('span', { className: 'welcome-plain' },
    'Point it at the folder. The rules go in CONVENTION.md beside your notes.'));
  getPageCached('agents')
    .then((p) => {
      if (!p) { noAgentsPage(); return; }
      agents.appendChild(h('button', {
        className: 'welcome-go', onClick: () => openPage(p.id),
      }, 'Read the agent contract', icon('arrow-right')));
    })
    .catch(noAgentsPage);

  const card = h('section', { className: 'welcome' },
    h('div', { className: 'welcome-hd' },
      h('div', null,
        h('h2', { className: 'welcome-t' }, 'Your vault is open.'),
        h('p', { className: 'welcome-s' },
          vault
            ? ['Everything lives in ', h('code', null, vault), '. Four things worth knowing.']
            : 'Three things worth knowing.')),
      h('button', {
        className: 'welcome-x', title: 'Dismiss', 'aria-label': 'Dismiss',
        onClick: dismiss,
      }, '✕')),
    h('ol', { className: 'welcome-steps' }, steps));
  return card;
}

/* ── The tour ──────────────────────────────────────────────────────────────
 *
 * A vault is four ideas — files on disk, kinds, links, tags — and the app used
 * to state none of them. The dashboard's welcome card listed three things to
 * DO; it could not say what a wikilink was, because it had nowhere to point.
 * This does: each step anchors to the real control it describes, so the
 * sentence and the thing it names are on screen together.
 *
 * Runs once (a localStorage pref, never the vault) and is replayable from
 * Settings. It runs in the demo too — the demo is the front door, and someone
 * who clicked "Try a demo vault" is exactly the person with the questions.
 *
 * A step whose anchor is missing is not skipped: it centres instead. Kind rows
 * come and go with the vault's contents, and a tour that silently drops the
 * paragraph about drawings on an empty vault teaches least to the person who
 * needs it most.
 */
const TOUR_STEPS = [
  /* The linking model leads — it is the idea underneath, and on the
     marketing site's embedded demo this first card IS the pitch. */
  {
    id: 'links', icon: 'files', anchor: '[data-tour="nav:pages"]',
    k: 'Wikilinks \u2192 structure', tint: 'links',
    title: 'Links are the edges',
    body: 'Type [[ and a page name anywhere. Links resolve by filename, and every page lists what points back at it.',
    demo: 'links',
  },
  {
    id: 'tags', icon: 'tag', anchor: '[data-tour="nav:tags"]',
    k: 'Tags \u2192 facets', tint: 'tags',
    title: 'Tags are the colour',
    body: 'A #tag marks state and filters the vault. A subject is a page you link, never a tag.',
    demo: 'tags',
  },
  {
    id: 'files', icon: 'folder', anchor: null,
    title: 'Your notes are files',
    body: 'Plain markdown in the folder you picked. Close the app and everything is still there.',
  },
  {
    id: 'create', icon: 'plus', anchor: '[data-tour="create"]',
    title: 'Four kinds, one picker',
    body: 'Note, topic, board, wall. A bookmark is a note carrying a url; the kind decides the look.',
  },
  {
    id: 'drawing', icon: 'shapes', anchor: '[data-tour="nav:kind:drawing"]',
    title: 'One place for anything spatial',
    body: 'Shapes, arrows and handwriting, saved as .excalidraw.md. Words on a board land in the markdown too.',
  },
  {
    id: 'obsidian', icon: 'arrow-right', anchor: null,
    title: 'Obsidian and your agent, same folder',
    body: 'Point Obsidian at the same folder; both stay live at once. CONVENTION.md tells your agent the rules.',
  },
  {
    id: 'clipper', icon: 'bookmark', anchor: '[data-tour="nav:settings"]',
    title: 'Capture from the browser',
    body: 'Right-click a page, an image or a selection in Chrome and it lands here, through the same save safety as typing.',
  }
];

/* The two-card visual the marketing site used to carry — shown here instead,
   where the behaviour lives. Invented placeholder names, deliberately: these
   render in anyone's vault, so they must belong to nobody's. */
function tourDemo(kind) {
  if (kind === 'links') {
    return h('div', { className: 'tour-demo' },
      h('span', { className: 'tour-chip mt' }, '[[typography]]'),
      h('span', { className: 'tour-chip arrow' }, '↳'),
      h('span', { className: 'tour-chip node' },
        h('i', { style: { background: 'var(--k-canvas)' } }), 'Type Scale Study'),
      h('span', { className: 'tour-chip node' },
        h('i', { style: { background: 'var(--k-topic)' } }), 'Serif Shortlist'));
  }
  if (kind === 'tags') {
    return h('div', { className: 'tour-demo' },
      ['draft', 'current', 'to-build'].map((t) => h('span', { className: 'tour-chip hh' }, '#' + t)));
  }
  return null;
}

/** Is the tour on screen right now? Keeps ⌘N and friends from fighting it. */
let _tourEl = null;

function startTour(startAt = 0) {
  if (_tourEl) return;                       // already running
  let i = Math.max(0, Math.min(startAt, TOUR_STEPS.length - 1));

  const scrim = h('div', { className: 'tour-scrim' });
  const ring = h('div', { className: 'tour-ring', 'aria-hidden': 'true' });
  const card = h('div', {
    className: 'tour-card', role: 'dialog', 'aria-modal': 'false',
    'aria-label': 'How this works',
  });
  const root = h('div', { className: 'tour' }, scrim, ring, card);
  _tourEl = root;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('tour-in'));

  /* Marked seen the moment it OPENS, not when it is completed.
     Recording it on finish only counted the people who pressed Done or
     Escape — reload in the middle, or close the tab, and the flag was never
     written, so the tour came back on every single load until you played it
     through. Shown once means once, however you leave it; Settings → Take the
     tour is the way back. */
  try { const p = loadPrefs(); p.tourSeen = true; savePrefs(p); } catch (_) {}

  function finish() {
    if (!_tourEl) return;
    root.classList.remove('tour-in');
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    const el = root;
    _tourEl = null;
    setTimeout(() => el.remove(), 260);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  }

  /* Anchor the ring and the card to the live element. Read on every step and
     on resize rather than cached: the nav is resizable and collapsible, and a
     ring left behind at a stale rect points confidently at nothing. */
  function place() {
    const step = TOUR_STEPS[i];
    const el = step.anchor ? document.querySelector(step.anchor) : null;
    const r = el ? el.getBoundingClientRect() : null;
    if (!r || !r.width) {
      ring.style.display = 'none';
      card.classList.add('tour-card-mid');
      card.style.left = ''; card.style.top = '';
      return;
    }
    ring.style.display = '';
    const pad = 6;
    ring.style.left = (r.left - pad) + 'px';
    ring.style.top = (r.top - pad) + 'px';
    ring.style.width = (r.width + pad * 2) + 'px';
    ring.style.height = (r.height + pad * 2) + 'px';

    card.classList.remove('tour-card-mid');
    const cw = card.offsetWidth || 360;
    const ch = card.offsetHeight || 200;
    const gap = 16;
    // Prefer the right of the anchor (the nav lives on the left); flip to the
    // left when there is no room, and clamp so the card is never off-screen.
    let left = r.right + gap;
    if (left + cw > window.innerWidth - 12) left = Math.max(12, r.left - gap - cw);
    let top = r.top + r.height / 2 - ch / 2;
    top = Math.max(12, Math.min(top, window.innerHeight - ch - 12));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function go(n) {
    if (n < 0) return;
    if (n >= TOUR_STEPS.length) { finish(); return; }
    i = n;
    paint();
  }

  function paint() {
    const step = TOUR_STEPS[i];
    const last = i === TOUR_STEPS.length - 1;
    // The tint is per-step state on a reused element, so clear before set.
    card.classList.remove('tour-tint-links', 'tour-tint-tags');
    if (step.tint) card.classList.add('tour-tint-' + step.tint);
    // replaceChildren stringifies a null argument into the literal text
    // "null" (unlike h(), which skips them) — so the optional pieces are
    // filtered, not passed.
    card.replaceChildren(...[
      h('button', {
        className: 'tour-x', title: 'Close', 'aria-label': 'Close the tour',
        onClick: finish,
      }, '✕'),
      step.k ? h('span', { className: 'tour-k' }, step.k) : null,
      h('div', { className: 'tour-hd' },
        step.k ? null : h('span', { className: 'tour-mark' }, icon(step.icon)),
        h('h2', { className: 'tour-t' }, step.title)),
      h('p', { className: 'tour-b' }, step.body),
      tourDemo(step.demo),
      h('div', { className: 'tour-ft' },
        h('div', { className: 'tour-dots' }, TOUR_STEPS.map((s, n) => h('button', {
          className: 'tour-dot' + (n === i ? ' on' : ''),
          title: s.title, 'aria-label': `Step ${n + 1}: ${s.title}`,
          'aria-current': n === i ? 'true' : 'false',
          onClick: () => go(n),
        }))),
        h('div', { className: 'tour-btns' },
          i > 0 ? h('button', { className: 'tour-back', onClick: () => go(i - 1) }, 'Back') : null,
          h('button', { className: 'tour-next', onClick: () => go(i + 1) },
            last ? 'Done' : 'Next', last ? null : icon('arrow-right')))),
      h('div', { className: 'tour-count' }, `${i + 1} of ${TOUR_STEPS.length}`),
    ].filter(Boolean));
    // Re-run the entrance on each step so the move reads as a step, not a jump.
    card.classList.remove('tour-step-in');
    void card.offsetWidth;                    // restart the animation
    card.classList.add('tour-step-in');
    place();
  }

  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  paint();
  // The nav may still be painting on a cold boot; re-place once it has.
  setTimeout(place, 60);
  /* The card opens under the cursor — it is launched by a click, and it lands
     where the pointer already is. Until the entrance is over it takes no
     clicks at all, so a double-click, a repeated tap or an event the browser
     had queued cannot land on whichever dot happens to be under the mouse and
     skip the reader three steps into a tour they have not started reading. */
  setTimeout(() => card.classList.add('tour-armed'), 220);
}

/** First run only. Called after boot has painted something to point at. */
function maybeStartTour() {
  let prefs;
  try { prefs = loadPrefs(); } catch (_) { return; }
  if (prefs.tourSeen) return;
  /* Two first-run greetings at once is one too many. On a real vault the
     dashboard's welcome card is already up with the three things to DO, and it
     carries a "Take the tour" button — so the tour waits to be asked rather
     than covering the card that just offered it. In the demo there is no
     welcome card (it would invite you to make a page that dies on reload),
     which is exactly where an unprompted tour belongs. */
  if (!prefs.welcomeSeen && !window.SB_DEMO) return;
  // Wait for the nav to exist, or every anchor resolves to null and the whole
  // tour centres itself in the middle of the screen saying nothing about where.
  // POLL rather than check once: a deep link into a board pays the Excalidraw
  // import before the nav paints, and a single 400ms check raced it — the
  // site's embedded demo opens exactly that way, and its tour never fired.
  let tries = 0;
  const t = setInterval(() => {
    if (document.querySelector('[data-tour="create"]')) { clearInterval(t); startTour(0); }
    else if (++tries > 16) clearInterval(t);
  }, 300);
}

function PageHeader(title, meta, sub, right) {
  return [
    h('div', { className: 'page-h' },
      h('h1', null, title),
      h('span', { className: 'meta' }, meta)),
    h('div', { className: 'page-sub' },
      h('span', null, sub),
      h('span', null, right)),
  ];
}


/* ── v2 screens ───────────────────────────────────────────────────────── */

/* One creation picker for the whole app.

   There were three grammars. This modal offered five kinds. The project
   screen's picker offered six — the same five plus Drawing. And a new
   project came from a browser `prompt()` dialog, which is a different visual
   language entirely and cannot be styled, themed or cancelled consistently.

   A person creating something should meet the same control every time,
   whichever door they came through. So: every creatable thing is here,
   including Project and Drawing, and Project asks for its name inline
   instead of handing off to the browser. */
/* Board is deliberately absent, and it is the only nav facet that is.
   `createPage('canvas')` writes `canvas/Board <date>.md` — a markdown file with
   no `.canvas` sibling, so it opens as an empty board you cannot draw on,
   because boards are read-only by design (one owner per scene). The affordance
   promised something the app cannot do. Boards you made in Obsidian still list,
   open and render; this app just does not pretend to start one. Drawing is the
   spatial thing it can actually finish. */
const CREATABLE_KINDS = [...KIND_ORDER.filter((k) => k !== 'canvas'), 'project'];
function creatableMeta(k) {
  if (k === 'drawing') return DRAWING_META;
  if (k === 'project') return {
    label: 'Project', icon: 'folder', color: 'var(--k-proj)',
    hint: 'A folder that holds pages. Not a kind — a container for the others.',
  };
  return KIND_META[k] || {};
}

function CreateModal(open, onPick, onClose) {
  if (!open) return null;
  const body = h('div', { className: 'modal-body' });
  // `open === 'project'` means someone pressed "New project" and should land
  // on the name field, not on the grid they already made a choice in.
  const startAt = open === 'project' ? 'project' : 'grid';

  function paintGrid() {
    clear(body);
    body.appendChild(h('div', { className: 'kind-grid' },
      CREATABLE_KINDS.map((k) => {
        const m = creatableMeta(k);
        return h('button', {
          className: 'kind-card', style: { '--k-c': m.color },
          onClick: () => (k === 'project' ? paintProjectName() : onPick(k)),
        },
          h('div', { className: 'kind-card-g' }, k === 'drawing' || k === 'project'
            ? icon(m.icon) : kindIcon(k)),
          h('div', { className: 'kind-card-l' }, m.label),
          h('div', { className: 'kind-card-h' }, m.hint));
      })));
  }

  /* A project is a folder, so it needs a name before it can exist — the one
     creatable thing that cannot be made empty and titled later. It asks here
     rather than through prompt(). */
  function paintProjectName() {
    clear(body);
    const input = h('input', {
      className: 'set-input create-name', placeholder: 'Project name',
      autocomplete: 'off',
      onKeyDown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); go(); }
        if (e.key === 'Escape') { e.preventDefault(); paintGrid(); }
      },
    });
    const err = h('div', { className: 'create-err' });
    const go = () => {
      const v = (input.value || '').trim();
      if (!v) { err.textContent = 'Give the project a name first.'; input.focus(); return; }
      onPick('project', v);
    };
    body.appendChild(h('div', { className: 'create-name-form' },
      h('button', { className: 'btn create-back', onClick: paintGrid },
        icon('arrow-right', 'flip'), 'Back'),
      h('label', { className: 'create-name-l', for: 'cv-new-project' },
        'Name this project'),
      h('div', { className: 'create-name-row' }, input,
        h('button', { className: 'btn-create', onClick: go }, 'Create')),
      h('p', { className: 'create-name-h' },
        'This becomes a folder in your vault, with a note inside it of the same name.'),
      err));
    setTimeout(() => input.focus(), 0);
  }

  if (startAt === 'project') paintProjectName(); else paintGrid();
  const bg = h('div', { className: 'modal-bg', onClick: (e) => { if (e.target.classList.contains('modal-bg')) onClose(); } },
    h('div', { className: 'modal' },
      h('div', { className: 'modal-hd' },
        h('b', null, 'Create new'),
        h('span', { className: 'modal-kbd' }, '\u2318N'),
        h('button', { className: 'sb-twk-x', title: 'Close', 'aria-label': 'Close',
          onClick: onClose }, '\u2715')),
      body));
  // This one is returned into the render tree rather than appended, so it is
  // not in the document yet. Escape is already handled by the global key
  // handler that owns \u2318N.
  requestAnimationFrame(() => {
    if (document.body.contains(bg)) {
      asDialog(bg, { restore: () => document.querySelector('.nav-create .btn-create') });
    }
  });
  return bg;
}

function V2Home(state, onOpen, onCreate, onKind) {
  const wrap = h('div', { className: 'screen' });

  // Show whatever we already have cached, then refresh with the dashboard endpoint.
  function paint(dash) {
    clear(wrap);
    const s = dash.stats || {};
    const obs = dash.obsessions || [];
    const recent = dash.recent || [];
    const buckets = dash.buckets || [];

    if ((s.pages_total || 0) === 0) {
      append(wrap, [
        h('div', { className: 'dash-hd' },
          h('h1', { className: 'dash-title' }, 'Dashboard',
            h('span', { className: 'dash-title-c' }, 
              h('span', { className: 'dim' }, 'nothing captured yet')))),
        FirstRunPanel(onCreate),
      ]);
      return;
    }

    /* "Via" records how a page arrived — hand-written, clipped, imported.
       In a vault you wrote yourself every row says "self", and a column
       whose every cell is identical is a column carrying no information.
       Render it only when the data actually varies. */
    const showVia = new Set(recent.map((r) => r.via)).size > 1;

    append(wrap, [
      h('div', { className: 'dash-hd' },
        h('h1', { className: 'dash-title' }, 'Dashboard',
          h('span', { className: 'dash-title-c' },  h('span', { className: 'dim' }, "what's in the air"))),
        h('div', { className: 'dash-sub' },
          h('span', null,
            h('b', null, String(s.fresh_this_week || 0)), ' new this week · ',
            h('b', null, String(s.mentions_total || 0)),
            (Number(s.mentions_total) === 1 ? ' mention · ' : ' mentions · '),
            h('b', null, String(s.pages_total || 0)),
            (Number(s.pages_total) === 1 ? ' page total' : ' pages total')),
          h('span', { className: 'dash-sub-r' },
            'updated ', fmtDate(s.last_synced || ''))),
        h('button', { className: 'btn-primary dash-cta', onClick: onCreate }, '+ new page')),

      // First run only, and it removes itself. Above everything, because on a
      // vault the app has just scaffolded there is nothing below it yet.
      WelcomeCard(onCreate),

      // ── Current obsessions ──
      h('div', { className: 'sect-hd' },
        h('span', null, 'Current obsessions'),
        h('span', { className: 'sect-hd-c' }, 'detected by tag clustering')),
      obs.length === 0
        ? EmptyState('No themes detected yet.',
            'Once a tag is on 2+ pages it starts surfacing here as a cluster.')
        : h('div', { className: 'obs-grid' },
            obs.map((o) => obsessionCard(o))),

      // ── Recent captures ──
      h('div', { className: 'sect-hd' },
        h('span', null, 'Recent pages'),
        h('span', { className: 'sect-hd-c' }, 'last 72h')),
      recent.length === 0
        ? EmptyState('No recent pages.', 'Create one above.')
        : h('div', { className: 'pages-table recent-table' },
            /* Two columns were dropped here.

               ID printed a ULID prefix. Nobody recalls a page by ULID, and
               it took the leftmost, most-scanned column in the table. It is
               still one click away in the Metadata rail.

               Via read "← self" on every row in a self-authored vault. A
               column whose every cell is identical carries no information;
               it is now rendered only when some row actually differs. */
            h('div', { className: 'pages-th recent-th' + (showVia ? '' : ' recent-th-novia') },
              h('span', null, 'Kind'),
              h('span', null, 'Title'),
              showVia ? h('span', { className: 'recent-via-h' }, 'Via') : null,
              h('span', { className: 'pages-tags-h' }, 'Tags'),
              h('span', null, 'When')),
            recent.map((r) => h('div', {
              className: 'pages-row recent-row' + (showVia ? '' : ' recent-row-novia'), onClick: () => onOpen(r.id),
            },
              h('span', null, KindChip(r)),
              h('span', { className: 'pages-title' }, r.title),
              showVia ? h('span', { className: 'recent-via' }, r.via) : null,
              h('span', { className: 'pages-tags' },
                (r.tags || []).slice(0, 2).map((t) => TagChip(t))),
              h('span', { className: 'pages-when' }, fmtDate(r.updated))))),

      // ── Activity buckets (replaces v1's "memory tiers") ──
      h('div', { className: 'sect-hd' },
        h('span', null, 'Activity buckets'),
        // Was "auto-cohorted by recency" — two pieces of jargon for a sentence
        // anyone can read.
        h('span', { className: 'sect-hd-c' }, 'by when you last touched them')),
      h('div', { className: 'tier-grid' },
        buckets.map((b) => bucketCard(b, s.pages_total || 0))),
    ]);
  }

  function obsessionCard(o) {
    const spark = o.sparkline || [];
    const peak = Math.max(1, ...spark);
    // A theme IS a tag, so the card says so and doubles as the way into that
    // tag's pages — it was previously a dead end unless you clicked one of the
    // three member links.
    const openTag = () => setRoute('tag:' + o.title);
    return h('div', { className: 'obs-card' },
      h('div', { className: 'obs-hd' },
        h('button', { className: 'obs-title', onClick: openTag,
          title: 'See every page tagged ' + o.title },
          h('span', { className: 'obs-hash' }, '#'), o.title),
        // "w=1" was internal vocabulary leaking into the UI — nobody outside
        // the clustering code knows what w is. Confidence is the same signal
        // in a form that answers a question a reader would actually ask.
        /* This printed "100%" on a three-page cluster, which invites more
           trust than a three-page cluster has earned. Below a handful of
           pages the honest answer is a word, not a number. */
        h('span', { className: 'obs-weight', title: 'How tightly these pages cluster' },
          o.captures >= 5 ? String(o.confidence) + '%'
            : (o.confidence >= 80 ? 'tight' : o.confidence >= 50 ? 'loose' : 'early'))),
      h('div', { className: 'obs-stats' },
        h('b', null, String(o.captures)), Number(o.captures) === 1 ? ' page' : ' pages',
        h('span', { className: 'obs-dot' }),
        h('b', null, String(o.days)), Number(o.days) === 1 ? ' day active' : ' days active'),
      // Zero days used to render as a flat dashed line, which reads as a
      // broken chart rather than as a quiet week. Every column now has a
      // visible floor, so an empty day looks like an empty day.
      h('div', { className: 'spark', 'aria-hidden': 'true' },
        spark.map((v) => h('div', { className: 'spark-col' },
          h('div', {
            className: 'spark-bar' + (v ? '' : ' spark-bar-zero'),
            style: { height: Math.max(6, Math.round((v / peak) * 100)) + '%' },
          })))),
      (o.related_tags || []).length
        ? h('div', { className: 'obs-tags' },
            (o.related_tags || []).slice(0, 6).map((t) => h('button', {
              className: 'tag-chip tag-chip-btn ' + tagHue(t), onClick: () => setRoute('tag:' + t),
            }, t)))
        : null,
      h('div', { className: 'obs-members' },
        h('div', { className: 'obs-members-l' }, 'top pages in this theme'),
        (o.members || []).map((m) => h('button', {
          className: 'obs-member', onClick: () => onOpen(m.id),
        },
          h('span', { className: 'obs-member-g', style: { color: metaForPage(m).color || 'var(--muted)' } },
            icon(metaForPage(m).icon || 'file-text')),
          h('span', { className: 'obs-member-t' }, m.title),
          h('span', { className: 'obs-member-go' }, icon('arrow-right'))))));
  }

  /* Each bucket against the vault, not against a ceiling.
     `b.cap` and `b.footer_l` are still computed — dashboard.js reproduces the
     Python original field for field, and a fixture test holds it to that — but
     they are not shown. The caps were 60 and 200, invented numbers that
     nothing enforces and nothing happens at, so "5% of soft cap" measured
     progress toward an event that does not exist. Share of the vault is a
     proportion the reader can actually use: how much of this is live thinking
     and how much is archive. Reference stopped being the odd one out, too — it
     had no cap, so it printed "(pages unbounded)" and drew a flat dashed bar
     where the others drew a real one. */
  function bucketCard(b, total) {
    const pct = total ? Math.round((b.count / total) * 100) : 0;
    return h('div', { className: 'tier-card' },
      h('div', { className: 'tier-hd' },
        h('span', null, b.label.toUpperCase()),
        // The single-letter badge said "F" beside a heading reading "FRESH".
        // A label and its own initial are not two pieces of information.
        ),
      h('div', { className: 'tier-n' },
        h('span', { className: 'tier-count' }, String(b.count)),
        h('span', { className: 'tier-cap' }, ' of ', nOf(total, 'page'))),
      h('div', { className: 'tier-cap-line' }, b.caption),
      h('div', { className: 'tier-bar' },
        h('div', { className: 'tier-bar-fill', style: { width: pct + '%' } })),
      h('div', { className: 'tier-foot' },
        h('span', null, total ? pct + '% of the vault' : ''),
        h('span', null, b.footer_r || '')));
  }

  /* Initial paint: the real header, and the shape of what is coming below it.
     It used to be the header with "loading…" where the stats go and nothing
     underneath, so the screen was three quarters empty and then everything
     arrived at once and shoved the header up the page. */
  append(wrap, [
    h('div', { className: 'dash-hd' },
      h('h1', { className: 'dash-title' }, 'Dashboard',
        h('span', { className: 'dash-title-c' }, h('span', { className: 'dim' }, "what's in the air"))),
      h('div', { className: 'dash-sub' }, h('span', { className: 'skel-bar skel-inline' })),
      h('button', { className: 'btn-primary dash-cta', onClick: onCreate }, '+ new page')),
    h('div', { className: 'sect-hd' }, h('span', null, 'Recent pages')),
    Skeleton('rows', 6),
  ]);

  Promise.resolve(SB.data().dashboard()).then(paint).catch((e) => {
    clear(wrap);
    append(wrap, [
      PageHeader('dashboard', null, 'failed to load dashboard data', null),
      EmptyState('Could not load.', String(e.message || e)),
    ]);
  });

  return wrap;
}





/* ── Work mode: design tokens visualization ────────────────────────
   Token pages carry meta.group (color|type|space|radius), meta.value,
   meta.ref (code variable). The gallery groups them and renders each
   group as what it actually is — swatches, a type scale, spacing bars,
   radius boxes — rather than a list of strings. */

/* Flowchart node shapes. Returns an SVG skin (fill var(--node-fill), stroke
   var(--ft)) drawn behind the node's HTML text. Most shapes fill the card box
   (preserveAspectRatio none); square/circle keep a 1:1 aspect (CSS centers them). */
const FLOW_SHAPES = ['rectangle', 'pill', 'parallelogram', 'diamond', 'triangle', 'hexagon', 'oval', 'square', 'circle'];
const _FLOW_SHAPE_FIT = new Set(['square', 'circle']);



/* ── per-kind listing views ────────────────────────────────────────
   - canvas → board: large cards w/ item-count preview
   - topic  → list:  compact rows w/ first-line snippet
   - inspo  → bento: asymmetric image grid, thumbnail-first
   - other  → table: kind/title/tags/updated (the previous default) */
function firstLineOf(body, max = 140) {
  if (!body) return '';
  const line = String(body).trim().split('\n').find((l) => l.trim()) || '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}

/* Markdown flattened to the words it renders as.
   A search result is a preview of a page, not a look at its source, and the
   panel was showing "## Shortlist for the Bindery run ![[attachments/
   endpaper-01.svg]]" — three quarters punctuation. Deliberately lossy: it is
   a one-line preview, not a renderer. */
function plainOf(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')            // fenced code
    .replace(/!\[\[[^\]]*\]\]/g, ' ')           // embeds — a filename is not prose
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')  // aliased wikilink → its label
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links → their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')         // heading markers
    /* Again, unanchored: an excerpt arrives with its newlines already
       collapsed to spaces, so "## notes" sits mid-string and the line-start
       pass above never sees it. Safe against #tags — a tag has no space
       after its hashes, and this requires one. */
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')              // quote markers
    .replace(/^\s{0,3}[-*+]\s+/gm, '')          // bullets
    .replace(/`([^`]*)`/g, '$1')                // code spans
    .replace(/\*\*|__|\*|_|~~/g, '')            // emphasis
    .replace(/\s+/g, ' ')
    .trim();
}

/* `text` with the first occurrence of `q` wrapped in a <mark>, as nodes. */
function markedText(text, q) {
  const s = String(text || '');
  const needle = String(q || '').trim();
  if (!needle) return [s];
  const at = s.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return [s];
  return [s.slice(0, at), h('mark', null, s.slice(at, at + needle.length)),
          s.slice(at + needle.length)];
}

/* A window of `body` around where `q` matches, as [before, match, after].
   Showing the head of a page and hoping the match is in it is how "About me"
   answered a search for "bind" with its first sentence. */
function snippetAround(body, q, max = 90) {
  const text = plainOf(body);
  const needle = String(q || '').trim();
  if (!needle) return [text.slice(0, max) + (text.length > max ? '…' : ''), '', ''];
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return [text.slice(0, max) + (text.length > max ? '…' : ''), '', ''];
  const lead = Math.max(0, at - Math.floor((max - needle.length) / 3));
  const before = (lead > 0 ? '…' : '') + text.slice(lead, at);
  const match = text.slice(at, at + needle.length);
  const tail = text.slice(at + needle.length, lead + max);
  return [before, match, tail + (lead + max < text.length ? '…' : '')];
}
/* Returns {url} for a remote asset or {asset} for one in the vault — never a
   `'/' + path` string, which only resolved when a server was serving them. */
function inspoThumb(p) {
  const items = (p.meta && Array.isArray(p.meta.layout)) ? p.meta.layout : [];
  for (const it of items) {
    if (it.type !== 'image') continue;
    if (it.assetUrl) return { url: it.assetUrl };
    if (it.asset) return { asset: it.asset };
  }
  // Bento-model pages keep items in the body; the excerpt keeps the first
  // ~300 chars of it, which is enough to find the first image embed.
  const m = String(p.excerpt || p.body || '').match(/!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|avif|svg))(?:\|[^\]]*)?\]\]/i);
  if (m) return { asset: m[1] };
  return null;
}
function itemCount(p) {
  const items = (p.meta && Array.isArray(p.meta.layout)) ? p.meta.layout : [];
  return items.length;
}

function ListView_Board(pages, onOpen) {
  return h('div', { className: 'pages-board' },
    pages.map((p) => {
      // A list never loads geometry: `pages()` serves index entries, and SPEC §7
      // keeps full bodies (and the `.canvas` sidecar) out of the index. So the
      // node count here is UNKNOWN, not zero — this card used to render it as
      // "empty board · 0 items" for every board in the vault, which is a claim
      // about the user's work rather than about what we loaded.
      const drawing = isDrawingPath(p.path);
      return h('div', { className: 'board-card', onClick: () => onOpen(p.id) },
        h('div', { className: 'board-card-hd' },
          h('span', { className: 'board-card-title' }, p.title || '(untitled)'),
          h('span', { className: 'board-card-when' }, fmtDate(p.updated))),
        h('div', { className: 'board-card-preview' },
          h('div', { className: 'board-card-empty' },
            drawing ? '✎ drawing' : '▦ board')),
        h('div', { className: 'board-card-ft' },
          // Named for what it holds. It was `board-card-count` — a leftover from
          // the node count above — and a `nowrap` excerpt under a count's
          // styling ran 20px past the card it sits in.
          h('span', { className: 'board-card-line' },
            firstLineOf(p.excerpt || '', 60) || (drawing ? 'Excalidraw' : 'JSON Canvas')),
          h('span', { className: 'board-card-tags' },
            (p.tags || []).slice(0, 3).map((t) => TagChip(t)))));
    }));
}

// Tree-aware list. Pages with meta.parent referencing a sibling are rendered
// indented under their parent (up to MAX_DEPTH levels, matching the create-cap).
const SUBPAGE_MAX_DEPTH = 3;
function ListView_List(pages, onOpen) {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const childMap = new Map();
  const roots = [];
  pages.forEach((p) => {
    const parentId = p.meta && p.meta.parent;
    if (parentId && byId.has(parentId)) {
      if (!childMap.has(parentId)) childMap.set(parentId, []);
      childMap.get(parentId).push(p);
    } else {
      roots.push(p);
    }
  });
  // Sort siblings newest-first
  const byNewer = (a, b) => String(b.updated || '').localeCompare(String(a.updated || ''));
  roots.sort(byNewer);
  childMap.forEach((arr) => arr.sort(byNewer));

  const rows = [];
  function renderRow(p, depth) {
    const indent = depth * 22;
    const row = h('div', {
      className: 'list-row' + (depth > 0 ? ' list-row-child' : ''),
      style: { paddingLeft: (14 + indent) + 'px' },
      onClick: () => onOpen(p.id),
    },
      depth > 0 ? h('span', { className: 'tree-branch' }, '└─') : null,
      h('div', { className: 'list-row-main' },
        h('div', { className: 'list-row-title' }, p.title || '(untitled)'),
        h('div', { className: 'list-row-snippet' }, firstLineOf(p.body))),
      h('div', { className: 'list-row-meta' },
        h('span', { className: 'list-row-tags' },
          (p.tags || []).slice(0, 4).map((t) => TagChip(t))),
        h('span', { className: 'list-row-when' }, fmtDate(p.updated))));
    rows.push(row);
    if (depth < SUBPAGE_MAX_DEPTH - 1) {
      (childMap.get(p.id) || []).forEach((c) => renderRow(c, depth + 1));
    }
  }
  roots.forEach((r) => renderRow(r, 0));
  return h('div', { className: 'pages-list pages-tree' }, rows);
}

/* Topics list as cards, not rows.
   A topic's identity is its gravity — how much orbits it, how recently you
   argued with it — and a table column of dates says none of that. The tree
   view it used to share with markdown pages was also modelling the wrong
   thing: topics nest by reference, not by parent, so the indent was drawing
   a hierarchy that is not how they relate. */
function ListView_TopicCards(pages, onOpen) {
  const orbitOf = (p) => {
    try { return SB.data().orbit(p.id).count; } catch (_) { return 0; }
  };
  return h('div', { className: 'topic-cards' },
    pages.map((p) => {
      const n = orbitOf(p);
      return h('div', { className: 'topic-card', onClick: () => onOpen(p.id) },
        h('div', { className: 'topic-card-hd' },
          h('span', { className: 'topic-card-t' }, p.title || '(untitled)'),
          h('span', { className: 'topic-card-when' }, fmtDate(p.updated))),
        h('div', { className: 'topic-card-thesis' }, firstLineOf(p.body) || 'No position written yet.'),
        h('div', { className: 'topic-card-ft' },
          // The gravity, stated. Zero is not a failure — it is a topic you
          // have not connected yet, and saying so is the nudge.
          h('span', { className: 'topic-card-orb' + (n ? '' : ' is-zero') },
            n ? nOf(n, 'page') + ' in orbit' : 'nothing in orbit yet'),
          h('span', { className: 'topic-card-tags' },
            (p.tags || []).slice(0, 3).map((t) => TagChip(t)))));
    }));
}

function ListView_Bento(pages, onOpen) {
  return h('div', { className: 'pages-bento' },
    pages.map((p) => {
      const thumb = inspoThumb(p);
      const cls = 'bento-tile' + (thumb ? '' : ' bento-tile-empty');
      return h('div', { className: cls, onClick: () => onOpen(p.id) },
        thumb
          ? (thumb.url
              ? h('img', { src: thumb.url, loading: 'lazy', alt: p.title || '' })
              : vaultImage(thumb.asset, { alt: p.title || '' }))
          : null,
        h('div', { className: 'bento-tile-overlay' },
          h('div', { className: 'bento-tile-title' }, p.title || '(untitled)'),
          h('div', { className: 'bento-tile-meta' },
            h('span', null, nOf(itemCount(p), 'item')),
            h('span', null, fmtDate(p.updated)))));
    }));
}

/* The page list.
   It was a four-column table: a 110px KIND column holding one 14px glyph, a
   title, a 220px TAGS column that is empty on most rows, and a date. Two of
   the four columns were usually blank, so a list of eight notes was mostly
   white space with a word in it — and the row said nothing about the page
   beyond its name, which is the one thing you already knew.

   A row is a thing now, not a record: the kind as a coloured glyph against
   the title rather than a column of its own, and the page's first line under
   it, which is what actually tells two notes apart. Tags and the date sit
   right, quiet. No header band — with the kind inline there is nothing left
   to label, and the strip above already says what you are looking at. */
function ListView_Table(pages, onOpen) {
  return h('div', { className: 'pages-table' },
    pages.map((p) => {
      const m = metaForPage(p);
      // plainOf, not the raw body: an excerpt is a preview of the PAGE, and
      // the raw form put "## Coptic **lies flat** > A tool that…" in a row
      // whose whole job is to be scannable.
      const snip = firstLineOf(plainOf(p.body));
      return h('div', { className: 'pages-row', onClick: () => onOpen(p.id) },
        h('span', { className: 'row-g', style: { color: m.color || 'var(--muted)' },
                    title: m.label }, icon(m.icon || 'file-text')),
        h('span', { className: 'row-main' },
          h('span', { className: 'row-t' }, p.title || '(untitled)'),
          snip ? h('span', { className: 'row-x' }, snip) : null),
        (p.tags || []).length
          ? h('span', { className: 'row-tags' }, p.tags.slice(0, 3).map((t) => TagChip(t)))
          : null,
        h('span', { className: 'row-w' }, fmtDate(p.updated)));
    }));
}

function V2PagesList(kind, pages, onOpen, onCreate) {
  const meta = kind ? KIND_META[kind] : null;
  // Sentence case, like every other screen title. It used to lowercase the
  // kind label — so the nav said "Note" and the screen it opened said "note".
  const title = meta ? meta.label : 'All pages';
  const wrap = h('div', { className: 'screen' });
  // Local filter state. We keep the input value in a closure so re-render
  // doesn't clobber what the user has typed.
  // A search submitted from the top bar lands here as a filter, so Enter does
  // what the box says instead of navigating to a screen that no longer exists.
  let query = app.pendingFilter || '';
  app.pendingFilter = null;
  const listSlot = h('div', { className: 'list-slot' });

  function matchesQuery(p, q) {
    if (!q) return true;
    const n = q.toLowerCase();
    return (p.title || '').toLowerCase().includes(n)
        || (p.body || '').toLowerCase().includes(n)
        || (p.tags || []).some((t) => t.toLowerCase().includes(n))
        || (p.slug || '').toLowerCase().includes(n);
  }

  function renderList() {
    const filtered = query ? pages.filter((p) => matchesQuery(p, query)) : pages;
    clear(listSlot);
    let view;
    if (!filtered.length) {
      if (!pages.length) {
        view = kind === 'canvas'
          ? EmptyState('No boards yet.',
              'A board is a .canvas file — make one in Obsidian and it appears here, '
              + 'rendered read-only. For a spatial page this app can edit, make a Drawing.')
          : EmptyState(`No ${meta ? meta.label.toLowerCase() : ''} pages yet.`,
              'Click "new" above to create one.');
      } else {
        view = EmptyState('No matches for "' + query + '"',
          'Try a different keyword, or clear the filter.');
      }
    } else if (kind === 'canvas') view = ListView_Board(filtered, onOpen);
    else if (kind === 'topic') view = ListView_TopicCards(filtered, onOpen);
    else if (kind === 'markdown') view = ListView_List(filtered, onOpen);
    else if (kind === 'inspo') view = ListView_Bento(filtered, onOpen);
    else view = ListView_Table(filtered, onOpen);
    listSlot.appendChild(view);
    // Update count line
    if (countEl) countEl.textContent = (query ? filtered.length + ' of ' : '') + nOf(pages.length, 'page');
  }

  const countEl = h('span', null, nOf(pages.length, 'page'));
  const searchInput = h('input', {
    className: 'list-search',
    type: 'search',
    placeholder: 'filter ' + (meta ? meta.label.toLowerCase() : 'pages') + ' by title, body, tags…',
    value: query,
    onInput: (e) => { query = e.target.value; renderList(); },
    onKeyDown: (e) => {
      if (e.key === 'Escape') { e.target.value = ''; query = ''; renderList(); }
    },
  });

  /* Board is the one list with nothing to offer here — see CREATABLE_KINDS.
     A screen whose primary action would write a board it cannot then let you
     edit is worse than a screen with no primary action, so it says where
     boards come from instead. */
  append(wrap, PageHeader(title, null,
    meta ? meta.hint : (nOf(pages.length, 'page') + ' total'),
    kind === 'canvas'
      ? h('span', { className: 'screen-hd-note' }, 'Arranged in Obsidian · read-only here')
      : h('button', { className: 'btn-primary', onClick: onCreate },
          '+ new ' + (meta ? meta.label.toLowerCase() : 'page'))));
  wrap.appendChild(h('div', { className: 'list-search-row' },
    searchInput, h('span', { className: 'list-search-count' }, countEl)));
  if (kind === 'bookmark') {
    const drop = BookmarkDrop(pages, listSlot, renderList, countEl);
    wrap.appendChild(drop);
    // It listens on `document`, so leaving the screen has to unhook it —
    // otherwise pasting a link into a note two screens later files a bookmark.
    wrap.__teardown = () => document.removeEventListener('paste', drop.__onPaste);
  }
  wrap.appendChild(listSlot);
  renderList();
  return wrap;
}

/* ── Feeding the bookmark list ─────────────────────────────────────────
   Saving a link used to be: press "+ new bookmark", land on a blank page,
   find the url field, paste, invent a title, go back. Six actions and a
   context switch to record something you already had on the clipboard.

   This is the whole gesture instead: paste, Enter. And because the clipboard
   is often a column of links rather than one, it takes as many as you give
   it — the parser reads links out of whatever shape the text arrives in.

   Titles come from the URL. The app cannot fetch a page to learn its real
   title (no network requests, by contract) and does not pretend to: the
   clipper is what gets the true title and the card artwork, and this says
   so once, quietly, rather than shipping a worse version of it. */
function BookmarkDrop(pages, listSlot, renderList, countEl) {
  const ta = h('textarea', {
    className: 'bm-drop-ta',
    rows: 1,
    placeholder: 'Paste a link and press Enter — or paste a whole list of them',
    onKeyDown: (e) => {
      // Enter saves; Shift+Enter is the escape hatch for building a list by
      // hand before committing it.
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    },
    onInput: (e) => {
      // Grow with the paste, so twelve links do not hide inside one line.
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 220) + 'px';
    },
  });
  const status = h('div', { className: 'bm-drop-status' });
  const btn = h('button', { className: 'btn-primary', onClick: () => submit() }, 'Save');
  const wrap = h('div', { className: 'bm-drop' },
    h('div', { className: 'bm-drop-row' }, ta, btn),
    status);

  async function submit() {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    btn.disabled = true;
    clear(status); status.className = 'bm-drop-status';
    status.appendChild(document.createTextNode('saving…'));
    try {
      const r = await SB.data().addBookmarks(text);
      if (!r.found) {
        status.className = 'bm-drop-status is-warn';
        clear(status);
        status.appendChild(document.createTextNode('No links in that — a bookmark needs an http(s) address.'));
        btn.disabled = false;
        return;
      }
      // Straight into the list under the box, newest first, with no reload:
      // the point of the gesture is that the result is immediate.
      r.added.forEach((p) => { cacheSetPage(p); pages.unshift(p); });
      invalidatePageIndex();
      await refreshCounts();
      // The nav count and the list it opens must agree — "Bookmark 1" over a
      // list of four is the sidebar lying, and it is the same bug the kind
      // counts were fixed for once already.
      refreshSidebar();
      renderList();
      if (countEl) countEl.textContent = nOf(pages.length, 'page');
      ta.value = ''; ta.style.height = 'auto';
      clear(status);
      status.className = 'bm-drop-status is-ok';
      const bits = [];
      if (r.added.length) bits.push('Saved ' + nOf(r.added.length, 'link'));
      /* Duplicates are named, not swallowed. "Saved 3" when you pasted 4 is
         a silence the user has to investigate; saying which one you already
         had is the answer they would have gone looking for. */
      if (r.duplicates.length) {
        bits.push(r.duplicates.length === 1
          ? 'already saved: ' + (r.duplicates[0].title || 'that link')
          : nOf(r.duplicates.length, 'link') + ' already saved');
      }
      status.appendChild(document.createTextNode(bits.join(' · ')));
      if (r.duplicates.length === 1) {
        status.appendChild(h('button', {
          className: 'bm-drop-open',
          onClick: () => openPage(r.duplicates[0].id),
        }, 'open it'));
      }
    } catch (e) {
      status.className = 'bm-drop-status is-warn';
      clear(status);
      status.appendChild(document.createTextNode('Could not save — ' + (e.message || e)));
    } finally {
      btn.disabled = false;
      ta.focus();
    }
  }

  /* Paste anywhere on the screen lands here. The clipboard is where links
     come from, so ⌘V should not first require finding the right box —
     unless you are already typing in one, in which case it means what it
     always means. */
  wrap.__onPaste = (e) => {
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!urlsLikely(text)) return;
    e.preventDefault();
    ta.value = ta.value ? ta.value + '\n' + text : text;
    ta.dispatchEvent(new Event('input'));
    submit();
  };
  document.addEventListener('paste', wrap.__onPaste);
  return wrap;
}

/** Cheap pre-check, so a paste of ordinary prose is left alone. */
function urlsLikely(text) {
  return /https?:\/\/\S/i.test(String(text || ''));
}

function V2PageView(pageId, onChange, onDeleted) {
  const wrap = h('div', { className: 'screen page-screen' });
  let page = null;
  let dirty = false;
  let saveTimer = null;
  let inFlight = 0;         // writes started and not yet finished
  // Body renderers can register cleanup callbacks (e.g. global event listeners
  // they attached). They're run before every re-layout and on screen unmount.
  let bodyTeardowns = [];
  const onBodyTeardown = (fn) => bodyTeardowns.push(fn);
  /* Which mentions are worth showing as chips.
     A mention chip means "a link to another page you can open". Two things
     were getting in that are neither, and both looked like broken links:

       · the page's OWN file — a board whose .canvas path is listed among its
         mentions, so "Binding Methods" showed a chip reading
         "Binding Methods.canvas" pointing at itself;
       · asset paths — five chips all reading "attachments/endpaper…",
         truncated to the point of being indistinguishable.

     This filters for DISPLAY only. The underlying array is untouched, so the
     file on disk keeps whatever Obsidian put there and nothing is lost on the
     next save. Returns {mn, i} so the remove button still splices the right
     index out of the real array. */
  const ASSET_RE = /^(attachments|assets)\//i;
  const visibleMentions = () => {
    const own = new Set();
    if (page.path) {
      own.add(String(page.path));
      own.add(String(page.path).split('/').pop());
      own.add(String(page.path).split('/').pop().replace(/\.[^.]+$/, ''));
    }
    if (page.title) own.add(String(page.title));
    return (page.mentions || [])
      .map((mn, i) => ({ mn, i }))
      .filter(({ mn }) => {
        const v = String(mn || '');
        if (!v) return false;
        if (ASSET_RE.test(v)) return false;
        if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(v)) return false;
        // Compare the STEM too, not just the literal. A canvas page is two
        // files — `X.md` and `X.canvas` — so a board carried its own sibling
        // as a mention and drew a chip pointing at itself.
        const stem = v.split('/').pop().replace(/\.[^.]+$/, '');
        return !own.has(v) && !own.has(v.split('/').pop()) && !own.has(stem);
      });
  };

  /* Linking a page writes the wikilink into the BODY — `links.withMention`
     says why that is the only place it can go. `page.mentions` is updated beside it
     so the chip appears on the spot; on the next load the array is derived
     from the very text just written, which is the whole point of writing it. */
  const linkMention = (name) => {
    const wanted = _links().mentionName(name);
    if (!wanted) return;
    const next = _links().withMention(page.body, wanted);
    const known = (page.mentions || []).some((m) =>
      String(m).trim().toLowerCase() === wanted.toLowerCase());
    if (next === page.body && known) return;      // already linked, and shown
    page.body = next;
    if (!known) { page.mentions = page.mentions || []; page.mentions.push(wanted); }
    queueSave(); layout();
  };

  /* A stored mention can be a title, a path or — from an older build of the
     picker — an id, and the body holds none of those three but the name. Try
     each form and stop at the one the text actually answers to. */
  const unlinkMention = (mn, i) => {
    const stem = String(mn || '').split('/').pop().replace(/\.(md|canvas)$/i, '');
    let next = page.body;
    for (const cand of [String(mn || ''), stem, resolveMention(mn).label]) {
      const tried = _links().withoutMention(next, cand);
      if (tried !== next) { next = tried; break; }
    }
    page.body = next;
    page.mentions.splice(i, 1);
    queueSave(); layout();
  };

  const runBodyTeardowns = () => {
    bodyTeardowns.forEach((fn) => { try { fn(); } catch (_) {} });
    bodyTeardowns = [];
  };

  /* Save status. Every edit here autosaves 600ms after you stop typing, and
     until now said nothing at all — you were asked to trust that a file on
     your own disk had been rewritten, with no evidence. That is the sharpest
     bit of friction in the app: it is not slow or hard, it is silent.
     Three states, deliberately quiet — this reassures, it does not announce. */
  const setSaveState = (state, detail) => {
    const el = wrap.querySelector('.save-state');
    if (!el) return;
    el.setAttribute('data-state', state);
    // The reason goes in the title: the strip stays one word wide, and the
    // detail is one hover away rather than absent.
    if (detail) el.setAttribute('title', detail); else el.removeAttribute('title');
    clear(el);
    if (state === 'saving') {
      el.appendChild(h('span', { className: 'save-dot' }));
      el.appendChild(document.createTextNode('Saving…'));
    } else if (state === 'saved') {
      el.appendChild(icon('check'));
      el.appendChild(document.createTextNode('Saved'));
      // Fade back to nothing — a permanent "Saved" becomes furniture and
      // stops meaning anything.
      clearTimeout(el._t);
      el._t = setTimeout(() => { if (el.getAttribute('data-state') === 'saved') setSaveState('idle'); }, 2200);
    } else if (state === 'error') {
      clearTimeout(el._t);       // a failure stays put until the next attempt
      el.appendChild(icon('x'));
      el.appendChild(document.createTextNode('Not saved'));
    }
  };

  const queueSave = () => {
    if (!page) return;
    dirty = true;
    setSaveState('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, 600);
  };

  /* Write now, do not wait out the debounce.
     The 600ms timer exists so that typing does not hit the disk on every
     keystroke. It is not a reason to still be holding unsaved text once the
     user has plainly finished — closing the editor, leaving the page, hiding
     the tab. Every one of those calls this instead. */
  const flushSave = () => {
    clearTimeout(saveTimer);
    if (dirty) commit();
  };

  /* The exits the router does not know about.
     `render()` runs __teardown on a route change and closeTab goes through
     render, so navigating inside the app was already covered. Closing the
     window, reloading, or switching to another tab was not: the debounce
     could still be holding the last thing typed, and a local-first app's
     only copy is the one on disk.

     `pagehide` and a hidden `visibilitychange` are the two events that
     actually fire on the way out — beforeunload is unreliable for work and
     is used below only to raise the alarm, never to do the writing. */
  const leaveHandler = () => flushSave();
  const visHandler = () => { if (document.visibilityState === 'hidden') flushSave(); };
  window.addEventListener('pagehide', leaveHandler);
  document.addEventListener('visibilitychange', visHandler);
  /* `beforeunload` does two jobs, and the first one is not optional.

     WriterElection also listens for `pagehide`, and releases this tab's write
     lock when it fires. It registers at vault startup — long before this view
     exists — so on a real close its handler runs FIRST and a flush attempted
     from `pagehide` is refused with "another tab holds the write lock". The
     last thing typed would be lost, silently, which is the exact failure this
     whole block exists to prevent. `beforeunload` fires before `pagehide`,
     while the lock is still held, so the write is issued from here.

     Second job: if a write is genuinely still in the air, say so. Only then —
     warning about a page that has already been flushed would be a dialog that
     cries wolf on every close. */
  const unloadGuard = (e) => {
    flushSave();
    if (!inFlight) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', unloadGuard);
  const commit = async () => {
    if (!page || !dirty) return;
    dirty = false;
    inFlight++;
    try {
      /* No `mentions` here. It is not a field anything writes: the index
         derives it from the body's wikilinks on every rebuild, so sending it
         asks the vault to store something it has no way to store — and
         `updatePage` has always dropped it on the floor. The body carries it. */
      const patched = await savePage({
        title: page.title, body: page.body, tags: page.tags,
        kind: page.kind, slug: page.slug,
        meta: page.meta,
      });
      if (!patched) return;                 // refused; savePage() set the state
      page.updated = patched.updated;
      setSaveState('saved');
      if (patched.path && patched.path !== page.path) {
        // The file follows the title, so a save can move it. The deep link is
        // patched in place rather than re-laid out: the rename lands while the
        // user is still typing in the title field, and a re-render would take
        // the caret with it.
        page.path = patched.path;
        const obs = wrap.querySelector('.page-meta-obs');
        const href = obsidianUrl(page.path);
        if (obs && href) obs.href = href;
      }
      cacheSetPage(patched);  // keep page cache fresh so revisits are instant
      invalidatePageIndex();  // title may have changed → refresh mention labels
      onChange && onChange(patched);
    } catch (e) {
      console.warn('save failed', e);
      setSaveState('error');
    } finally {
      inFlight--;
    }
  };

  /* 6.3: conflict UI. put() re-reads `updated` from disk before writing and
     refuses when it moved, so an Obsidian edit is never silently clobbered.
     On overwrite the disk version is preserved as `<name> (conflict <date>).md`
     first — neither side's work is ever lost (SPEC §8). */
  async function savePage(patch, force) {
    const r = await SB.data().updatePage(page.id, force ? { ...patch, force: true } : patch);
    if (!r || r.ok !== false) return r;
    if (r.reason !== 'conflict') {
      // Every refusal that is not a conflict used to end here, as a
      // console.warn nobody has open. The edit stayed on screen, so the page
      // looked saved and was not — the worst failure mode a local-first app
      // has, because the only copy is the one you are about to close.
      console.warn('save refused:', r.reason, r.message || '');
      setSaveState('error', r.message || r.reason || 'The vault refused the write.');
      return null;
    }
    const overwrite = await confirmDialog({
      title: 'Changed on disk',
      body: 'This page was edited outside the app — probably in Obsidian — since you '
          + 'opened it. Reload to take the version on disk, or overwrite with yours. '
          + 'Overwriting keeps the disk version beside it as a conflict copy.',
      confirmLabel: 'overwrite',
      cancelLabel: 'reload',
      danger: true,
    });
    if (!overwrite) {
      cacheInvalidatePage(page.id);
      const fresh = await getPageCached(page.id);
      if (fresh) { page.body = fresh.body; page.title = fresh.title; page.updated = fresh.updated; }
      render();
      return null;
    }
    return savePage(patch, true);
  }

  // Upload an image asset; returns {path, url}. Shared by the flow editor
  // (node images) and the components table (row images).
  async function uploadAsset(file) {
    const j = await SB.data().writeAsset(file);
    if (j && j.ok === false) throw new Error('upload refused: ' + j.reason);
    return { path: j.path, url: j.url };
  }

  /* The structural sections this app carries but does not edit.

     CONVENTION reserves five body headings. `## Attachments` has a surface —
     the tray on a topic — and the other four do not: `## Thread` came out of
     the chat this app no longer has. They used to arrive inside `page.body`
     and go back out through `escapeUser`, which treats a body as user prose
     and backslashed every one of those headings, so a real section was unmade
     by the first save that touched the page. They are kept verbatim on disk
     now (see vault.js `put`), which leaves the question of whether to show
     them — and a section the app silently hides is a section nobody can tell
     survived. Read-only, because there is nothing here that could save an
     edit to one. */
  function renderCarriedSections() {
    if (!page || !page.sections) return null;
    const el = h('div', { className: 'page-carried md-rendered' });
    try {
      // The same path the prose takes, so a `[[wikilink]]` in a `## Links`
      // section resolves here exactly as it does three inches above it.
      el.appendChild(h('div', { html: SB.data().renderHtml(page.sections).html }));
      getPageIndex().then(() => { decorateMentions(el); decorateHashtags(el); }).catch(() => {});
    } catch (e) {
      el.appendChild(h('pre', { className: 'page-carried-raw' }, page.sections));
    }
    return el;
  }

  // ── Body renderers ────────────────────────────────────────────────────
  function renderDefaultBody() {
    return h('div', { className: 'page-body' },
      ProseEditor({
        getValue: () => page.body,
        setValue: (v) => { page.body = v; queueSave(); }, onDone: flushSave,
        placeholder: 'Write…  Markdown works, [[wikilinks]] resolve, #tags stick.',
      }));
  }

  /* ── Flow (kind: flow) — information-architecture editor ──────────
     A node graph of screens + edge cases, grouped into vertical
     section bands. Click a block → inspector (image, details, connect
     a screen, refer any personal/work page). Drag to reposition.
     Persists to page.meta.{sections,nodes,edges}; node screen/refs are
     mirrored into page.mentions so the global graph stays in sync. */
  // The flow / ia / component / token renderers lived here. They served the
  // work-mode kinds, which the migration dropped -- they are not in
  // KIND_ORDER, no page in the vault carries them, and PLAN.md's OUT OF
  // SCOPE forbids bringing them back. A hand-written `kind: flow` page now
  // falls through to renderDefaultBody, which reads it as prose.

  function renderTopicBody() {
    if (!page.meta) page.meta = {};
    if (!Array.isArray(page.meta.attachments)) page.meta.attachments = [];

    const wrap = h('div', { className: 'page-body topic-body' });

    // ── Attached materials section ──
    const attSec = h('div', { className: 'topic-att-sec' });

    // ── Per-type behaviour ────────────────────────────────────────
    // Each attachment kind has:
    //   - placeholder hint for the paste textarea
    //   - source label that appears on the card chip
    //   - rendering rule for the expanded preview
    // 'chat' subtypes are LLM-specific; they share the chat parser but the
    // source label differentiates them so the AI sees "(chatgpt)" vs "(claude)".
    const ATT_TYPES = {
      text: { label: 'text', hint: 'paste any plain notes here…' },
      markdown: { label: 'markdown', hint: 'paste markdown content — formatting will be rendered when expanded…' },
      link: { label: 'link', hint: 'paste a URL — the article body or video transcript will be fetched and pinned' },
      'chat:chatgpt': { label: 'chatgpt', hint: 'paste a ChatGPT conversation export…\n\nUser: …\nAssistant: …', source: 'chatgpt', kind: 'chat' },
      'chat:claude':  { label: 'claude',  hint: 'paste a Claude conversation export…\n\nHuman: …\nAssistant: …',  source: 'claude',  kind: 'chat' },
      'chat:gemini':  { label: 'gemini',  hint: 'paste a Gemini conversation export…',  source: 'gemini',  kind: 'chat' },
      'chat:notebooklm': { label: 'notebooklm', hint: 'paste from NotebookLM — sources or Q&A…', source: 'notebooklm', kind: 'chat' },
      'chat:other':   { label: 'chat',    hint: 'paste any AI conversation export here…', source: 'chat', kind: 'chat' },
    };

    function guessTitle(type, body) {
      const line = (body.split('\n').find((l) => l.trim()) || '').trim();
      return line.slice(0, 60) || ('attachment ' + new Date().toISOString().slice(0, 10));
    }
    // Parse a chat export into role-labeled turns. Matches the first colon
    // after a known role at the start of a line. Falls back to one big block.
    const _CHAT_ROLE_RE = /^(User|Assistant|Human|AI|System|ChatGPT|Claude|Gemini|Bot)\s*:\s*/i;
    function parseChatTurns(body) {
      const lines = String(body || '').split('\n');
      const turns = [];
      let cur = null;
      for (const line of lines) {
        const m = _CHAT_ROLE_RE.exec(line);
        if (m) {
          if (cur && cur.text.trim()) turns.push(cur);
          cur = { role: m[1].toLowerCase(), text: line.slice(m[0].length) };
        } else if (cur) {
          cur.text += '\n' + line;
        }
      }
      if (cur && cur.text.trim()) turns.push(cur);
      return turns;
    }
    function isUserRole(role) {
      return role === 'user' || role === 'human';
    }

    function pasteAttachmentModal(typeKey) {
      const spec = ATT_TYPES[typeKey] || ATT_TYPES.text;
      const titleI = h('input', { className: 'topic-att-titleI', placeholder: 'title (optional)' });
      const bodyT = h('textarea', { className: 'topic-att-bodyT', placeholder: spec.hint });
      const bg = h('div', { className: 'modal-bg' });
      const close = () => bg.remove();
      const save = () => {
        const body = bodyT.value.trim();
        if (!body) { toast('Paste or upload something first'); return; }
        const isChat = spec.kind === 'chat';
        page.meta.attachments.push({
          id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          type: isChat ? 'chat' : typeKey,
          title: titleI.value.trim() || guessTitle(typeKey, body),
          source: isChat ? spec.source : typeKey,
          body,
        });
        queueSave(); renderAttachments(); close();
      };

      // Markdown gets a file-picker too — read .md/.txt into the textarea
      const extraRow = h('div', { className: 'att-modal-extra' });
      if (typeKey === 'markdown' || typeKey === 'text') {
        const accept = typeKey === 'markdown' ? '.md,.markdown,.txt,text/*' : '.txt,text/*';
        const fileInput = h('input', { type: 'file', accept, style: { display: 'none' },
          onChange: (e) => {
            const f = e.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
              bodyT.value = String(reader.result || '');
              if (!titleI.value.trim()) titleI.value = f.name.replace(/\.(md|markdown|txt)$/i, '');
            };
            reader.readAsText(f);
            e.target.value = '';
          },
        });
        extraRow.appendChild(h('label', { className: 'side-action' },
          fileInput, '↑ upload ' + (typeKey === 'markdown' ? '.md / .txt' : '.txt')));
        extraRow.appendChild(h('span', { className: 'att-modal-extra-or' }, 'or paste below'));
      }

      /* A "paste a share URL and we'll fetch the transcript" field lived
         here. It could never work — a browser tab cannot read chatgpt.com —
         so it always failed, and it advertised an in-app LLM integration the
         contract forbids. Pasting the conversation text is the path that
         works, and it is the one the textarea below already offers. */

      bg.appendChild(h('div', { className: 'modal' },
        h('div', { className: 'modal-hd' },
          h('b', null, 'Attach ' + spec.label),
          h('button', { className: 'sb-twk-x', onClick: close }, '✕')),
        h('div', { className: 'modal-body' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            titleI,
            extraRow.children.length ? extraRow : null,
            bodyT,
            h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
              h('button', { className: 'side-action', onClick: close }, 'cancel'),
              h('button', { className: 'btn-primary', onClick: save }, 'attach'))))));
      bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
      document.body.appendChild(bg);
      // Escape had no handler at all here — the only way out was the mouse.
      asDialog(bg, { onEscape: close });
      titleI.focus();
    }

    // Special link flow — paste URL → fetch + show preview → save
    /* Attach a link.
       This used to offer a "↓ fetch" button that promised to pull the page's
       body and preview it. A browser page cannot fetch an arbitrary URL —
       CORS forbids it, which is exactly why the clipper extension exists —
       so the button always failed and then asked "No body was fetched. Save
       the link without context anyway?", a question raised by the app's own
       broken promise.

       So: no fetch. You paste the URL, you type why it matters, and the
       clipper fills in the body when you capture through it. */
    function linkAttachmentModal() {
      const urlI = h('input', { className: 'set-input', placeholder: 'https://…', type: 'url' });
      const titleI = h('input', { className: 'set-input', placeholder: 'What is this? (optional)' });
      const noteT = h('textarea', {
        className: 'page-body-ta', placeholder: 'Why it matters, what to remember…',
        style: { minHeight: '110px' },
      });
      const bg = h('div', { className: 'modal-bg' });
      const close = () => bg.remove();
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

      function save() {
        const url = urlI.value.trim();
        if (!url) { urlI.focus(); return; }
        page.meta.attachments.push({
          id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          type: 'link',
          title: titleI.value.trim() || url,
          source: 'link',
          body: noteT.value.trim(),
          meta: { url },
        });
        queueSave(); renderAttachments(); close();
      }

      bg.appendChild(h('div', { className: 'modal confirm-modal' },
        h('div', { className: 'modal-hd' },
          h('b', null, 'Attach a link'),
          h('button', { className: 'sb-twk-x', onClick: close }, '\u2715')),
        h('div', { className: 'modal-body' },
          h('div', { className: 'att-link-form' },
            h('label', { className: 'am-lbl' }, 'URL'), urlI,
            h('label', { className: 'am-lbl' }, 'Title'), titleI,
            h('label', { className: 'am-lbl' }, 'Note'), noteT,
            h('p', { className: 'att-link-hint' },
              'The page body is not downloaded — a browser tab cannot read another site. ',
              'Capture through the clipper extension to bring the text in with it.'),
            h('div', { className: 'att-link-actions' },
              h('button', { className: 'btn', onClick: close }, 'Cancel'),
              h('button', { className: 'btn-create', onClick: save }, 'Attach'))))));
      bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(bg);
      asDialog(bg);
      urlI.focus();
    }

    // Dropdown menu for "+ chat" — picks a specific LLM source
    function openChatPicker(anchorBtn) {
      // Close any existing
      document.querySelectorAll('.att-chat-menu').forEach((n) => n.remove());
      const menu = h('div', { className: 'att-chat-menu' });
      // Plain material first — it is what most attachments are — then the
      // conversation exports, which are the specialised case.
      [['text', 'Text'], ['markdown', 'Markdown']].forEach(([k, label]) => {
        menu.appendChild(h('button', {
          className: 'att-chat-menu-item',
          onClick: () => { menu.remove(); pasteAttachmentModal(k); },
        }, label));
      });
      menu.appendChild(h('button', {
        className: 'att-chat-menu-item',
        onClick: () => { menu.remove(); linkAttachmentModal(); },
      }, 'Link'));
      menu.appendChild(h('div', { className: 'att-chat-menu-sep' }, 'Conversation export'));
      const opts = [
        ['chat:chatgpt', 'ChatGPT'],
        ['chat:claude', 'Claude'],
        ['chat:gemini', 'Gemini'],
        ['chat:notebooklm', 'NotebookLM'],
        ['chat:other', 'Other AI'],
      ];
      opts.forEach(([k, label]) => {
        menu.appendChild(h('button', {
          className: 'att-chat-menu-item',
          onClick: () => { menu.remove(); pasteAttachmentModal(k); },
        }, label));
      });
      /* Position AFTER the items exist — measuring an empty menu gave a
         height of zero and the flip never triggered. Flips up when there is
         no room below and clamps to the right edge: the tray sits at the
         bottom of a topic, so opening downward put the menu under the demo
         banner, off the viewport, with its options unreachable. */
      menu.style.position = 'fixed';
      menu.style.visibility = 'hidden';
      document.body.appendChild(menu);
      const rect = anchorBtn.getBoundingClientRect();
      const mh = menu.offsetHeight, mw = menu.offsetWidth;
      const roomBelow = window.innerHeight - rect.bottom;
      menu.style.top = (roomBelow < mh + 16 && rect.top > mh + 16)
        ? (rect.top - mh - 4) + 'px'
        : (rect.bottom + 4) + 'px';
      menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - mw - 8)) + 'px';
      menu.style.visibility = '';

      // Click anywhere outside closes it
      setTimeout(() => {
        const off = (e) => {
          if (menu.contains(e.target) || anchorBtn.contains(e.target)) return;
          menu.remove();
          document.removeEventListener('click', off, true);
        };
        document.addEventListener('click', off, true);
      }, 0);
    }

    function renderAttachments() {
      clear(attSec);
      /* Four buttons — "+ text + markdown + link + chat" — for what is one
         action with a type. And the whole tray sat above the description
         with a "· 0" counter on a fresh topic, so a page whose purpose is
         thinking opened with an empty filing cabinet at the top.

         One Attach control, type chosen inside. When there is nothing
         attached the tray is a single quiet line, not a section. */
      const n = page.meta.attachments.length;
      const attachBtn = h('button', { className: 'btn topic-att-add' },
        icon('plus'), 'Attach');
      attachBtn.addEventListener('click', () => openChatPicker(attachBtn));

      attSec.appendChild(h('div', { className: 'topic-att-hd' },
        h('span', null, n ? 'Attached materials' : 'Reference material'),
        n ? h('span', { className: 'topic-att-n' }, String(n)) : null,
        h('div', { className: 'topic-att-actions' }, attachBtn)));

      if (!n) {
        attSec.appendChild(h('div', { className: 'topic-att-empty' },
          'Paste notes, a URL, or an exported conversation to keep beside this topic.'));
        return;
      }

      const list = h('div', { className: 'topic-att-list' });
      page.meta.attachments.forEach((att, idx) => {
        const card = h('div', { className: 'topic-att-card', 'data-source': att.source || att.type });
        const body = att.body || '';
        let expanded = false;
        const previewN = (s) => (s || '').slice(0, 500) + ((s || '').length > 500 ? '…' : '');
        const preview = h('div', { className: 'topic-att-preview' });

        function renderPreview() {
          clear(preview);
          if (att.type === 'link') {
            // Always render the OG card if we have one — it's the "preview"
            const ogm = att.meta || {};
            const og = ogm.og || null;
            if (og && og.image) preview.appendChild(h('img', {
              className: 'topic-att-link-img', src: og.image, loading: 'lazy', alt: '' }));
            preview.appendChild(h('div', { className: 'topic-att-link-meta' },
              h('a', { className: 'topic-att-link-title', href: ogm.url || '#', target: '_blank' },
                att.title || (og && og.title) || ogm.url || 'link'),
              og && og.description ? h('div', { className: 'topic-att-link-desc' }, og.description.slice(0, 200)) : null,
              h('div', { className: 'topic-att-link-host' }, (ogm.url || '').replace(/^https?:\/\//, '').slice(0, 60))));
            if (expanded && body) {
              preview.appendChild(h('pre', { className: 'topic-att-preview-text' }, body));
            }
            return;
          }
          if (att.type === 'markdown') {
            const md = h('div', { className: 'md-body topic-att-md' });
            renderMarkdown(expanded ? body : previewN(body)).forEach((n) => md.appendChild(n));
            preview.appendChild(md);
            return;
          }
          if (att.type === 'chat') {
            const turns = parseChatTurns(body);
            if (!turns.length) {
              preview.appendChild(h('pre', { className: 'topic-att-preview-text' }, expanded ? body : previewN(body)));
              return;
            }
            const wrapEl = h('div', { className: 'topic-att-chat' });
            const shown = expanded ? turns : turns.slice(0, 4);
            shown.forEach((t) => {
              wrapEl.appendChild(h('div', {
                className: 'topic-att-chat-turn topic-att-chat-' + (isUserRole(t.role) ? 'user' : 'asst'),
              },
                h('div', { className: 'topic-att-chat-r' }, t.role),
                h('div', { className: 'topic-att-chat-c' }, t.text.trim())));
            });
            if (!expanded && turns.length > 4) {
              wrapEl.appendChild(h('div', { className: 'topic-att-chat-more' }, '+ ' + (turns.length - 4) + ' more turn(s)'));
            }
            preview.appendChild(wrapEl);
            return;
          }
          // text fallback
          preview.appendChild(h('pre', { className: 'topic-att-preview-text' }, expanded ? body : previewN(body)));
        }

        const head = h('div', { className: 'topic-att-head' },
          h('span', { className: 'topic-att-type' }, att.source || att.type),
          h('span', { className: 'topic-att-title' }, att.title || '(untitled)'),
          h('button', { className: 'topic-att-toggle', onClick: (e) => {
            e.stopPropagation();
            expanded = !expanded;
            card.classList.toggle('expanded', expanded);
            renderPreview();
            const t = head.querySelector('.topic-att-toggle');
            if (t) t.textContent = expanded ? '−' : '+';
          } }, '+'),
          h('button', { className: 'topic-att-del', onClick: async (e) => {
            e.stopPropagation();
            if (!await confirmDialog({
              title: 'Remove this attachment?',
              confirmLabel: '× remove', danger: true,
            })) return;
            page.meta.attachments.splice(idx, 1); queueSave(); renderAttachments();
          } }, '×'));
        card.appendChild(head);
        card.appendChild(preview);
        renderPreview();
        list.appendChild(card);
      });
      attSec.appendChild(list);
    }

    renderAttachments();

    // ── Topic description (collapsible, secondary) ──
    const descSec = h('div', { className: 'topic-desc-sec expanded' });

    descSec.appendChild(ProseEditor({
      getValue: () => page.body,
      setValue: (v) => { page.body = v; queueSave(); }, onDone: flushSave,
      placeholder: 'What are you working out here?\n\nMarkdown, [[wikilinks]] and #tags all work.',
      minHeight: 360,
    }));

    /* ── The orbit ────────────────────────────────────────────────────
       What makes a topic a topic rather than a note with a different pill.

       A note's backlinks are a curiosity, which is why they live in the rail.
       A topic's backlinks ARE the topic — the evidence that the idea is
       load-bearing — so they come out of the rail and into the body, grouped
       by kind, computed live from the graph (see Data.orbit).

       Nothing here is stored. The topic owns no pages; it attracts them. */
    const orbSec = h('div', { className: 'topic-orb-sec' });
    const orbHd = h('div', { className: 'topic-orb-hd' },
      h('span', { className: 'topic-orb-l' }, 'Orbit'),
      h('span', { className: 'topic-orb-n' }, '…'));
    orbSec.appendChild(orbHd);
    const orbBody = h('div', { className: 'topic-orb-body' });
    orbSec.appendChild(orbBody);

    function renderOrbit() {
      let res;
      try { res = SB.data().orbit(page.id); }
      catch (_) { res = { items: [], count: 0, tag: null }; }
      const items = res.items || [];
      orbHd.querySelector('.topic-orb-n').textContent = String(items.length);
      clear(orbBody);
      if (!items.length) {
        // The empty state teaches the two gestures, naming this page's own
        // tag — an empty section that does not say how to fill it is a dead end.
        orbBody.appendChild(h('div', { className: 'topic-orb-empty' },
          h('div', null, 'Nothing orbits this topic yet.'),
          h('div', { className: 'topic-orb-empty-how' },
            'Write ', h('code', null, '[[' + (page.title || 'this topic') + ']]'),
            ' in a note, or tag a page ',
            h('code', null, '#' + (res.tag || 'topic')), '.')));
        return;
      }
      // Grouped by kind, in the nav's order so the page reads the way the
      // sidebar does. metaForPage, not KIND_META — bookmarks and boards are
      // facets, and a group headed "Note" full of bookmarks is the label lying.
      const groups = new Map();
      items.forEach((p) => {
        const m = metaForPage(p);
        const key = m.label || p.kind;
        if (!groups.has(key)) groups.set(key, { meta: m, rows: [] });
        groups.get(key).rows.push(p);
      });
      const order = KIND_ORDER.map((k) => (KIND_META[k] || {}).label).filter(Boolean);
      const keys = [...groups.keys()].sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      keys.forEach((key) => {
        const g = groups.get(key);
        const grp = h('div', { className: 'topic-orb-grp' },
          h('div', { className: 'topic-orb-grp-hd', style: { '--k-c': g.meta.color || 'var(--muted)' } },
            h('span', { className: 'topic-orb-grp-g' }, icon(g.meta.icon || 'file-text')),
            h('span', null, key),
            h('span', { className: 'topic-orb-grp-n' }, String(g.rows.length))));
        g.rows.forEach((p) => {
          grp.appendChild(h('button', {
            className: 'topic-orb-row',
            onClick: () => { app.openPageId = p.id; app.route = 'page'; render(); },
          },
            h('span', { className: 'topic-orb-row-t' }, p.title || '(untitled)'),
            // WHY it is here. A link you wrote and a tag you sprinkled are
            // different kinds of evidence, and the difference is worth a glance.
            h('span', { className: 'topic-orb-via topic-orb-via-' + p.via },
              p.via === 'both' ? 'link + tag' : p.via),
            h('span', { className: 'topic-orb-row-w' }, fmtDate(p.updated))));
        });
        orbBody.appendChild(grp);
      });
    }
    renderOrbit();

    /* Writing first, material second. The tray used to come first, so every
       topic opened on an empty filing cabinet and you scrolled past your own
       storage to reach your own thinking. Attachments are what a topic is
       BUILT FROM; the topic is what it is FOR.

       The orbit sits between them: your position, then the evidence for it,
       then the raw material you are still digesting. */
    wrap.appendChild(descSec);
    wrap.appendChild(orbSec);
    wrap.appendChild(attSec);

    return { body: wrap };
  }

  /* 6.7 / 6.19: a board page still has a body, and after task 1.24 that body is
     where its `## Thread`, `## Board contents` and captions live. The board is
     the point of the screen, so the prose goes underneath it rather than
     competing with it — but it is rendered, not hidden. */
  function withBoardBody(boardEl) {
    const text = String(page.body || '').trim();
    if (!text) return boardEl;
    const wrap = h('div', { className: 'board-with-body' });
    wrap.appendChild(boardEl);
    const md = h('div', { className: 'md-rendered board-body-md' });
    try {
      md.innerHTML = SB.data().renderHtml(page.body).html;
      decorateMentions(md);
      decorateHashtags(md);
    } catch (e) { md.textContent = page.body; }
    wrap.appendChild(md);
    return wrap;
  }

  // ── Excalidraw ────────────────────────────────────────────────────────
  // The editor is ~8MB of vendored bundle, so it is imported the first time a
  // drawing is opened and never on the critical path. A vault with no drawings
  // pays nothing.
  let excalidrawModule = null;
  async function loadExcalidraw() {
    if (excalidrawModule) return excalidrawModule;
    /* Fonts resolve relative to this, and it has to be ABSOLUTE. The bundle
       feeds it to `new URL(file, base)`, and a URL base must be absolute — a
       bare 'vendor/excalidraw/' threw "Invalid base URL" once per text
       element, so every drawing rendered its boxes and arrows and none of its
       words. Derived from the document, so it still works under a subpath and
       still hardcodes nothing. */
    window.EXCALIDRAW_ASSET_PATH = new URL('vendor/excalidraw/', document.baseURI).href;
    if (!document.querySelector('link[data-excalidraw]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'vendor/excalidraw/excalidraw.css';
      link.setAttribute('data-excalidraw', '1');
      document.head.appendChild(link);
    }
    excalidrawModule = await import('./vendor/excalidraw/excalidraw.js');
    return excalidrawModule;
  }

  function renderExcalidrawBody() {
    const ex = (page.meta && page.meta.excalidraw) || null;
    const wrap = h('div', { className: 'page-body excalidraw-body' });

    if (ex && ex.error && !ex.scene) {
      // A drawing we cannot decode must not look like an empty one — offering a
      // blank canvas here would invite the user to draw over data still on disk.
      wrap.appendChild(h('div', { className: 'excalidraw-broken' },
        h('strong', null, 'This drawing could not be read.'),
        h('p', null, ex.error),
        h('p', null, 'The file has been left exactly as it is. Open it in Obsidian to recover it.')));
      return wrap;
    }

    const host = h('div', { className: 'excalidraw-host' });
    wrap.appendChild(host);
    wrap.appendChild(h('div', { className: 'excalidraw-status' }, 'loading the editor…'));
    const status = wrap.querySelector('.excalidraw-status');

    let handle = null;
    let savedVersion = null;
    let savedOnce = false;   // has this session written anything? decides the idle label
    let timer = null;
    // fileId → the vault file it was written to, seeded from what the file
    // already recorded so a reopened drawing does not re-file its own images.
    let embedPaths = new Map(
      ((ex && ex.embeddedFiles) || []).map((e) => [e.key, e.value]));

    // onChange fires on every pointer move. Writing per event would fill
    // `.history` with hundreds of near-identical snapshots and hammer the disk,
    // so a save is debounced and skipped entirely when the scene version is
    // unchanged (a pan or a selection is not an edit).
    const SAVE_AFTER_MS = 1200;
    async function persist() {
      if (!handle) return;
      const version = handle.version();
      // Nothing actually changed — but `queue()` has already put "unsaved
      // changes…" on screen, because onChange cannot tell a pan from an edit.
      // Returning here used to leave that label up forever: every drawing sat
      // there claiming unsaved work seconds after it had been written, which
      // is the save indicator lying in the one direction that matters.
      if (version === savedVersion) { status.textContent = savedOnce ? 'saved' : ''; return; }
      const scene = handle.getScene();
      if (!scene) return;
      status.textContent = 'saving…';
      // An image pasted into the drawing becomes a real file in attachments/
      // before the drawing is written, so the `## Embedded Files` index can
      // name it. Carries the mapping forward across saves — an image is
      // written out once, not once per keystroke.
      try {
        embedPaths = await SB.data().adoptDrawingImages(
          scene, page.title || page.slug, embedPaths);
      } catch (e) {
        // A drawing that cannot file its images is still a drawing worth
        // saving; the scene keeps them inline either way.
        console.warn('could not write drawing images to attachments/', e);
      }
      const md = window.SB_EXCALIDRAW.serialize(scene, {
        compressed: true,
        backOfNote: (ex && ex.backOfNote) || '',
        frontmatter: (ex && ex.frontmatter) || null,
        embeddedFiles: embedPaths,
      });
      // `body` is the whole plugin block; savePage routes it through the same
      // conflict + `.history` machinery every other page uses.
      const r = await savePage({ body: bodyOfExcalidrawFile(md) });
      // A refused save stays on screen: that one is not noise, it is the
      // reason the file on disk is not what you are looking at.
      if (r === null) { status.textContent = 'not saved'; return; }
      savedVersion = version;
      savedOnce = true;
      status.textContent = 'saved';
    }
    function queue() {
      clearTimeout(timer);
      status.textContent = 'unsaved changes…';
      timer = setTimeout(persist, SAVE_AFTER_MS);
    }

    /* A scene that never recorded where it was looking opens at the scene
       origin — which is the top-left corner of the viewport, under the
       floating toolbar. A drawing saved from this app or from the Obsidian
       plugin carries scrollX/scrollY and is left exactly as it was; one that
       does not gets framed, because the alternative is opening a drawing
       with its title hidden behind a button bar.
       (`initialData.scrollToContent` would do this, but the vendored mount
       wrapper runs restore() first and restore() drops the flag.) */
    const TOOLBAR_CLEARANCE = 88;
    function framed(scene) {
      if (!scene || !Array.isArray(scene.elements) || !scene.elements.length) return scene;
      const st = scene.appState || {};
      if (st.scrollX != null || st.scrollY != null) return scene;
      let minX = Infinity, minY = Infinity;
      for (const el of scene.elements) {
        if (!el || el.isDeleted) continue;
        if (typeof el.x === 'number') minX = Math.min(minX, el.x);
        if (typeof el.y === 'number') minY = Math.min(minY, el.y);
      }
      if (!isFinite(minX) || !isFinite(minY)) return scene;
      return { ...scene, appState: { ...st, scrollX: -minX + 32, scrollY: -minY + TOOLBAR_CLEARANCE } };
    }

    loadExcalidraw().then((mod) => {
      status.textContent = '';
      handle = mod.mountExcalidraw(host, {
        // Sepia is a light mode. Comparing against the string 'light' put the
        // editor in dark chrome on a paper-coloured page.
        theme: themeFamily(),
        initialData: framed((ex && ex.scene) || null),
        onReady: (hd) => { savedVersion = hd.version(); },
        onChange: queue,
      });
      // A drawing left with pending edits must not vanish on navigation.
      window.addEventListener('beforeunload', persist);
    }).catch((e) => {
      status.textContent = '';
      wrap.appendChild(h('div', { className: 'excalidraw-broken' },
        h('strong', null, 'The drawing editor failed to load.'),
        h('p', null, String(e && e.message || e))));
    });

    return wrap;
  }

  // serialize() returns a whole file; the vault writes frontmatter separately,
  // so hand back only what belongs in the body.
  function bodyOfExcalidrawFile(md) {
    return String(md).replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  // Inspo is a bento wall now, not a board: items live in the markdown body
  // (image, caption, #tags, source url; `##` headings group them), so Obsidian
  // renders the same page as images with captions. Geometry is gone entirely —
  // a reference wall is about the pictures, not their coordinates.
  function renderInspoBody() {
    const I = window.SB_INSPO;
    if (!I) return renderDefaultBody();          // bridge too old — degrade, don't break
    const model = I.parse(page.body || '');
    let activeTag = null;
    let editing = false;   // the wall opens in view mode; see card()
    let gallery = [];      // the visible image items, in render order — the lightbox walks this
    let dragging = null;   // {item, from} while a card is being dragged between groups

    const wrap = h('div', { className: 'page-body inspo-bento' });
    const toolbar = h('div', { className: 'bento-toolbar' });
    const gridWrap = h('div', { className: 'bento-groups' });
    wrap.append(toolbar, gridWrap);

    function save() {
      page.body = I.serialize(model);
      queueSave();
    }

    function allGroupNames() {
      return model.groups.map((g) => g.name);
    }

    /* ── The three ways in ─────────────────────────────────────────────
       Adding is NOT a mode. It used to be: to put an image on the wall you
       had to discover that "Arrange" existed, click it, and find "+ image"
       in a toolbar that had just changed shape. The most common thing done
       to an inspiration wall is adding to it, so it works from anywhere —
       the buttons, a paste, or files dropped straight onto the wall.
       Arrange keeps what belongs to arranging: fields, groups, moving,
       removing. */
    async function addImageFiles(files) {
      const imgs = [...(files || [])].filter((f) => /^image\//.test(f.type || ''));
      if (!imgs.length) return;
      let added = 0;
      for (const f of imgs) {
        try {
          const { path } = await uploadAsset(f);
          model.groups[0].items.unshift({ image: path, caption: '', tags: [], url: null });
          added++;
        } catch (e) { toast('Upload failed — ' + e.message, { tone: 'error' }); }
      }
      if (!added) return;
      save(); paint();
      toast(nOf(added, 'image') + ' added to the wall');
    }

    function addLink(url) {
      model.groups[0].items.unshift({ image: null, caption: '', tags: [], url });
      save(); paint();
      toast('Link added to the wall');
    }

    // Paste, anywhere on the page: an image from the clipboard becomes a
    // card, a bare URL becomes a link card. Never while typing in a field,
    // and never under an open dialog — both would hijack an ordinary paste.
    const onPaste = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('.modal-bg')) return;
      const files = [...((e.clipboardData && e.clipboardData.files) || [])]
        .filter((f) => /^image\//.test(f.type || ''));
      if (files.length) { e.preventDefault(); addImageFiles(files); return; }
      const text = ((e.clipboardData && e.clipboardData.getData('text')) || '').trim();
      if (/^https?:\/\/\S+$/.test(text)) { e.preventDefault(); addLink(text); }
    };
    document.addEventListener('paste', onPaste);
    onBodyTeardown(() => document.removeEventListener('paste', onPaste));

    /* Drop onto the wall. Two kinds of drop, because inspiration arrives two
       ways: a file off the desktop, and a picture dragged straight out of
       another browser tab.

       The second one does NOT arrive as a file — it arrives as a URL (and
       usually an `<img>` fragment beside it), which is why dragging something
       off Dribbble used to land on the wall and do nothing at all. It cannot
       become a local image either: downloading it would mean `fetch()` to a
       third-party origin, which this app does not do — that is the clipper's
       job, and the clipper runs inside the page where the image already is.
       So it becomes a link card pointing at the picture, which is honest
       about what was actually saved. */
    const urlFromDrop = (dt) => {
      if (!dt) return null;
      const uri = (dt.getData('text/uri-list') || '').split('\n')
        .map((s) => s.trim()).find((s) => s && !s.startsWith('#'));
      if (uri && /^https?:\/\//i.test(uri)) return uri;
      // Dragged from a page: the HTML fragment carries the image's own src,
      // which is a better target than the page it was sitting on.
      const html = dt.getData('text/html') || '';
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m && /^https?:\/\//i.test(m[1])) return m[1];
      const text = (dt.getData('text/plain') || '').trim();
      return /^https?:\/\/\S+$/.test(text) ? text : null;
    };

    wrap.addEventListener('dragover', (e) => {
      if (dragging) return;                    // a card being regrouped, not an import
      const dt = e.dataTransfer;
      const items = [...((dt && dt.items) || [])];
      const hasFile = items.some((i) => i.kind === 'file');
      const hasUrl = items.some((i) => i.type === 'text/uri-list' || i.type === 'text/html'
        || i.type === 'text/plain');
      if (!hasFile && !hasUrl) return;
      e.preventDefault();
      wrap.classList.add('is-drop');
    });
    wrap.addEventListener('dragleave', (e) => {
      if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('is-drop');
    });
    wrap.addEventListener('drop', (e) => {
      if (dragging) return;                    // the group's own handler owns this
      e.preventDefault();
      wrap.classList.remove('is-drop');
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])]
        .filter((f) => /^image\//.test(f.type || ''));
      if (files.length) { addImageFiles(files); return; }
      const url = urlFromDrop(e.dataTransfer);
      if (url) addLink(url);
    });

    function renderToolbar() {
      clear(toolbar);
      // Tag filter strip — every tag on the page; click to filter, click again
      // to clear.
      /* This is a FILTER, not a list of tags — but it rendered as lime
         chips directly below the page's own lime tag chips, so the screen
         opened with two near-identical rows and no clue that one of them
         did something. Toggle-shaped, labelled, and only when there is
         enough on the wall for filtering to be worth the row. */
      const tags = I.tags(model);
      const itemCount = model.groups.reduce((n, g) => n + g.items.length, 0);
      if (tags.length > 1 && itemCount > 3) {
        toolbar.appendChild(h('div', { className: 'bento-tagstrip' },
          h('span', { className: 'bento-filter-l' }, icon('search'), 'Filter'),
          tags.map((t) => h('button', {
            className: 'bento-tag' + (activeTag === t ? ' on' : ''),
            'aria-pressed': String(activeTag === t),
            onClick: () => { activeTag = activeTag === t ? null : t; paint(); },
          }, t)),
          activeTag ? h('button', {
            className: 'bento-tag bento-tag-clear',
            onClick: () => { activeTag = null; paint(); },
          }, icon('x'), 'Clear') : null));
      }
      const actions = h('div', { className: 'bento-actions' });

      const fileIn = h('input', {
        type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' },
        'aria-hidden': 'true', tabIndex: -1,
      });
      fileIn.addEventListener('change', () => { addImageFiles(fileIn.files); fileIn.value = ''; });
      actions.appendChild(fileIn);
      actions.appendChild(h('button', {
        className: 'btn-secondary', onClick: () => fileIn.click(),
      }, icon('plus'), 'Image'));
      actions.appendChild(h('button', {
        className: 'btn-secondary',
        onClick: () => {
          // Inline, not prompt() — an OS dialog in the middle of a themed app.
          const inp = h('input', {
            className: 'set-input bento-newgroup', placeholder: 'Paste a URL…',
            autocomplete: 'off',
          });
          const commit = () => {
            let v = (inp.value || '').trim();
            if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
            if (/^https?:\/\/\S+$/.test(v)) { addLink(v); return; }
            paint();
          };
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); paint(); }
          });
          inp.addEventListener('blur', commit);
          actions.replaceChildren(inp);
          inp.focus();
        },
      }, icon('link-2'), 'Link'));

      /* The mode switch. Arranging — fields, groups, moving, removing — is
         a deliberate state; adding is not (see above). */
      actions.appendChild(h('button', {
        className: 'btn bento-mode' + (editing ? ' on' : ''),
        title: editing ? 'Finish arranging' : 'Rearrange, retag, regroup, remove',
        onClick: () => { editing = !editing; paint(); },
      }, icon(editing ? 'check' : 'pen-line'), editing ? 'Done' : 'Arrange'));

      if (!editing) { toolbar.appendChild(actions); return; }

      actions.appendChild(h('button', {
        className: 'btn-secondary',
        onClick: () => {
          const name = h('input', { className: 'set-input bento-newgroup',
            placeholder: 'Group name', autocomplete: 'off' });
          const commit = () => {
            const v = (name.value || '').trim();
            if (v) { model.groups.push({ name: v, items: [] }); save(); }
            paint();
          };
          name.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); paint(); }
          });
          name.addEventListener('blur', commit);
          actions.replaceChildren(name);
          name.focus();
        } }, icon('plus'), 'Group'));

      // One-click migration for boards made under the old canvas model. An
      // explicit button, not an adoption-write: nothing touches the file until
      // the user asks.
      const canvasItems = (page.meta && Array.isArray(page.meta.layout)) ? page.meta.layout : [];
      const already = model.groups.some((g) => g.items.length);
      if (canvasItems.length && !already) {
        actions.appendChild(h('button', {
          className: 'btn-primary',
          onClick: () => {
            model.groups[0].items.push(...I.fromCanvas(canvasItems));
            save(); paint();
          } }, `import ${canvasItems.length} items from the old board`));
      }
      toolbar.appendChild(actions);
    }

    /* ── The expanded card ─────────────────────────────────────────────
       Opening an item used to drop the whole app into a black theatre: the
       picture on a dark scrim, its caption printed underneath as a label,
       and nothing editable. It was a slideshow. But the reason to open an
       item is almost never "look at this bigger" on its own — it is to
       read what you wrote about it, and to fix or add to it while you are
       looking at the picture.

       So this is the card, larger, on the app's own paper: the image at the
       size it deserves on the left, and on the right the SAME controls the
       card has — caption, note, tags, source — not read-only copies of
       them. Nothing you can do on the wall becomes impossible here, and
       nothing here is a different gesture than it is out there.

       ← → still walk the wall, Esc still closes, focus still returns to the
       card that opened it (asDialog owns that). */
    function openLightbox(item) {
      let idx = Math.max(0, gallery.indexOf(item));
      const stage = h('div', { className: 'xp-stage' });
      const side = h('div', { className: 'xp-side' });
      const close = () => {
        document.removeEventListener('keydown', onKey, true);
        document.querySelectorAll('.pk-pop').forEach((n) => n.__close && n.__close());
        bg.remove();
        paint();                 // the wall reflects whatever was edited in here
      };
      const onKey = (e) => {
        // Not while typing, and not while the picker owns the keyboard.
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (document.querySelector('.pk-pop')) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); show(idx - 1); }
      };

      function show(n) {
        idx = (n + gallery.length) % gallery.length;
        const it = gallery[idx];
        const owner = model.groups.find((g) => g.items.includes(it)) || model.groups[0];

        clear(stage);
        stage.appendChild(vaultImage(it.image, { alt: it.caption || '', className: 'xp-img' }));

        clear(side);

        // ── Caption ──────────────────────────────────────────────────
        side.appendChild(h('div', { className: 'xp-l' }, 'Caption'));
        side.appendChild(h('input', {
          className: 'xp-cap', value: it.caption || '', placeholder: 'What is this?',
          onInput: (e) => { it.caption = e.target.value; save(); },
        }));

        // ── Note ─────────────────────────────────────────────────────
        side.appendChild(h('div', { className: 'xp-l' }, 'Why it works'));
        const note = h('textarea', {
          className: 'xp-note', value: it.note || '',
          placeholder: 'Why it works · the rule · when to reach for it…\n[[Link]] another page.',
          onInput: (e) => {
            it.note = e.target.value; save();
            e.target.style.height = 'auto';
            e.target.style.height = Math.max(96, e.target.scrollHeight) + 'px';
          },
        });
        side.appendChild(note);
        setTimeout(() => { note.style.height = 'auto'; note.style.height = Math.max(96, note.scrollHeight) + 'px'; }, 0);

        // ── Tags: the same chips and the same picker as the card ─────
        side.appendChild(h('div', { className: 'xp-l' }, 'Tags'));
        const tags = h('div', { className: 'xp-tags' });
        const addBtn = h('button', {
          className: 'chip-add', title: 'Add a tag',
          onClick: (e) => {
            e.stopPropagation();
            openPicker(addBtn, {
              placeholder: 'Find or create a tag…',
              hint: '↑↓ to choose · ⏎ to add · esc to close',
              search: async (q) => {
                const on = new Set((it.tags || []).map((t) => t.toLowerCase()));
                const needle = String(q || '').toLowerCase();
                let vault = [];
                try { vault = (SB.data().tags().tags || []).map((t) => t.tag); } catch (_) {}
                const wall = I.tags(model);
                const seen = new Set();
                return [...wall, ...vault].filter((t) => {
                  const k = t.toLowerCase();
                  if (on.has(k) || seen.has(k) || !k.includes(needle)) return false;
                  seen.add(k); return true;
                }).slice(0, 40).map((t) => ({ key: t, label: t, swatch: tagHue(t),
                  hint: wall.includes(t) ? 'on this wall' : null }));
              },
              onPick: (row) => { pushTag(it, row.key); paintTags(); },
              onCreate: (text) => { pushTag(it, text); paintTags(); },
              createLabel: (t) => 'Create #' + String(t).replace(/^#/, '').toLowerCase(),
            });
          },
        }, icon('plus'), h('span', { className: 'chip-add-l' }, 'Tag'));
        function paintTags() {
          clear(tags);
          (it.tags || []).forEach((t) => {
            tags.appendChild(TagChip(t, {
              on: activeTag === t,
              onClick: () => { activeTag = activeTag === t ? null : t; close(); },
              onRemove: () => {
                it.tags = (it.tags || []).filter((x) => x !== t);
                save(); renderToolbar(); paintTags();
              },
            }));
          });
          tags.appendChild(addBtn);
        }
        paintTags();
        side.appendChild(tags);

        // ── Source, group, and the image's own file ──────────────────
        side.appendChild(h('div', { className: 'xp-l' }, 'Source'));
        side.appendChild(h('input', {
          className: 'xp-url', value: it.url || '', placeholder: 'https://…',
          onChange: (e) => { it.url = e.target.value.trim() || null; save(); },
        }));
        if (it.url) {
          side.appendChild(h('a', { className: 'xp-open', href: it.url,
            target: '_blank', rel: 'noopener noreferrer' },
            icon('link-2'), it.url.replace(/^https?:\/\//, '').slice(0, 46)));
        }

        side.appendChild(h('div', { className: 'xp-l' }, 'Group'));
        const sel = h('select', { className: 'set-input xp-group' },
          model.groups.map((g) => h('option', {
            value: g.name, selected: g === owner ? 'selected' : undefined,
          }, g.name || '(ungrouped)')));
        sel.addEventListener('change', () => {
          const to = model.groups.find((g) => g.name === sel.value);
          if (!to || to === owner) return;
          owner.items.splice(owner.items.indexOf(it), 1);
          to.items.unshift(it);
          save();
        });
        side.appendChild(sel);

        clear(counter);
        if (gallery.length > 1) {
          counter.appendChild(document.createTextNode((idx + 1) + ' / ' + gallery.length));
        }
      }

      function pushTag(it, raw) {
        const fresh = String(raw || '').split(/[,\s]+/)
          .map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
        if (!fresh.length) return;
        it.tags = [...new Set([...(it.tags || []), ...fresh])];
        save(); renderToolbar();
      }

      const counter = h('span', { className: 'xp-count' });
      const bg = h('div', {
        className: 'modal-bg xp-bg',
        onClick: (e) => { if (e.target === bg) close(); },
      },
        h('div', { className: 'xp-frame' },
          h('div', { className: 'xp-hd' },
            counter,
            gallery.length > 1 ? h('div', { className: 'xp-steps' },
              h('button', { className: 'xp-step', 'aria-label': 'Previous',
                onClick: () => show(idx - 1) }, icon('chevron-left')),
              h('button', { className: 'xp-step', 'aria-label': 'Next',
                onClick: () => show(idx + 1) }, icon('chevron-right'))) : null,
            h('button', { className: 'xp-x', 'aria-label': 'Close', title: 'Close (esc)',
              onClick: close }, icon('x'))),
          h('div', { className: 'xp-body' }, stage, side)));
      show(idx);
      document.body.appendChild(bg);
      document.addEventListener('keydown', onKey, true);
      asDialog(bg, { onEscape: close, label: 'Expanded card' });
    }

    /* A wall has two states, and it used to only have one.

       Every tile carried a caption input, a #tags input, a source-url input,
       a group <select> and a remove × — permanently, on every card. A page
       whose entire job is looking at images rendered as a column of forms,
       and the images were the smallest thing on it.

       View is now the default: image, caption, tags. Edit is a deliberate
       switch, and the fields only exist then. The caption stays inline-
       editable on click in view mode, because retyping a caption is the one
       edit frequent enough that a mode switch would be a tax. */
    function card(item, group) {
      const el = h('div', { className: 'bento-card' });

      /* ── Grouping by dragging ──────────────────────────────────────
         Moving a card used to mean: switch to Arrange, find the card's
         group <select>, open it, pick a name. Four actions to express
         "this belongs over there", and it is the single most common thing
         done to a wall after adding to it — grouping IS the thinking.

         So the card is draggable in both states, and a group is a drop
         target. The <select> stays for keyboards and for precision. */
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        dragging = { item, from: group };
        el.classList.add('is-dragging');
        // Text too, so a card can also be dragged out to another app.
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.url || item.caption || '');
        } catch (_) {}
      });
      el.addEventListener('dragend', () => {
        dragging = null;
        el.classList.remove('is-dragging');
        gridWrap.querySelectorAll('.is-dropzone').forEach((n) => n.classList.remove('is-dropzone'));
      });

      if (item.image) {
        el.appendChild(!editing
          ? h('div', {
              className: 'bento-imgbox bento-imgbox-zoom',
              'aria-label': 'View larger',
              onClick: () => openLightbox(item),
            }, vaultImage(item.image))
          : h('div', { className: 'bento-imgbox' }, vaultImage(item.image)));
      } else if (item.url) {
        const domain = (item.url.replace(/^https?:\/\//, '').split('/')[0] || '').slice(0, 40);
        el.appendChild(h('a', {
          className: 'bento-linkface', href: item.url, target: '_blank', rel: 'noopener',
        }, icon('link-2'), domain || 'link'));
      } else {
        el.appendChild(h('div', { className: 'bento-imgbox bento-imgbox-empty' },
          h('span', null, 'No image yet')));
      }

      if (!editing) {
        /* ── View ──────────────────────────────────────────────────────
           One card, two zones: the image full-bleed on top, and below it a
           BODY that owns the padding. The caption, tags and source used to
           hang directly off the card with top-padding only, so text sat
           flush against the left border and the tags against the bottom
           edge — each card read as an image with debris under it rather
           than as one built thing. A card with nothing to say below the
           image gets no body at all, so a pure image stays a pure image. */
        const cap = h('div', {
          className: 'bento-cap-view' + (item.caption ? '' : ' is-empty'),
          title: 'Click to edit the caption',
          onClick: (e) => {
            // A link in the caption is a link first. Without this, following
            // a citation would instead open the caption for editing.
            if (e.target.closest && e.target.closest('a, .mention-link, .mention-chip, .hashtag')) return;
            e.stopPropagation();
            const inp = h('input', {
              className: 'bento-cap', value: item.caption || '', placeholder: 'Caption…',
              onInput: (ev) => { item.caption = ev.target.value; save(); },
              onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') ev.target.blur(); },
            });
            inp.addEventListener('blur', () => paint());
            cap.replaceWith(inp);
            inp.focus(); inp.select();
          },
        });
        /* The caption is rendered too, so a `[[wikilink]]` written into one
           is followable rather than four literal brackets. Plain text takes
           the fast path — most captions are three words. */
        if (item.caption && /\[\[|#\w|https?:\/\//.test(item.caption)) {
          try {
            const rc = h('div', { html: SB.data().renderHtml(item.caption).html });
            decorateMentions(rc); decorateHashtags(rc);
            cap.appendChild(rc);
          } catch (_) { cap.appendChild(document.createTextNode(item.caption)); }
        } else {
          cap.appendChild(document.createTextNode(item.caption || 'Add a caption'));
        }

        const body = h('div', { className: 'bento-body' }, cap);

        /* ── The note ──────────────────────────────────────────────────
           A caption says what a thing is. The note says why it is on the
           wall and when to reach for it — the part you cannot rebuild from
           the picture six months later, and the reason this page is worth
           keeping rather than a folder of screenshots.

           Rendered, not raw: `[[Other Wall]]` becomes a link you can follow,
           so one wall cites another through the mention graph the vault
           already keeps. Click anywhere else in it to edit. */
        const noteEl = h('div', {
          className: 'bento-note' + (item.note ? '' : ' is-empty'),
          title: item.note ? 'Click to edit' : 'Why it works · the rule · when to use it',
          onClick: (e) => {
            if (e.target.closest && e.target.closest('a, .mention-link, .mention-chip, .hashtag')) return;
            e.stopPropagation();
            const ta = h('textarea', {
              className: 'bento-note-ta', value: item.note || '',
              placeholder: 'Why it works · the rule · when to reach for it…\n[[Link]] another page.',
              onInput: (ev) => {
                item.note = ev.target.value; save();
                ev.target.style.height = 'auto';
                ev.target.style.height = ev.target.scrollHeight + 'px';
              },
              onKeyDown: (ev) => { if (ev.key === 'Escape') ev.target.blur(); },
            });
            ta.addEventListener('blur', () => paint());
            noteEl.replaceWith(ta);
            ta.style.height = 'auto'; ta.style.height = Math.max(54, ta.scrollHeight) + 'px';
            ta.focus();
            const n = ta.value.length;
            try { ta.setSelectionRange(n, n); } catch (_) {}
          },
        });
        if (item.note) {
          try {
            const r = SB.data().renderHtml(item.note);
            const rendered = h('div', { html: r.html });
            decorateMentions(rendered);
            decorateHashtags(rendered);
            noteEl.appendChild(rendered);
          } catch (_) { noteEl.appendChild(document.createTextNode(item.note)); }
        } else {
          noteEl.appendChild(h('span', { className: 'bento-note-add' },
            icon('pen-line'), 'Why this?'));
        }
        body.appendChild(noteEl);

        /* ── Tags, editable where you look at them ─────────────────────
           Tags were readable here and editable only in Arrange: the footer
           was skipped entirely when an item had none, so a fresh card — the
           one you have just added and most want to file — showed no way to
           tag it at all. Tagging is how the wall stays findable, so it is
           not behind a mode.

           A chip does two things and says which: the name filters the wall,
           the × removes the tag. */
        const tagsRow = h('div', { className: 'bento-tags-view' });

        const addTag = (raw) => {
          const fresh = String(raw || '').split(/[,\s]+/)
            .map((t) => t.replace(/^#/, '').trim().toLowerCase())
            .filter(Boolean);
          if (!fresh.length) return false;
          item.tags = [...new Set([...(item.tags || []), ...fresh])];
          save(); renderToolbar();          // the filter strip gains the new tag
          return true;
        };

        /* The same picker the page header uses. It used to be a bare
           `<input list=…>`: a native datalist, with the browser's own
           dropdown, no create affordance and no keyboard contract shared
           with anywhere else in the app. */
        const addBtn = h('button', {
          className: 'bento-tag-add', title: 'Add a tag', 'aria-label': 'Add a tag',
          onClick: (e) => {
            e.stopPropagation();
            openPicker(addBtn, {
              placeholder: 'Find or create a tag…',
              hint: '↑↓ to choose · ⏎ to add · esc to close',
              // The wall's own vocabulary first: it is what you almost always
              // want, and a near-miss typed by hand is how tag sets fragment.
              search: wallTagRows(() => item.tags || []),
              onPick: (row) => { addTag(row.key); paintTags(); },
              onCreate: (text) => { addTag(text); paintTags(); },
              createLabel: (t) => 'Create #' + String(t).replace(/^#/, '').toLowerCase(),
            });
          },
        }, icon('plus'), (item.tags || []).length ? '' : 'tag');

        /** Wall tags before vault tags, both filtered by what is already on. */
        function wallTagRows(current) {
          return async (q) => {
            const on = new Set((current() || []).map((t) => t.toLowerCase()));
            const needle = String(q || '').toLowerCase();
            let vault = [];
            try { vault = (SB.data().tags().tags || []).map((t) => t.tag); } catch (_) {}
            const wall = I.tags(model);
            const seen = new Set();
            return [...wall, ...vault]
              .filter((t) => {
                const k = t.toLowerCase();
                if (on.has(k) || seen.has(k) || !k.includes(needle)) return false;
                seen.add(k); return true;
              })
              .slice(0, 40)
              .map((t) => ({ key: t, label: t, swatch: tagHue(t),
                             hint: wall.includes(t) ? 'on this wall' : null }));
          };
        }

        function paintTags() {
          clear(tagsRow);
          (item.tags || []).forEach((t) => {
            tagsRow.appendChild(TagChip(t, {
              on: activeTag === t,
              onClick: (e) => { e.stopPropagation(); activeTag = activeTag === t ? null : t; paint(); },
              onRemove: (e) => {
                e.stopPropagation();
                item.tags = (item.tags || []).filter((x) => x !== t);
                save(); renderToolbar(); paintTags();
              },
            }));
          });
          tagsRow.appendChild(addBtn);
          clear(addBtn);
          addBtn.appendChild(icon('plus'));
          if (!(item.tags || []).length) addBtn.appendChild(document.createTextNode('tag'));
        }
        paintTags();

        // Always present now: it carries the add affordance, not just chips.
        body.appendChild(h('div', { className: 'bento-body-ft' },
          tagsRow,
          (item.url && item.image)
            ? h('a', {
                className: 'bento-src', href: item.url, target: '_blank', rel: 'noopener',
                title: item.url,
                onClick: (e) => e.stopPropagation(),
              }, icon('link-2'), 'Source')
            : null));
        el.appendChild(body);
        return el;
      }

      // ── Edit ────────────────────────────────────────────────────────
      const capIn = h('input', {
        className: 'bento-cap', placeholder: 'Caption…', value: item.caption || '',
        onInput: (e) => { item.caption = e.target.value; save(); },
      });
      const tagIn = h('input', {
        className: 'bento-tags-in', placeholder: '#tags',
        value: (item.tags || []).map((t) => '#' + t).join(' '),
        /* Kept as a raw text field ON PURPOSE, and only here. Arrange is the
           bulk-editing mode: retyping a whole tag line, or pasting one across
           several cards, is faster than opening a panel per tag. The picker
           is the way in everywhere a single tag is added — this is the escape
           hatch beside it, not a fourth idiom. */
        onChange: (e) => {
          item.tags = [...new Set(e.target.value.split(/\s+/)
            .map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
          save(); renderToolbar();
        },
      });
      const noteIn = h('textarea', {
        className: 'bento-note-in', rows: 2,
        placeholder: 'Why it works · the rule · when to reach for it…',
        value: item.note || '',
        onInput: (e) => { item.note = e.target.value; save(); },
      });
      const urlIn = h('input', {
        className: 'bento-url-in', placeholder: 'Source URL…', value: item.url || '',
        onChange: (e) => { item.url = e.target.value.trim() || null; save(); },
      });
      const sel = h('select', { className: 'bento-group-sel', title: 'Move to group' },
        allGroupNames().map((n) => h('option', {
          value: n, selected: n === group.name ? 'selected' : undefined,
        }, n || '(ungrouped)')));
      sel.addEventListener('change', () => {
        const to = model.groups.find((g) => g.name === sel.value);
        if (!to || to === group) return;
        group.items.splice(group.items.indexOf(item), 1);
        to.items.unshift(item);
        save(); paint();
      });
      const del = h('button', {
        className: 'bento-del', title: 'Remove this item',
        onClick: () => {
          const removed = item;
          const idx = group.items.indexOf(item);
          group.items.splice(idx, 1);
          save(); paint();
          toast('Item removed', { actionLabel: 'Undo', onAction: () => {
            group.items.splice(idx, 0, removed); save(); paint();
          } });
        } }, icon('trash-2'));
      el.appendChild(h('div', { className: 'bento-fields' }, capIn, noteIn, tagIn, urlIn,
        h('div', { className: 'bento-row' }, sel, del)));
      return el;
    }

    function paint() {
      renderToolbar();
      clear(gridWrap);
      gallery = [];
      for (const g of model.groups) {
        const visible = g.items.filter((it) => !activeTag || (it.tags || []).includes(activeTag));
        gallery.push(...visible.filter((it) => it.image));
        /* An empty unnamed group is hidden — but not while a card is in the
           air. "Ungrouped" has to be reachable as a destination, or a card
           dragged into a group can never come back out of it. */
        if (!g.items.length && !g.name && !dragging) continue;
        const sec = h('section', { className: 'bento-group' });
        // Every group accepts a dropped card, including the one it came from
        // (a no-op, which is the right outcome for a drag you thought better of).
        sec.addEventListener('dragover', (e) => {
          if (!dragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          sec.classList.add('is-dropzone');
        });
        sec.addEventListener('dragleave', (e) => {
          if (!sec.contains(e.relatedTarget)) sec.classList.remove('is-dropzone');
        });
        sec.addEventListener('drop', (e) => {
          if (!dragging) return;
          e.preventDefault();
          e.stopPropagation();          // the wall's file-drop handler is not this
          sec.classList.remove('is-dropzone');
          const { item: moved, from } = dragging;
          dragging = null;
          if (from === g) { paint(); return; }
          const at = from.items.indexOf(moved);
          if (at < 0) { paint(); return; }
          from.items.splice(at, 1);
          g.items.unshift(moved);
          save(); paint();
          toast('Moved to ' + (g.name || 'ungrouped'), {
            actionLabel: 'Undo',
            onAction: () => {
              const back = g.items.indexOf(moved);
              if (back >= 0) g.items.splice(back, 1);
              from.items.splice(at, 0, moved);
              save(); paint();
            },
          });
        });
        if (g.name) sec.appendChild(h('h3', { className: 'bento-group-h' }, g.name,
          h('span', { className: 'bento-group-n' }, ' ' + visible.length)));
        if (visible.length) {
          sec.appendChild(h('div', { className: 'bento-grid' },
            visible.map((it) => card(it, g))));
        } else {
          sec.appendChild(h('div', { className: 'bento-empty' },
            activeTag ? 'nothing tagged #' + activeTag : 'empty — add an image or a link'));
        }
        gridWrap.appendChild(sec);
      }
      if (!model.groups.some((g) => g.items.length)) {
        /* The empty wall teaches the ways in, because all three are
           invisible: nothing about an empty page says it accepts a drop or
           a paste. */
        gridWrap.appendChild(h('div', { className: 'bento-dropzone' },
          h('span', { className: 'bento-dropzone-g' }, icon('image')),
          h('div', { className: 'bento-dropzone-t' }, 'Drop images here'),
          h('div', { className: 'bento-dropzone-d' },
            'Or paste one from the clipboard, paste a URL, or use ',
            h('b', null, '+ Image'), ' and ', h('b', null, '+ Link'), ' above. ',
            'The clipper sends things here too, straight from any page.')));
      }
    }

    paint();
    return wrap;
  }

  function renderSnippetBody() {
    return h('div', { className: 'page-body snippet-body' },
      ProseEditor({
        getValue: () => page.body,
        setValue: (v) => { page.body = v; queueSave(); }, onDone: flushSave,
        placeholder: 'A quick thought…',
        minHeight: 160,
      }));
  }

  function renderMarkdownBody() {
    if (!page.meta) page.meta = {};
    /* The note body. Two things changed here.

       It used to print a frontmatter block above the prose — id, kind, tags,
       url — so the first thing you saw on your own note was
       `id 01KVWR…`. Those facts are in the Metadata rail three inches to the
       right, and in the chips row above. Three copies of the same machine
       text, one of them ahead of the writing. The rail keeps them; this
       doesn't.

       And it had its own view/edit toggle labelled `✎ edit` / `✓ done`, one
       of three such toggles in the app. It uses the shared one now. */
    return h('div', { className: 'page-body md-body' },
      ProseEditor({
        getValue: () => page.body,
        setValue: (v) => { page.body = v; queueSave(); }, onDone: flushSave,
        placeholder: 'Write…\n\n## Section headers\n- Bullet lists\n> A quote\n\n[[Wikilinks]] resolve and #tags stick.',
        minHeight: 420,
      }));
  }

  function renderBookmarkBody() {
    if (!page.meta) page.meta = {};
    // Migrate legacy {url, og} → {links: [{url, og}]}. Keep meta.url in sync
    // with links[0].url so older readers (frontmatter export, etc.) still work.
    if (!Array.isArray(page.meta.links)) {
      page.meta.links = page.meta.url
        ? [{ url: page.meta.url, og: page.meta.og || null }]
        : [];
    }
    const wrap = h('div', { className: 'page-body bookmark-body' });
    const linksWrap = h('div', { className: 'bm-links' });

    function syncLegacy() {
      page.meta.url = page.meta.links.length ? page.meta.links[0].url : '';
      page.meta.og = page.meta.links.length ? page.meta.links[0].og : null;
    }

    function renderPreview(box, og) {
      clear(box);
      if (!og) return;
      if (og.error) {
        box.appendChild(h('div', { className: 'bm-preview-err' }, '✗ ', og.error));
        return;
      }
      if (og.image) box.appendChild(h('img', {
        className: 'bm-preview-img', src: og.image, loading: 'lazy', alt: '',
      }));
      const content = h('div', { className: 'bm-preview-content' });
      content.appendChild(h('a', {
        className: 'bm-preview-title', href: og.final_url || og.url, target: '_blank',
      }, og.title || og.url));
      if (og.description) {
        content.appendChild(h('div', { className: 'bm-preview-desc' }, og.description));
      }
      content.appendChild(h('div', { className: 'bm-preview-site' },
        og.site_name || '', og.site_name && og.final_url ? ' · ' : '',
        og.final_url ? og.final_url.replace(/^https?:\/\//, '').slice(0, 60) : ''));
      box.appendChild(content);
    }

    /* A pasted address is usually a whole URL, but people also type
       `stripe.com/docs`. Assume https rather than refusing — every other
       address bar does. */
    const withScheme = (s) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s);

    /* The link, spelled the way a person reads it: the site in full strength,
       the path after it in a quieter tone, no `https://www.` in front of
       either. The href keeps every character; only the label is shortened. */
    function prettyUrl(raw) {
      try {
        const u = new URL(raw);
        const host = u.hostname.replace(/^www\./i, '');
        let rest = (u.pathname === '/' ? '' : u.pathname) + (u.search || '');
        rest = decodeURI(rest).replace(/\/$/, '');
        return { host, rest };
      } catch (_) { return { host: raw, rest: '' }; }
    }

    /* Which row is being typed into, held as the LINK ITSELF rather than its
       index. Rows are removed while another is being edited — blur, ×, and
       the add button all reorder the array — and an index captured in a
       closure quietly starts pointing at the wrong link the moment that
       happens. An object reference cannot drift. */
    let editing = null;

    const dropBlanks = () => {
      page.meta.links = page.meta.links.filter((l) => l.url || l === editing);
    };

    function commitLink(link, raw) {
      const v = String(raw || '').trim();
      // An empty commit removes the row. A blank link card is not a link, and
      // leaving one behind is what made "add link" feel like it did nothing.
      if (!v) {
        const at = page.meta.links.indexOf(link);
        if (at >= 0) page.meta.links.splice(at, 1);
      } else {
        const next = withScheme(v);
        /* The og was read off the page at the OLD address, so a retyped url
           leaves a preview card describing something this row no longer
           points at. `updatePage` drops the og_* keys for the same reason on
           save; doing it here too means the card goes the moment the address
           does, instead of surviving on screen until the next reload. */
        if (next !== link.url) link.og = null;
        link.url = next;
      }
      editing = null;
      syncLegacy(); queueSave(); renderLinks();
    }

    function linkEditor(link) {
      const input = h('input', {
        className: 'bm-link-input',
        placeholder: 'Paste or type a link…',
        value: link.url || '',
        onKeyDown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitLink(link, e.target.value); }
          if (e.key === 'Escape') { e.preventDefault(); commitLink(link, link.url || ''); }
        },
        /* Paste IS the commit. The clipboard already holds the finished
           address, so asking for an Enter afterwards is asking the user to
           confirm something they just did. */
        onPaste: (e) => {
          const text = (e.clipboardData || window.clipboardData).getData('text');
          const first = (String(text).match(/\S+/) || [''])[0];
          if (!first) return;
          e.preventDefault();
          commitLink(link, first);
        },
        /* Deferred, so a click on another row's × or on "add link" lands
           before this re-renders the list out from under it. Committing on
           blur synchronously destroys the button you were reaching for. */
        onBlur: (e) => {
          const v = e.target.value;
          setTimeout(() => { if (editing === link) commitLink(link, v); }, 0);
        },
      });
      return h('div', { className: 'bm-link bm-link-editing' }, input);
    }

    function linkRow(link, idx) {
      const { host, rest } = prettyUrl(link.url);
      const row = h('div', { className: 'bm-link' });
      /* The link itself is the control. A separate "Open" button beside a
         link is a second way to do the thing the link already does, and it
         is the one that made these rows feel like forms. */
      row.appendChild(h('a', {
        className: 'bm-link-a', href: link.url,
        target: '_blank', rel: 'noopener noreferrer',
        title: link.url,
      },
        h('span', { className: 'bm-link-g' }, icon('link-2')),
        h('span', { className: 'bm-link-host' }, host),
        rest ? h('span', { className: 'bm-link-rest' }, rest) : null));
      row.appendChild(h('button', {
        className: 'bm-link-act', title: 'Edit this link', 'aria-label': 'Edit this link',
        onClick: () => { dropBlanks(); editing = link; renderLinks(); },
      }, icon('pen-line')));
      row.appendChild(h('button', {
        className: 'bm-link-act bm-link-rm', title: 'Remove this link', 'aria-label': 'Remove this link',
        onClick: () => {
          editing = null;
          const at = page.meta.links.indexOf(link);
          if (at >= 0) page.meta.links.splice(at, 1);
          dropBlanks();
          syncLegacy(); queueSave(); renderLinks();
        },
      }, icon('x')));
      return row;
    }

    function renderLinks() {
      clear(linksWrap);
      page.meta.links.forEach((link, idx) => {
        linksWrap.appendChild(link === editing || !link.url
          ? linkEditor(link)
          : linkRow(link, idx));
        /* The preview machinery is gone. It rendered a box, said "fetching
           preview…", and then failed — fetchLinkPreview() routes through
           gone(), because a browser tab cannot read another origin.

           A saved og payload still renders if the clipper captured one; the
           app simply stops pretending it can go and get one itself. */
        if (link.og && link !== editing) {
          const previewBox = h('div', { className: 'bm-preview' });
          renderPreview(previewBox, link.og);
          linksWrap.appendChild(previewBox);
        }
      });
      linksWrap.appendChild(h('button', {
        className: 'bm-link-add',
        onClick: () => {
          // Straight into a focused field — the button's whole job is to get
          // out of the way of the paste that is about to happen.
          editing = null;
          dropBlanks();
          const fresh = { url: '', og: null };
          page.meta.links.push(fresh);
          editing = fresh;
          renderLinks();
        },
      }, icon('plus'), page.meta.links.length ? 'Add another link' : 'Add link'));

      const input = linksWrap.querySelector('.bm-link-input');
      if (input && editing) { input.focus(); input.select(); }
      if (linkCountEl) linkCountEl.textContent = String(page.meta.links.length);
    }

    /* No placeholder row. A bookmark with no link shows the add button and
       nothing else — an empty card pretending to be a link was the thing
       that had to be cleaned up before you could use the page. */
    const linkCountEl = h('span', null, String(page.meta.links.length));
    renderLinks();

    const linkSection = h('div', { className: 'bm-section bm-section-link' },
      h('div', { className: 'bm-section-l' }, 'Links · ', linkCountEl),
      linksWrap);

    const contextSection = h('div', { className: 'bm-section bm-section-context' },
      ProseEditor({
        label: 'Context',
        getValue: () => page.body,
        setValue: (v) => { page.body = v; queueSave(); }, onDone: flushSave,
        placeholder: 'Why this matters · what to remember · who else cares…',
        minHeight: 180,
      }));

    wrap.appendChild(linkSection);
    wrap.appendChild(contextSection);
    return wrap;
  }

  // ── Project renderer (kind=project) ───────────────────────────────────
  // A project is a container. Its own body is the README. Everything else
  // that mentions this project shows up grouped by kind below.
  function renderProjectBody(projectName) {
    if (!page.meta) page.meta = {};
    const wrap = h('div', { className: 'page-body project-body' });

    /* No status, and no dates.

       They were four controls for two facts, and neither fact ever reached
       the disk. `updatePage` writes `status` out of `patch.status` while the
       editor only ever sent `patch.meta.status`; `start_date` and `end_date`
       are not in its write list at all; and `page(id)` surfaces canvas,
       excalidraw and bookmark keys into `meta` and nothing else — so on
       reload the form was blank again whatever you had typed into it. It has
       never once worked, in either direction.

       Making it work was the other option, and CONVENTION.md decides against
       it: `end_date` is not part of the format, and the convention already
       answers how state is marked — "Native tags are workflow ... tags:
       [draft, current] mark state — status, lifecycle, review marks." A
       project is a folder; the pages inside it carry their own tags. Whatever
       is already in someone's frontmatter stays there, untouched and readable
       in Obsidian. Nothing is lost that was ever gained. */

    /* ── The folder note ─────────────────────────────────────────────────
       A project is a folder. It has no description, no tags and no mentions —
       the things inside it have those, and a container that also wants to be
       a document is why this screen used to read as "a note that happens to
       list some pages".

       But `projects/X/X.md` is a real file that Obsidian and your agent write
       to, and it may well have prose in it. Dropping the editor entirely
       would leave that text on disk and invisible here, which is the one
       thing this app must never do. So it is a single collapsed row rather
       than a card: closed by default, and it says whether there is anything
       inside it before you open it. */
    let noteOpen = false;
    const noteWrap = h('div', { className: 'pj-note' });
    function paintNote() {
      clear(noteWrap);
      const text = String(page.body || '').trim();
      noteWrap.appendChild(h('button', {
        className: 'pj-note-toggle' + (noteOpen ? ' open' : ''),
        'aria-expanded': String(noteOpen),
        onClick: () => { noteOpen = !noteOpen; paintNote(); },
      },
        h('span', { className: 'pj-note-chev' }, icon(noteOpen ? 'chevron-down' : 'chevron-right')),
        h('span', { className: 'pj-note-l' }, 'Folder note'),
        h('span', { className: 'pj-note-h' },
          text ? firstLineOf(plainOf(text), 72) : 'empty')));
      if (noteOpen) {
        noteWrap.appendChild(ProseEditor({
          label: null,
          getValue: () => page.body,
          setValue: (v) => { page.body = v; queueSave(); }, onDone: flushSave,
          placeholder: 'Anything about the folder itself. The pages inside carry their own.',
          minHeight: 180,
        }));
      }
    }
    paintNote();

    // ── Inside this project: grouped grid of pages that mention this id ─
    const insideCard = h('div', { className: 'pj-card pj-inside' });
    const projectId = page.id;
    let insidePages = [];

    async function loadInside() {
      clear(insideCard);
      insideCard.appendChild(h('div', { className: 'pj-card-hd' }, 'Inside this project'));
      insideCard.appendChild(h('div', { className: 'sb-meta' }, 'loading…'));
      try {
        // Folder membership is the primary truth — a project holds its files.
        // Pages that merely *mention* the project are appended after, so the
        // old mention-based members stay reachable rather than vanishing.
        const inFolder = projectName ? SB.data().projectMembers(projectName).items : [];
        const seen = new Set(inFolder.map((p) => p.id));
        const data = await SB.data().pages({ mention: projectId, limit: 500 });
        const mentioned = (data.items || [])
          .filter((p) => p.id !== projectId && !seen.has(p.id));
        insidePages = [...inFolder, ...mentioned];
        renderInside();
      } catch (e) {
        clear(insideCard);
        insideCard.appendChild(h('div', { className: 'pj-card-hd' }, 'Inside this project'));
        insideCard.appendChild(h('div', { className: 'sb-meta' }, '✗ ', String(e.message || e)));
      }
    }

    function pageCard(p) {
      const m = metaForPage(p);
      return h('div', {
        className: 'pj-inside-card',
        style: { '--k-c': m.color || 'var(--muted)' },
        onClick: (e) => {
          if (e.metaKey || e.ctrlKey) { newTab('page', p.id, { switchTo: true }); return; }
          const t = activeTab();
          if (t) { t.parentRoute = 'project:' + projectId; persistTabs(); }
          openPage(p.id);
        },
      },
        h('div', { className: 'pj-inside-card-hd' },
          // `m` already resolved the kind; the glyph must come from it too,
          // or the label says Drawing beside a board icon.
          h('span', { className: 'pj-inside-glyph' }, icon(m.icon || 'file-text')),
          h('span', { className: 'pj-inside-kind' }, m.label || p.kind)),
        h('div', { className: 'pj-inside-title' }, p.title || p.slug || '(untitled)'),
        p.body
          ? h('div', { className: 'pj-inside-snip' }, firstLineOf(p.body, 100))
          : null);
    }

    // Every kind the vault knows, plus a drawing — the whole point of a
    // project is holding them all in one folder.
    const CREATABLE = [...KIND_ORDER];
    const metaForKind = (k) => (k === 'drawing' ? DRAWING_META : (KIND_META[k] || {}));

    async function createInside(k) {
      try {
        const p = await SB.data().createPage({ kind: k, title: '', body: '', project: projectName });
        if (!p || !p.id) throw new Error('no page id came back — ' + JSON.stringify(p).slice(0, 180));
        invalidatePageIndex();
        cacheSetPage(p);
        const t = activeTab();
        if (t) { t.parentRoute = 'project:' + projectId; persistTabs(); }
        openPage(p.id);
      } catch (err) {
        toast('Could not create that — ' + err.message, { tone: 'error' });
      }
    }

    // ── The create picker ───────────────────────────────────────────────
    // Was a strip of six 10px buttons prefixed with unicode glyphs (§ ↗ ¶ ▦
    // ◫ ✎) behind the label "+ create inside this project:". You had to
    // already know what the symbols meant to use it.
    //
    // It is now the same kind-picker the global Create modal uses — icon,
    // name, and the one-line hint that already lives in KIND_META and was
    // previously buried in a `title` tooltip. Learning the vault's five kinds
    // once should be enough; two different pickers for the same choice was
    // most of why this screen felt like a different app.
    //
    // Progressive disclosure: an empty project shows the picker open, because
    // that is the only thing you can usefully do. A project with pages in it
    // shows one button, because the pages are the point.
    let pickerOpen = false;
    function kindPicker() {
      return h('div', { className: 'pj-picker' },
        ...CREATABLE.map((k) => {
          const m = metaForKind(k);
          return h('button', {
            className: 'pj-picker-card',
            style: { '--k-c': m.color },
            onClick: () => createInside(k),
          },
            h('span', { className: 'pj-picker-icon' }, icon(m.icon || 'file-text')),
            h('span', { className: 'pj-picker-l' }, m.label || k),
            h('span', { className: 'pj-picker-h' }, m.hint || ''));
        }));
    }

    function renderInside() {
      clear(insideCard);
      const count = insidePages.length;
      insideCard.appendChild(h('div', { className: 'pj-card-hd' },
        'Inside this project · ', nOf(count, 'page')));

      const addWrap = h('div', { className: 'pj-add' });
      function paintAdd() {
        clear(addWrap);
        if (count === 0 || pickerOpen) {
          if (count > 0) {
            addWrap.appendChild(h('button', {
              className: 'btn pj-add-toggle', onClick: () => { pickerOpen = false; paintAdd(); },
            }, icon('x'), 'Close'));
          }
          addWrap.appendChild(kindPicker());
        } else {
          addWrap.appendChild(h('button', {
            className: 'btn-create pj-add-toggle',
            onClick: () => { pickerOpen = true; paintAdd(); },
          }, icon('plus'), h('span', null, 'New in this project')));
        }
      }
      paintAdd();
      insideCard.appendChild(addWrap);

      if (count === 0) {
        insideCard.appendChild(h('div', { className: 'pj-empty' },
          'Nothing here yet. Pick a kind above and it lands in this project’s folder, already linked. ',
          'To bring an existing page in, open it and add ',
          h('code', null, '[[' + (page.title || projectId) + ']]'),
          ' to its mentions.'));
        return;
      }

      // Group by kind, in KIND_ORDER first (visual order), others after.
      const groups = {};
      insidePages.forEach((p) => { (groups[p.kind] = groups[p.kind] || []).push(p); });
      const orderedKinds = [...KIND_ORDER].filter((k) => groups[k]);
      // Catch any unexpected kinds that aren't in either list.
      Object.keys(groups).forEach((k) => { if (!orderedKinds.includes(k)) orderedKinds.push(k); });

      orderedKinds.forEach((k) => {
        const m = KIND_META[k] || {};
        const section = h('div', { className: 'pj-group' },
          h('div', { className: 'pj-group-hd' },
            h('span', { className: 'pj-group-icon', style: { color: m.color || 'inherit' } },
              kindIcon(k)),
            h('span', null, m.label || k),
            h('span', { className: 'pj-group-ct' }, String(groups[k].length))),
          h('div', { className: 'pj-group-grid' },
            groups[k].map(pageCard)));
        insideCard.appendChild(section);
      });
    }

    loadInside();

    /* Contents, then the folder note. That is the whole page. A folder's
       answer to "what is this" is what is in it, and the old order put a
       220px description editor and a 160px details form in front of it. */
    wrap.appendChild(insideCard);
    wrap.appendChild(noteWrap);
    return wrap;
  }

  // ── Side renderers ────────────────────────────────────────────────────
  function renderTopicSide() {
    const aside = h('aside', { className: 'topic-side' });

    // PARENT (if any)
    const parentId = page.meta && page.meta.parent;
    if (parentId) {
      const row = h('div', { className: 'side-card side-parent' },
        h('div', { className: 'side-card-hd' }, '↑ PARENT'),
        h('div', { className: 'side-card-body' },
          h('button', { className: 'side-link',
            onClick: () => { app.openPageId = parentId; app.route = 'page'; render(); } },
            h('span', { className: 'side-link-title' }, 'loading…'))));
      aside.appendChild(row);
      getPageCached(parentId).then((p) => {
        const t = row.querySelector('.side-link-title');
        if (t) t.textContent = p.title || '(untitled)';
      }).catch(() => {});
    }

    // METADATA
    const sRow = (l, v) => h('div', { className: 'side-row' },
      h('span', { className: 'side-row-l' }, l),
      h('span', { className: 'side-row-v' }, v));
    /* What this rail owes the reader is the facts the page itself does not
       already show.
         · Slug restated the H1 a centimetre above it, word for word.
         · Tags and Mentions counted chips that are listed in the header row,
           so the rail's answer was always visible before you looked.
       Both are gone. In their place, the one fact this app is entirely about
       and did not show anywhere: which file on disk you are looking at. */
    const fileRow = sRow('File', page.path || '—');
    fileRow.className = 'side-row side-row-file';
    fileRow.querySelector('.side-row-v').title = page.path || '';

    /* What a clipping knows about itself. `author`, `og_description` and
       `source` are written by the clipper (and by Obsidian's own web clipper,
       which uses the same three) and were readable in Obsidian's property
       panel but nowhere in this app — so a clipped article showed its words
       and not one fact about where they came from.

       Only when present: a permanent "Author —" on every page written by hand
       is a row that says nothing, five times a screen.

       A bookmark's url already has chrome of its own above this rail, so
       `source` is shown for the pages that have no other way to say it. */
    const fm = (page.frontmatter) || {};
    const ogDesc = fm.og_description
      || (page.meta && page.meta.og && page.meta.og.description) || '';
    const extra = [];
    if (fm.author) extra.push(sRow('Author', String(fm.author)));
    if (ogDesc) {
      const row = sRow('About', String(ogDesc));
      // The one value here that is a sentence rather than a fact, so it wraps
      // instead of ending in an ellipsis three words in.
      row.querySelector('.side-row-v').className = 'side-row-v side-row-wrap';
      row.querySelector('.side-row-v').title = String(ogDesc);
      extra.push(row);
    }
    if (fm.source && !page.url) {
      const row = sRow('Source', '');
      const href = String(fm.source);
      row.querySelector('.side-row-v').appendChild(h('a', {
        href, target: '_blank', rel: 'noopener noreferrer', title: href,
      }, href.replace(/^https?:\/\/(www\.)?/, '')));
      extra.push(row);
    }

    aside.appendChild(h('div', { className: 'side-card' },
      h('div', { className: 'side-card-hd' }, 'Metadata'),
      h('div', { className: 'side-card-body' },
        fileRow,
        // metaForPage, not KIND_META[kind] — the header pill above this rail
        // reads it that way, and a bookmark that calls itself "Note" one line
        // below a badge saying "Bookmark" is the label being decided twice.
        sRow('Kind',     metaForPage(page).label),
        ...extra,
        sRow('Created',  fmtDate(page.created)),
        sRow('Updated',  fmtDate(page.updated)),
        sRow('ID',       page.id.slice(0, 8) + '…'))));

    /* BACKLINKS — fetched live (pages that mention this one).
       Not on a topic: the orbit in the body is a superset of this list and
       says more about each row, so keeping the card too would print the same
       links twice on one screen and make the reader choose which to trust. */
    if (page.kind !== 'topic') {
      const backHd = h('div', { className: 'side-card-hd' }, 'Backlinks');
      const backBody = h('div', { className: 'side-card-body side-card-empty' }, 'loading…');
      aside.appendChild(h('div', { className: 'side-card' }, backHd, backBody));
      Promise.resolve(SB.data().backlinks(page.id)).then(({ items }) => {
        backHd.textContent = 'Backlinks · ' + (items ? items.length : 0);
        clear(backBody);
        if (!items || !items.length) {
          backBody.className = 'side-card-body side-card-empty';
          backBody.appendChild(document.createTextNode('No pages link here yet.'));
          return;
        }
        backBody.className = 'side-card-body';
        const list = h('div', { className: 'side-children' });
        items.forEach((b) => list.appendChild(h('button', {
          className: 'side-link side-link-hasg',
          onClick: () => { app.openPageId = b.id; app.route = 'page'; render(); },
        },
          h('span', { className: 'side-link-g',
            style: { color: metaForPage(b).color || 'var(--muted)' } },
            icon(metaForPage(b).icon || 'file-text')),
          h('span', { className: 'side-link-title' }, b.title),
          h('span', { className: 'side-link-meta' }, metaForPage(b).label || b.kind))));
        backBody.appendChild(list);
      }).catch(() => {
        backHd.textContent = 'Backlinks · 0';
        clear(backBody); backBody.appendChild(document.createTextNode('—'));
      });
    }

    // SUB-PAGES
    const children = (page.meta && Array.isArray(page.meta.children)) ? page.meta.children : [];
    const childList = h('div', { className: 'side-children' });
    const subCard = h('div', { className: 'side-card' },
      h('div', { className: 'side-card-hd' }, 'Sub-pages · ' + children.length),
      h('div', { className: 'side-card-body' },
        childList,
        h('button', { className: 'side-action',
          onClick: createSubpage }, icon('plus'), 'Add sub-page')));
    aside.appendChild(subCard);

    if (children.length) {
      v2GetPagesBatch(children).then((pgs) => {
        clear(childList);
        pgs.forEach((cp) => {
          if (!cp) return;
          childList.appendChild(h('button', {
            className: 'side-link',
            onClick: () => { app.openPageId = cp.id; app.route = 'page'; render(); },
          },
            h('span', { className: 'side-link-title' }, cp.title || '(untitled)'),
            h('span', { className: 'side-link-meta' }, metaForPage(cp).label)));
        });
      });
    }

    // ACTIONS
    aside.appendChild(h('div', { className: 'side-card' },
      h('div', { className: 'side-card-hd' }, 'Actions'),
      h('div', { className: 'side-card-body' },
        h('button', { className: 'side-action',
          onClick: async () => {
            try {
              const res = await SB.data().exportPage(page.id);
              const blob = new Blob([res.content], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = res.filename.split('/').pop();
              // In the document, and revoked on a timer rather than on the
              // next line: the save reads the object URL after click() has
              // returned, so revoking synchronously races it. Same fix as the
              // clipper download.
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            } catch (e) { toast('Export failed — ' + e.message, { tone: 'error' }); }
          } }, icon('download'), 'Export .md'),
        /* The other half of the write safety. Every overwrite has snapshotted
           to `.history/` since 5.19 and the app never said so, so the app
           looked more dangerous than it actually is. Restoring writes through
           the normal save path, which means the restore is itself snapshotted
           — you can undo the undo. */
        h('button', { className: 'side-action',
          onClick: async () => {
            let snaps = [];
            try { snaps = await SB.data().pageHistory(page.id); } catch (_) {}
            if (!snaps.length) { toast('No earlier versions of this page yet'); return; }
            const pick = await historyDialog(snaps, page.title || 'this page');
            if (!pick) return;
            const r = await SB.data().readSnapshot(pick.path);
            if (!r || !r.ok) { toast('Could not read that version', { tone: 'error' }); return; }
            page.body = r.body != null ? r.body : r.text;
            // The version's reference material too — see Data.readSnapshot.
            if (page.meta && Array.isArray(r.attachments)) page.meta.attachments = r.attachments;
            queueSave();
            layout();
            toast('Restored the version from ' + pick.stamp);
          } }, icon('history'), 'Version history'),
        h('button', { className: 'side-action side-action-warn',
          onClick: async () => {
            if (!await confirmDialog({
              title: 'Delete this page?',
              body: 'This moves "' + (page.title || 'this page') + '" to .trash/ in your vault. '
                  + 'You can undo it, and the file stays on disk either way.',
              confirmLabel: 'Delete',
              danger: true,
            })) return;
            const title = page.title || 'Page';
            const receipt = await SB.data().deletePage(page.id);
            cacheInvalidatePage(page.id);
            onDeleted && onDeleted();
            // The file went to .trash/ rather than away. Say so, and offer
            // the way back — a safety nobody is told about is not a safety.
            toast(title + ' deleted', {
              actionLabel: 'Undo',
              onAction: async () => {
                const r = await SB.data().restorePage(receipt);
                if (r && r.ok) {
                  invalidatePageIndex();
                  await refreshCounts();
                  if (r.id) openPage(r.id); else render();
                  toast(title + ' restored');
                } else {
                  toast('Could not restore — ' + ((r && r.reason) || 'unknown'), { tone: 'error' });
                }
              },
            });
          /* Says what it does. It was "Forget this" — a euphemism its own
             confirm dialog immediately contradicted ("Delete this page?"),
             and the word nobody scanning for delete would find. */
          } }, icon('trash-2'), 'Delete page'))));

    return aside;

    async function createSubpage() {
      try {
        if (!page.meta) page.meta = {};
        // Enforce 3-level cap: if THIS page already has a grandparent, it sits
        // at depth 2; creating a child would push us to depth 3 (level 4) which
        // is too deep.
        const depth = await pageDepth(page);
        if (depth >= SUBPAGE_MAX_DEPTH - 1) {
          toast('Sub-pages stop at ' + SUBPAGE_MAX_DEPTH + ' levels deep — '
            + 'link to a page instead of nesting another one.');
          return;
        }
        /* `parent`, at the top level, is what createPage reads — it builds its
           frontmatter from a fixed list and has never once looked inside
           `meta`, so the relation this button exists to make was dropped on
           the floor and every sub-page came out an ordinary unattached page.
           (`kind: 'markdown'` went with it: there are four kinds and that is
           not one of them, so that branch could only ever return a refusal the
           next line then read `.id` off.) */
        const newPage = await SB.data().createPage({
          kind: 'topic', title: '', body: '', parent: page.id,
        });
        if (!newPage || newPage.ok === false || !newPage.id) {
          toast('Could not create the sub-page — ' + ((newPage
            && (newPage.message || newPage.reason)) || 'the vault refused the write'),
            { tone: 'error' });
          return;
        }
        /* Nothing to write back on this end. The child names its parent and
           the parent's list is derived from that one fact — a second copy here
           is the half of the pair that goes stale. */
        cacheInvalidatePage(page.id);
        invalidatePageIndex();
        app.openPageId = newPage.id; app.route = 'page'; render();
      } catch (e) { toast('Could not create the sub-page — ' + e.message, { tone: 'error' }); }
    }
  }

  // Walk up meta.parent to compute the page's depth (0 = root, 1 = child, …)
  async function pageDepth(p) {
    let depth = 0;
    let cur = p;
    while (cur && cur.meta && cur.meta.parent && depth < 5) {
      cur = await getPageCached(cur.meta.parent).catch(() => null);
      if (!cur) break;
      depth++;
    }
    return depth;
  }

  // ── Compose header + body + side ──────────────────────────────────────
  const layout = () => {
    runBodyTeardowns();
    clear(wrap);
    const m = metaForPage(page);

    // Ancestor breadcrumb (parent → grandparent) — only shown if page has a parent.
    // We fill it asynchronously so layout stays sync.
    const ancestorBar = page.meta && page.meta.parent
      ? h('div', { className: 'page-ancestors' }, h('span', { className: 'page-ancestors-loading' }, '↑ …'))
      : null;
    if (ancestorBar) {
      (async () => {
        const chain = [];   // [grandparent, parent]
        let cur = page;
        while (cur && cur.meta && cur.meta.parent && chain.length < SUBPAGE_MAX_DEPTH - 1) {
          const par = await getPageCached(cur.meta.parent).catch(() => null);
          if (!par) break;
          chain.unshift(par);
          cur = par;
        }
        clear(ancestorBar);
        if (!chain.length) return;
        ancestorBar.appendChild(h('span', { className: 'page-ancestors-l' }, '↑'));
        chain.forEach((a, i) => {
          if (i > 0) ancestorBar.appendChild(h('span', { className: 'page-ancestors-sep' }, '›'));
          ancestorBar.appendChild(h('a', {
            className: 'page-ancestors-crumb',
            href: '#page/' + a.id,
            onClick: (e) => { e.preventDefault(); openPage(a.id); },
          }, a.title || '(untitled)'));
        });
      })();
    }

    /* A project is a folder, and a folder does not have tags, a description or
       a mentions list — the things inside it do. Detected here rather than at
       the dispatch below, because the header is built first and the chips row
       has to know. */
    const _pjPath = /^projects\/([^/]+)\/([^/]+)\.md$/.exec(page.path || '');
    const isProjectNote = !!(_pjPath && _pjPath[1] === _pjPath[2]);

    const header = h('div', { className: 'page-hd' },
      ancestorBar,
      h('div', { className: 'page-hd-row' },
        /* `metaForPage` already picks a page's CHROME from its content — a
           note with a url gets the bookmark layout. It now picks the LABEL
           too. The nav facet said "Bookmark" and the page pill said "Note",
           which is the derived-facet model (kind === note && url) leaking
           into the interface; the user does not know or care that bookmark
           is not a stored kind. */
        h('span', { className: 'page-kind-pill', style: { '--k-c': m.color }, title: m.hint },
          h('span', { className: 'kind-chip-g' }, icon(m.icon || 'file-text')),
          h('span', { className: 'page-kind-label' }, m.label)),
        h('input', {
          className: 'page-title-input',
          placeholder: 'Untitled',
          value: page.title,
          onInput: (e) => { page.title = e.target.value; queueSave(); },
        }),
        h('div', { className: 'page-meta-side' },
          // Sits before the timestamp so the eye finds "did that land?" in
          // the same place it already looks for "when did this change".
          h('span', { className: 'save-state', 'data-state': 'idle', role: 'status', 'aria-live': 'polite' }),
          h('span', { className: 'page-meta-when' }, 'updated ', fmtDate(page.updated)),
          obsidianUrl(page.path) ? h('a', {
            className: 'page-meta-obs', href: obsidianUrl(page.path),
            title: 'open this file in Obsidian — deeper search, backlinks, canvas arranging',
          }, 'obsidian ↗') : null,
          /* The delete control lives in Actions, at the bottom of the
             metadata rail, with the rest of the page-level operations. It
             used to ALSO sit here as a bare "delete" link beside the
             timestamp — a destructive verb rendered quieter than a date and
             one slip away from "obsidian ↗". One of them had to go, and it
             was not going to be the one in Actions. */
        )),
      /* One row, no gutter labels. The chips announce their own type — a tag
         is a lime #pill, a mention carries a link glyph and squared corners —
         so the uppercase TAGS / MENTIONS labels only restated what the chips
         already say, and the two labelled rows they anchored were most of the
         header's height. The add-affordances sit at the end of their group,
         quiet until used. */
      isProjectNote ? null : h('div', { className: 'page-chips-row' },
        page.tags.map((t, i) => TagChip(t, {
          onClick: () => setRoute('tag:' + t),
          onRemove: () => { page.tags.splice(i, 1); queueSave(); layout(); },
        })),
        /* The one picker, opened from a chip-shaped trigger. It used to be an
           inline field whose dropdown could only offer existing tags to the
           keyboard — the create row was mouse-only. */
        chipAdd('tag', 'Tag', (btn) => openPicker(btn, {
          placeholder: 'Find or create a tag…',
          hint: '↑↓ to choose · ⏎ to add · esc to close',
          search: tagRows(page.tags),
          onPick: (row) => { page.tags.push(row.key); invalidateTagsCache(); queueSave(); layout(); },
          onCreate: (text) => {
            const t = String(text).replace(/^#/, '').trim().toLowerCase();
            if (!t || page.tags.includes(t)) return;
            page.tags.push(t); invalidateTagsCache(); queueSave(); layout();
          },
          createLabel: (t) => 'Create #' + String(t).replace(/^#/, '').toLowerCase(),
        })),
        /* The seam between the two families — present only when both are. */
        (page.tags.length && visibleMentions().length)
          ? h('span', { className: 'chips-sep', 'aria-hidden': 'true' }) : null,
        // A mention chip means "a link to another page". Two things were
        // getting in that are neither: the page's OWN path (a board
        // mentioning itself) and asset paths like attachments/foo.png,
        // which rendered as five identical truncated chips. Both are
        // filtered for display only — the underlying array is untouched,
        // so nothing is dropped from the file.
        visibleMentions().map(({ mn, i }) => MentionChip(mn, {
          onClick: () => { const t = resolveMention(mn); if (t.id) openPage(t.id); },
          /* Splicing the array was the whole of it, and the array is rebuilt
             from the body on the next load — so the chip came back. The link
             lives in the text, so that is where it is taken out of. */
          onRemove: () => { unlinkMention(mn, i); },
        })),
        // Same panel, same keys, pages instead of tags.
        /* Not on a wall. An inspo body is a list of items and `serializeInspoBody`
           keeps items only — a page-level link written there survives until the
           next time the wall is edited and is then dropped, silently. A surface
           that cannot save the gesture does not accept it; a wall still cites a
           page the way its own model does, with a wikilink in a caption or note. */
        page.kind === 'inspo' ? null
          : chipAdd('link-2', 'Link a page', (btn) => openPicker(btn, {
            placeholder: 'Find a page…',
            hint: '↑↓ to choose · ⏎ to link · esc to close',
            search: pageRows(page.mentions),
            onPick: (row) => { linkMention(row.label); },
          })),
        /* An "in content" strip used to list every #hashtag found in the
           body. It restated information the reader can already see — the
           tags are right there in the prose, styled as tags — and on an
           inspo wall, where every item carries tags, it produced a third
           consecutive row of near-identical lime pills before any image.
           The tags are visible where they are written; the filter strip is
           how you act on them. */
        ));

    // Dispatch body + side per kind
    let body, side;
    let extraClass = '';
    // A project's folder note IS the project screen. Detected by path — the
    // file says `kind: note` (SPEC: project is a folder, not a kind), so
    // dispatching on kind alone sent every project to the plain text editor,
    /* Every kind gets the metadata rail.
       Several used to pass `side = null` — a leftover from when the right
       column held the chat composer. With chat gone, null did not mean "this
       kind wants width", it meant boards, walls, bookmarks and snippets had
       no delete, no export and no version history at all. A kind you cannot
       manage is not a simpler kind, it is an unfinished one. Width is
       recoverable by collapsing the sidebar; the actions were not
       recoverable by anything.

       The project note keeps `null` on purpose: its body IS a full-width
       container view, with its own details and contents. */
    // which made a container look like a note.
    if (isProjectNote) {
      body = renderProjectBody(_pjPath[1]);
      /* The rail too. `side = null` was rationalised when the body was a
         full-width management surface with its own details card; the body is
         a contents list now, and null meant a project was the one page with
         no delete, no export and no version history — the exact hole the
         "every kind carries the rail" rule exists to close. */
      side = renderTopicSide();
      extraClass = ' project-grid';
    } else if (page.kind === 'canvas') {
      /* One kind, one format, one editor: `kind: canvas` means a board, and a
         board is a `.excalidraw.md`.

         A page still carrying `kind: canvas` without a scene is a legacy
         `.md` + `.canvas` pair from when this app rendered JSON Canvas. It is
         not a broken board and it does not get an apology screen — it is a
         markdown file with prose in it, so it renders as one, and the
         `![[thing.canvas]]` line in its body stays exactly where its author
         put it. Obsidian still opens the pair; nothing here has touched it. */
      if (page.meta && page.meta.excalidraw) {
        body = renderExcalidrawBody();
        extraClass = ' canvas-grid';
      } else {
        body = renderMarkdownBody();
        extraClass = ' md-grid';
      }
      side = renderTopicSide();
    } else if (page.kind === 'inspo') {
      // No withBoardBody wrapper: the body IS the wall now, not a caption
      // under a board.
      body = renderInspoBody();
      side = renderTopicSide();
      extraClass = ' canvas-grid inspo-grid';
    } else if (page.kind === 'note') {
      // 6.9 / SPEC §5: `note` chrome is decided by FRONTMATTER, not by kind.
      // This is why bookmark, snippet and markdown could collapse into one kind
      // — the distinction was always in the metadata, never in the storage.
      // The decision lives in app/vault/data.js so it is testable headlessly
      // and cannot drift from what the tests assert (task 2.7).
      // Fall back to the safest chrome rather than throwing: a missing global
      // used to surface as "Page not found", which is a lie about the data.
      const chrome = typeof window.SB_CHROME === 'function'
        ? window.SB_CHROME(page) : 'article';
      if (chrome === 'bookmark card') {
        body = renderBookmarkBody();
        extraClass = ' bookmark-grid';
      } else if (chrome === 'link with source line') {
        body = renderBookmarkBody();
        extraClass = ' bookmark-grid bookmark-plain';
      } else if (chrome === 'pull-quote') {
        body = renderSnippetBody();
        extraClass = ' snippet-grid';
      } else {
        body = renderMarkdownBody();
        extraClass = ' md-grid';
      }
      side = renderTopicSide();
    } else if (page.kind === 'topic') {
      body = renderTopicBody().body;   // attached materials + the writing surface
      side = renderTopicSide();        // metadata / backlinks / sub-pages / actions
      extraClass = ' topic-grid';
    } else if (page.kind === 'markdown') {
      body = renderMarkdownBody();
      side = renderTopicSide();  // reuse: METADATA / BACKLINKS / SUB-PAGES / ACTIONS
      extraClass = ' md-grid';
    } else if (page.kind === 'bookmark') {
      body = renderBookmarkBody();
      side = renderTopicSide();
      extraClass = ' bookmark-grid';
    } else if (page.kind === 'snippet') {
      body = renderSnippetBody();
      side = renderTopicSide();
      extraClass = ' snippet-grid';
    } else if (page.kind === 'project' || page.kind === 'wproject') {
      body = renderProjectBody();
      side = null;
      extraClass = ' project-grid';
    } else {
      body = renderDefaultBody();
      side = renderTopicSide();
    }

    /* --k-c on the GRID, not on the header: the metadata rail is a sibling of
       the main column, and both take the kind wash. Setting it once here is
       what lets the rail's cards tint themselves without every one of them
       being told which page they belong to. */
    wrap.appendChild(h('div', {
      className: 'page-grid' + (side ? '' : ' no-chat') + extraClass,
      style: { '--k-c': m.color },
    },
      h('div', { className: 'page-main' }, header, body, renderCarriedSections()),
      side)); // right column
  };

  getPageCached(pageId).then((p) => {
    // A resolved-but-null page is "no such id", not a crash. Without this the
    // view throws on `p.tags` and the catch below reports a render failure.
    if (!p) throw new Error('no page with id ' + pageId);
    page = { ...p, tags: [...(p.tags || [])], mentions: [...(p.mentions || [])], meta: { ...(p.meta || {}) } };
    layout();
    /* Rebuild the breadcrumb once we have the real page — crumbsFor runs
       before the fetch resolves, so it had neither the title (it printed an
       id prefix) nor, when the route you arrived from was not a container,
       any way to know where the page actually lives. Both are answers only
       the loaded page has. */
    try {
      const row = document.querySelector('.crumb-row');
      if (row) row.replaceWith(BreadcrumbRow(crumbsFor('page')));
    } catch (_) {}
  }).catch((e) => {
    // Distinguish "no such page" from "the renderer threw" — reporting a render
    // bug as a missing page sends you looking in the wrong place entirely.
    console.error('page view failed:', e);
    wrap.appendChild(EmptyState(
      'Could not open this page.',
      (e && e.message) ? String(e.message) : 'It may have been deleted.'));
  });

  // Save on unmount + clean up any body listeners (canvas/inspo paste, etc.)
  wrap.__teardown = () => {
    flushSave();          // not `if (dirty) commit()` — the debounce is killed too
    window.removeEventListener('pagehide', leaveHandler);
    document.removeEventListener('visibilitychange', visHandler);
    window.removeEventListener('beforeunload', unloadGuard);
    runBodyTeardowns();
  };
  return wrap;
}

// ── Tags index: every page-level tag, click to filter ─────────────
// Note: PageHeader returns an *array* of two elements, so use append(wrap, …)
// helpers (which flatten) — wrap.appendChild on an array would throw.
/* The colour menu for one tag. Anchored to the chip that opened it, dismissed
   by Escape, by an outside click, or by choosing — the three ways anyone
   expects a menu to close. Only one is ever open: opening a second closes the
   first, so a screen of chips cannot end up wearing a trail of popovers. */
let _tagPopClose = null;
function openTagColorPicker(anchor, tag, onDone) {
  if (_tagPopClose) _tagPopClose();
  const current = tagColorMap()[String(tag).toLowerCase()];

  const pop = h('div', { className: 'tag-pop', role: 'menu',
    'aria-label': 'Colour for ' + tag });
  pop.appendChild(h('div', { className: 'tag-pop-hd' }, 'Mark for #' + tag));

  /* The emoji. A short row of the ones that actually get used on a wall of
     references, plus a field for anything else — a picker with 3,000 glyphs
     in it is a worse answer than eight good ones and somewhere to paste. */
  const EMOJI = ['🎨', '📐', '🔤', '📷', '🧭', '⚙️', '📚', '💡', '🧪', '🌿', '🔥', '⭐'];
  const cur = tagEmoji(tag);
  const erow = h('div', { className: 'tag-pop-emoji' });
  EMOJI.forEach((g) => {
    erow.appendChild(h('button', {
      className: 'tag-pop-e' + (cur === g ? ' on' : ''),
      title: g, 'aria-label': 'Use ' + g,
      onClick: () => { setTagEmoji(tag, g); close(); onDone(); },
    }, g));
  });
  const efield = h('input', {
    className: 'tag-pop-ein', placeholder: 'or paste one', value: cur || '',
    maxLength: 4, 'aria-label': 'Any emoji',
  });
  efield.addEventListener('change', () => { setTagEmoji(tag, efield.value); close(); onDone(); });
  erow.appendChild(efield);
  if (cur) {
    erow.appendChild(h('button', {
      className: 'tag-pop-e tag-pop-e-clear', title: 'No emoji', 'aria-label': 'No emoji',
      onClick: () => { setTagEmoji(tag, ''); close(); onDone(); },
    }, '⃠'));
  }
  pop.appendChild(erow);
  pop.appendChild(h('div', { className: 'tag-pop-sub' }, 'Colour'));

  const grid = h('div', { className: 'tag-pop-grid' });
  TAG_HUES.forEach((label, i) => {
    const on = current === i;
    grid.appendChild(h('button', {
      className: 'tag-pop-sw tag-h' + i + (on ? ' on' : ''),
      role: 'menuitemradio', 'aria-checked': String(on),
      title: label, 'aria-label': label,
      onClick: () => { setTagColor(tag, i); close(); onDone(); },
    }));
  });
  pop.appendChild(grid);
  pop.appendChild(h('button', {
    className: 'tag-pop-auto' + (current == null ? ' on' : ''),
    role: 'menuitem',
    // Named for what it does rather than "Default": the colour is derived
    // from the tag's own name, and saying so explains why it is already
    // different from its neighbour's.
    onClick: () => { setTagColor(tag, null); close(); onDone(); },
  }, current == null ? '✓ Automatic — from the name' : 'Automatic — from the name'));

  function close() {
    if (_tagPopClose !== close) return;
    _tagPopClose = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    pop.remove();
  }
  function onOutside(e) { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  _tagPopClose = close;
  anchor.appendChild(pop);
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  // Keep it on screen: a chip near the right edge would otherwise open its
  // menu into the gutter, where the last two swatches are unreachable.
  const box = pop.getBoundingClientRect();
  if (box.right > window.innerWidth - 8) pop.classList.add('tag-pop-right');
  const first = pop.querySelector('.tag-pop-sw');
  if (first) first.focus();
}

function TagsIndexScreen() {
  const wrap = h('div', { className: 'screen' });
  append(wrap, PageHeader('Tags', null,
    'Every tag used across your pages. Click any to see the pages using it.', null));
  wrap.appendChild(Skeleton('cards', 8));

  /* Search and create live on the screen itself: a tag you cannot find is one
     keystroke from existing. Creating one writes the CONVENTION's subject page
     — `tags/<name>.md`, empty on purpose — so it survives reload and Obsidian
     sees it too; it shows in the cloud at zero until a page carries it. */
  let all = [];
  const cloud = h('div', { className: 'tags-cloud' });
  const input = h('input', {
    className: 'list-search tags-filter', type: 'search',
    placeholder: 'filter tags — or type a new one…',
    autocomplete: 'off', spellcheck: false,
  });
  const createBtn = h('button', { className: 'btn-primary tags-create' });
  const toolbar = h('div', { className: 'tags-toolbar' }, input, createBtn);

  const paint = () => {
    const q = input.value.trim().toLowerCase();
    clear(cloud);
    const subset = all.filter((t) => !q || t.tag.toLowerCase().includes(q));
    subset.forEach((t) => {
      /* A tag is a tag wherever it appears. This screen drew grey outlined
         boxes while every other surface draws chips, so the one screen
         devoted to tags was the one that did not look like it.

         Frequency used to be carried by font-size — an inline em value that
         sat off the type scale entirely, and redundant besides, since the
         count is printed right there. It rides on the count badge now.

         Two targets in one chip: the swatch edits the colour, the rest
         filters. They cannot nest — a button inside a button is not a thing
         the DOM will give you — so the chip is a wrapper that only looks
         like one control. */
      const item = h('span', { className: 'tag-chip tag-cloud-chip ' + tagHue(t.tag) });
      item.appendChild(h('button', {
        className: 'tag-swatch',
        title: 'Change the colour of #' + t.tag,
        'aria-label': 'Change the colour of ' + t.tag,
        onClick: (e) => { e.stopPropagation(); openTagColorPicker(item, t.tag, paint); },
      }));
      item.appendChild(h('button', {
        className: 'tag-cloud-go',
        title: t.count ? nOf(t.count, 'page') : 'not on any page yet',
        onClick: () => setRoute('tag:' + t.tag),
      },
        h('span', { className: 'tag-cloud-name' }, t.tag),
        h('span', { className: 'tag-cloud-count' }, t.count ? String(t.count) : 'new')));
      cloud.appendChild(item);
    });
    if (!subset.length) {
      cloud.appendChild(h('div', { className: 'tags-cloud-empty' },
        all.length
          ? (q ? 'No tag matches — create it?' : 'No tags yet.')
          : 'No tags yet — type a name above to make the first one.'));
    }
    const exact = all.some((t) => t.tag.toLowerCase() === q);
    createBtn.style.display = q && !exact ? '' : 'none';
    createBtn.textContent = '+ create "' + input.value.trim() + '"';
  };

  const create = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      const r = await SB.data().createTag(name);
      if (!r.ok) throw new Error(r.message || r.reason || 'refused');
      invalidateTagsCache();
      toast('#' + r.tag + ' created — apply it from any page.');
      render();   // rebuild the screen, so the header count agrees with the cloud
    } catch (e) {
      toast('Could not create that tag — ' + e.message, { tone: 'error' });
    }
  };
  createBtn.addEventListener('click', create);
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    if (all.some((t) => t.tag.toLowerCase() === q)) setRoute('tag:' + q);
    else create();
  });

  Promise.resolve(SB.data().tags()).then(({ tags }) => {
    clear(wrap);
    all = [...(tags || [])].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    append(wrap, PageHeader('Tags', null,
      nOf(all.length, 'tag') + ' in the vault. Click any to filter.', null));
    wrap.appendChild(toolbar);
    wrap.appendChild(cloud);
    paint();
  }).catch((e) => {
    clear(wrap);
    wrap.appendChild(EmptyState('Failed to load tags.', String(e.message || e)));
  });
  return wrap;
}

// ── Filter pages by tag (reuses the existing /pages?tag= endpoint) ─
function TagFilterScreen(tag) {
  const wrap = h('div', { className: 'screen' });
  const backToTags = h('button', { className: 'side-action',
    onClick: () => setRoute('tags') }, '← all tags');
  append(wrap, PageHeader('#' + tag, null, 'Pages tagged ' + tag, backToTags));
  wrap.appendChild(Skeleton('rows', 6));
  Promise.resolve(SB.data().pages({ tag, limit: 500 })).then(({ items }) => {
    (items || []).forEach((p) => cacheSetPage(p));
    clear(wrap);
    append(wrap, PageHeader('#' + tag, null,
      nOf((items || []).length, 'page'),
      h('button', { className: 'side-action', onClick: () => setRoute('tags') }, '← all tags')));
    if (!items || !items.length) {
      wrap.appendChild(EmptyState('No pages with #' + tag + ' yet.', 'Add the tag to a page to see it here.'));
      return;
    }
    wrap.appendChild(ListView_Table(items, openPage));
  }).catch((e) => {
    clear(wrap);
    wrap.appendChild(EmptyState('Failed to load.', String(e.message || e)));
  });
  return wrap;
}

// ── Filter pages by mention-tag (pages that reference this hub) ────
function MentionFilterScreen(slug) {
  const wrap = h('div', { className: 'screen' });
  const backTo = () => h('button', { className: 'side-action',
    onClick: () => setRoute('mention-tags') }, '← all mention tags');
  append(wrap, PageHeader('@' + slug, null, 'Pages mentioning ' + slug, backTo()));
  wrap.appendChild(Skeleton('rows', 6));
  Promise.resolve({ items: [], mention_tag: null }).then(({ items, mention_tag }) => {
    (items || []).forEach((p) => cacheSetPage(p));
    clear(wrap);
    append(wrap, PageHeader(
      '@' + slug,
      mention_tag && mention_tag.name ? mention_tag.name : null,
      nOf((items || []).length, 'page') + ((items || []).length === 1 ? ' mentions this' : ' mention this'),
      backTo()));
    if (!items || !items.length) {
      wrap.appendChild(EmptyState('No pages mention @' + slug + ' yet.',
        'Reference it inline with [[mt:' + slug + ']] or add it to a page\'s mentions list.'));
      return;
    }
    wrap.appendChild(ListView_Table(items, openPage));
  }).catch((e) => {
    clear(wrap);
    wrap.appendChild(EmptyState('Failed to load.', String(e.message || e)));
  });
  return wrap;
}


/* ── screen: About me ───────────────────────────────────────────────────
   `context/about-me.md`, and nothing else. Its content is its body — prose,
   because prose is the only shape the convention leaves for it.

   This screen used to be a form: Identity, Taste, Communication and State
   over four résumé sections — experience, skills, education, highlights.
   Not one of those fields ever reached the disk. It sent eight structured
   keys through `updateAboutMe` → `updatePage`, whose write list is title,
   tags, aliases, url, status, two `meta` keys and the body; the other eight
   were dropped and the save still reported success. The read side never had
   them either — `aboutMe()` returns `{ body, updated, path }` — so every
   load re-created the objects empty and the form came back blank whatever
   you had typed into it. It has never worked, in either direction.

   Making it work was the other option, and CONVENTION.md decides against it
   twice over. Frontmatter cannot take it: the key list is closed,
   `mdfile.serialize` throws on anything outside it, and YAML there holds
   neither a nested object nor a list of dicts. The body could take it, but
   only by claiming `## Experience` and its siblings as structural headings
   the app parses back and regenerates on every write — and this is the one
   file Obsidian and your agent write freely, in whatever shape the sentence
   wants. Rewriting it from a form would drop what they had put there, which
   is the loss the inspo wall already documents and write safety already
   forbids.

   So the page is what the scaffold template, the demo vault and
   SETUP-PROMPT.md always described it as: who you are, in your own words,
   read before anything is written in your voice. Anything already sitting in
   someone's file stays there, untouched and readable in Obsidian. Nothing is
   lost that was ever gained. */
function AboutMeScreen() {
  const wrap = h('div', { className: 'screen page-screen' });
  let me = null;
  let dirty = false;
  let saveTimer = null;

  /* The same three-state strip the page editor carries, for the same reason:
     this autosaves 600ms after you stop typing and used to say nothing at
     all. Silence is survivable while the write works and a lie when it does
     not — and the write here can be refused outright, because a vault
     adopted without `context/about-me.md` has nowhere to put one. */
  const setSaveState = (state, detail) => {
    const el = wrap.querySelector('.save-state');
    if (!el) return;
    el.setAttribute('data-state', state);
    if (detail) el.setAttribute('title', detail); else el.removeAttribute('title');
    clear(el);
    if (state === 'saving') {
      el.appendChild(h('span', { className: 'save-dot' }));
      el.appendChild(document.createTextNode('Saving…'));
    } else if (state === 'saved') {
      el.appendChild(icon('check'));
      el.appendChild(document.createTextNode('Saved'));
      clearTimeout(el._t);
      el._t = setTimeout(() => {
        if (el.getAttribute('data-state') === 'saved') setSaveState('idle');
      }, 2200);
    } else if (state === 'error') {
      clearTimeout(el._t);       // a failure stays put until the next attempt
      el.appendChild(icon('x'));
      el.appendChild(document.createTextNode('Not saved'));
    }
  };

  const queueSave = () => {
    dirty = true;
    setSaveState('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, 600);
  };
  const flushSave = () => { clearTimeout(saveTimer); commit(); };

  const commit = async () => {
    if (!dirty || !me) return;
    dirty = false;
    try {
      const patched = await SB.data().updateAboutMe({ body: me.body });
      // A refusal used to end in a console.warn nobody has open, with the
      // edit still on screen — the page looked saved and was not.
      if (!patched || patched.ok === false) {
        const why = patched && patched.reason === 'no-about-me'
          ? 'This vault has no context/about-me.md to write to.'
          : (patched && (patched.message || patched.reason))
            || 'The vault refused the write.';
        console.warn('about-me save refused:', why);
        setSaveState('error', why);
        return;
      }
      me.updated = patched.updated;
      setSaveState('saved');
      // Patched in place rather than re-laid out: the prose editor owns its
      // own caret and a rebuild would take it away mid-sentence.
      const when = wrap.querySelector('.page-meta-when');
      if (when) when.textContent = me.updated ? 'updated ' + fmtDate(me.updated) : '';
    } catch (e) {
      console.warn('about-me save failed', e);
      setSaveState('error', String((e && e.message) || e));
    }
  };

  const layout = () => {
    clear(wrap);
    wrap.appendChild(h('div', { className: 'page-grid no-chat' },
      h('div', { className: 'page-main' },
        h('div', { className: 'page-hd' },
          h('div', { className: 'page-hd-row' },
            // The pill and the title both read "About me". One of them is
            // enough, and the title is the one that matches every other page.
            h('span', { className: 'page-kind-pill', style: { '--k-c': 'var(--k-self)' } },
              h('span', { className: 'kind-chip-g' }, icon('circle-user')),
              h('span', null, 'You')),
            h('span', { className: 'page-title-static' }, 'About me'),
            h('div', { className: 'page-meta-side' },
              h('span', {
                className: 'save-state', 'data-state': 'idle',
                role: 'status', 'aria-live': 'polite',
              }),
              h('span', { className: 'page-meta-when' },
                me.updated ? 'updated ' + fmtDate(me.updated) : '')))),
        /* No file, no editor. A vault adopted as it was found has no
           `context/about-me.md`, and every save into it would be refused —
           so the gesture is not offered. The app never writes on adoption. */
        me.path === null
          ? EmptyState('This vault has no About me page.',
              'The app writes context/about-me.md when it scaffolds a new vault; '
              + 'this one was adopted as it was found, and adoption never writes. '
              + 'Create context/about-me.md in Obsidian and it opens here.')
          : ProseEditor({
              getValue: () => me.body || '',
              setValue: (v) => { me.body = v; queueSave(); },
              onDone: flushSave,
              placeholder: 'Who you are, what you work on, what you care about. '
                + 'Any agent reads this before it writes anything in your voice.',
              minHeight: 320,
            }))));
  };

  SB.data().aboutMe().then((d) => { me = d; layout(); }).catch((e) => {
    // There is no server to check — this app has none. What can fail here is
    // the vault handle, so say that instead.
    clear(wrap);
    wrap.appendChild(EmptyState('Could not read About me.',
      String((e && e.message) || e)));
  });
  wrap.__teardown = () => { if (dirty) flushSave(); };
  return wrap;
}



/* ── screen: Ask (live POST /chat) ────────────────────────────────────── */
const ASK_EXAMPLES = [
  'What have I been reading about lately?',
  'Summarize my active projects.',
  'What concepts keep recurring across my notes?',
  'Where do my notes contradict each other?',
  'What should I revisit from long-term memory?',
];
/* ── renderMarkdown ───────────────────────────────────────────────
   Tiny block + inline markdown renderer for chat output. Handles:
     - ``` fenced ``` code blocks (preserve newlines)
     - `inline code`
     - **bold** / __bold__
     - *italic* / _italic_
     - [text](url) links
     - # headings (1-3)
     - - / * unordered lists
     - 1. ordered lists
     - blockquotes (> …)
     - paragraphs (blank-line separated)
   Returns an array of DOM nodes so callers can mount it anywhere. We hand-roll
   this rather than pull a library — keeps the SPA zero-deps. */
function _escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function _inlineMarkdown(text) {
  // Escape first, then re-insert HTML for the tokens we control.
  let html = _escHtml(text);
  // Inline code — done before bold/italic so backticks aren't confused with *.
  html = html.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + c + '</code>');
  // Links [label](url) — only http(s) or relative/anchor to avoid XSS.
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safe = /^(https?:|\/|#)/i.test(url) ? url : '#';
    return '<a href="' + safe + '" target="_blank" rel="noopener">' + label + '</a>';
  });
  // Bold (** or __), then italic (* or _). Order matters.
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  return html;
}
/* ── LiveSource ─────────────────────────────────────────────────────────
   The writing surface, decorated in place.

   The editor and the view already shared a face, a size, a leading and an
   origin — ae50fe4 did that much — but they still did not look alike, and
   the reason is that a <textarea> cannot style its own contents. `**bold**`
   sat there as five plain characters, `## Heading` was body-sized, and a
   list was a hyphen. So every toggle still threw away every visual signal
   in the document; the text no longer MOVED, but it still changed clothes.

   A textarea cannot be rescued here, and neither can the usual trick of a
   highlighted <pre> aligned behind a transparent one: the moment a span is
   bold or a heading is larger, a proportional face re-measures the line and
   the two layers drift apart. Varying weight and size per span IS the ask,
   so the surface has to be a contenteditable.

   The text stays raw markdown — this is source, not a rich-text buffer, and
   what reaches disk is exactly what you typed. Each source line becomes one
   `.ln` div, decorated by its own syntax, and every source character is
   still present, in order, exactly once: markers are dimmed rather than
   hidden. That is deliberate and it is what keeps the caret honest — a
   character you cannot see is a character the caret falls through. It is
   also the truth: you are editing markdown, and the `##` is really there.

   Because the DOM is reprogrammed on edit, the browser's own undo stack is
   destroyed. So this keeps its own — see `snap`/`doUndo`. Anything that
   silently ate an undo would be a write-safety bug wearing an editor. */

const LV_FENCE = /^\s*(```|~~~)/;
/* indent, marker, gap, optional checkbox — `[0]` is therefore everything up
   to the item's own text, which is the one measurement the rest relies on. */
const LV_LIST = /^(\s*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;

function lvEsc(s) {
  return String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
const lvMk = (s) => (s ? '<span class="lv-mk">' + lvEsc(s) + '</span>' : '');

/* Inline syntax → HTML, preserving every character.
   The invariant every branch below must hold: the text content of what is
   emitted equals the slice of source it consumed. Break it and the caret
   arithmetic — which measures in characters — silently points at the wrong
   place, which is worse than no decoration at all. */
function lvInline(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const atWordStart = i === 0 || /[\s(]/.test(src[i - 1]);
    let m;

    if ((m = /^\\[\\`*_{}\[\]()#+\-.!~=|>]/.exec(rest))) {
      out += lvMk('\\') + lvEsc(m[0][1]); i += 2; continue;
    }
    if ((m = /^(`+)([^`]+?)\1/.exec(rest))) {
      out += lvMk(m[1]) + '<code class="lv-code">' + lvEsc(m[2]) + '</code>' + lvMk(m[1]);
      i += m[0].length; continue;
    }
    if ((m = /^(!?)\[\[([^\]]*)\]\]/.exec(rest))) {
      out += lvMk(m[1] + '[[') + '<span class="lv-wiki">' + lvEsc(m[2]) + '</span>' + lvMk(']]');
      i += m[0].length; continue;
    }
    if ((m = /^(!?)\[([^\]]*)\]\(([^)]*)\)/.exec(rest))) {
      out += lvMk(m[1] + '[') + '<span class="lv-link">' + lvEsc(m[2]) + '</span>'
           + lvMk('](') + '<span class="lv-url">' + lvEsc(m[3]) + '</span>' + lvMk(')');
      i += m[0].length; continue;
    }
    if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) {
      out += lvMk(m[1]) + '<strong>' + lvInline(m[2]) + '</strong>' + lvMk(m[1]);
      i += m[0].length; continue;
    }
    if ((m = /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest))) {
      out += lvMk(m[1]) + '<em>' + lvInline(m[2]) + '</em>' + lvMk(m[1]);
      i += m[0].length; continue;
    }
    if ((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
      out += lvMk('~~') + '<s>' + lvInline(m[1]) + '</s>' + lvMk('~~');
      i += m[0].length; continue;
    }
    if ((m = /^==(?=\S)([\s\S]*?\S)==/.exec(rest))) {
      out += lvMk('==') + '<mark class="lv-hl">' + lvInline(m[1]) + '</mark>' + lvMk('==');
      i += m[0].length; continue;
    }
    if (atWordStart && (m = /^https?:\/\/[^\s<>)\]]+/.exec(rest))) {
      out += '<span class="lv-url">' + lvEsc(m[0]) + '</span>'; i += m[0].length; continue;
    }
    /* Tag and mention are the graph, so they read as the graph here too —
       the same two colours the rendered view gives them. */
    if (atWordStart && (m = /^#[A-Za-z][\w\/-]*/.exec(rest))) {
      out += '<span class="lv-tag">' + lvEsc(m[0]) + '</span>'; i += m[0].length; continue;
    }
    if (atWordStart && (m = /^@[A-Za-z][\w\/-]*/.exec(rest))) {
      out += '<span class="lv-at">' + lvEsc(m[0]) + '</span>'; i += m[0].length; continue;
    }
    out += lvEsc(src[i]); i++;
  }
  return out;
}

/* One source line → one `.ln`. `inCode` threads the fence state down the
   document, because whether a line is code is not a property of the line. */
function lvLine(src, inCode, depth) {
  const el = document.createElement('div');
  el.className = 'ln';
  let code = inCode, html, m;

  if (LV_FENCE.test(src)) {
    code = !inCode;
    el.classList.add('ln-code');
    html = lvMk(src) || '<br>';
  } else if (inCode) {
    el.classList.add('ln-code');
    html = src === '' ? '<br>' : lvEsc(src);
  } else if ((m = /^(#{1,6})([ \t]+)(.*)$/.exec(src))) {
    el.classList.add('ln-h' + Math.min(m[1].length, 4));
    html = lvMk(m[1] + m[2]) + lvInline(m[3]);
  } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(src)) {
    el.classList.add('ln-hr');
    html = lvMk(src);
  } else if ((m = /^(\s*)(>+)([ \t]?)(.*)$/.exec(src))) {
    el.classList.add('ln-quote');
    html = lvMk(m[1] + m[2] + m[3]) + lvInline(m[4]);
  } else if ((m = LV_LIST.exec(src))) {
    const box = m[4] || '';
    el.classList.add(/\d/.test(m[2]) ? 'ln-ol' : 'ln-ul');
    if (/\[[xX]\]/.test(box)) el.classList.add('ln-done');
    el.style.setProperty('--lv-ind', depth || 0);
    html = '<span class="lv-mk lv-bullet">' + lvEsc(m[1] + m[2] + m[3]) + '</span>'
         + (box ? '<span class="lv-mk lv-box">' + lvEsc(box) + '</span>' : '')
         + lvInline(src.slice(m[0].length));
  } else if (src === '') {
    html = '<br>';
  } else {
    html = lvInline(src);
  }
  el.innerHTML = html;
  return { el, code };
}

/* The column an item's own text starts at. This is the number that decides
   nesting, and it is NOT a constant: `- ` is two, `1. ` is three, `10. ` is
   four. A checkbox is content, not marker, so it does not count. */
function lvContentCol(m) {
  return (m[1] + m[2] + m[3]).replace(/\t/g, "  ").length;
}
const lvIndentOf = (m) => m[1].replace(/\t/g, "  ").length;

/* Nesting depth per line, by CommonMark's rule: an item belongs to the
   innermost open item whose CONTENT COLUMN it reaches.

   The editor used to guess this as `floor(leadingSpaces / 2)`, which is right
   for bullets and wrong for every numbered list — two spaces under `1. ` does
   not reach column 3, so markdown-it flattens it while the editor happily drew
   a sub-point. The document then changed shape on the way to view mode, which
   is the one thing this editor exists to prevent. Now both agree, including
   when they agree that something is NOT nested. */
function lvDepths(lines) {
  const out = new Array(lines.length).fill(0);
  const stack = [];          // content columns of the open ancestor chain
  let code = false;
  for (let i = 0; i < lines.length; i++) {
    if (LV_FENCE.test(lines[i])) { code = !code; continue; }
    if (code) continue;
    const m = LV_LIST.exec(lines[i]);
    if (!m) {
      // A blank line does not close a list; anything else does.
      if (lines[i].trim() !== "") stack.length = 0;
      continue;
    }
    const ind = lvIndentOf(m);
    while (stack.length && ind < stack[stack.length - 1]) stack.pop();
    out[i] = stack.length;
    stack.push(lvContentCol(m));
  }
  return out;
}

/* How far to push line `i` so it nests under the item above it: exactly to
   that item's content column. Falls back to two, which is what a bullet needs
   and the only sane default when there is nothing above to nest under. */
function lvNestPad(lines, i) {
  const cur = LV_LIST.exec(lines[i]);
  const ind = cur ? lvIndentOf(cur) : 0;
  for (let k = i - 1; k >= 0; k--) {
    if (lines[k].trim() === "") continue;
    const m = LV_LIST.exec(lines[k]);
    if (!m) break;
    if (lvIndentOf(m) <= ind) return Math.max(1, lvContentCol(m) - ind);
  }
  return 2;
}

/* The indent to fall back to when outdenting: the nearest shallower item's,
   so Shift-Tab lands on a real level rather than two columns to the left of
   one. */
function lvOutdentTo(lines, i) {
  const cur = LV_LIST.exec(lines[i]);
  if (!cur) return 0;
  const ind = lvIndentOf(cur);
  for (let k = i - 1; k >= 0; k--) {
    if (lines[k].trim() === "") continue;
    const m = LV_LIST.exec(lines[k]);
    if (!m) break;
    const p = lvIndentOf(m);
    if (p < ind) return p;
  }
  return 0;
}

/* Which lines sit inside a fence. Cheap, and recomputed rather than cached:
   a stale code map decorates prose as code, and nothing tells you it did. */
function lvCodeAt(lines, upto) {
  let code = false;
  for (let i = 0; i < upto; i++) if (LV_FENCE.test(lines[i])) code = !code;
  return code;
}

/* Ordered lists are renumbered from the run the caret is in, one counter per
   indent level, so a new `3.` in the middle pushes the rest down instead of
   leaving two of them. A deeper level restarts at 1 and a shallower one
   discards the counters below it, which is what makes Tab feel like Tab. */
function lvRenumber(lines, at) {
  let s = at, e = at;
  while (s > 0 && LV_LIST.test(lines[s - 1])) s--;
  while (e < lines.length - 1 && LV_LIST.test(lines[e + 1])) e++;
  const counters = {};
  for (let i = s; i <= e; i++) {
    const m = LV_LIST.exec(lines[i]);
    if (!m) continue;
    const ind = m[1].replace(/\t/g, '  ').length;
    for (const k of Object.keys(counters)) if (+k > ind) delete counters[k];
    const om = /^(\d+)([.)])$/.exec(m[2]);
    if (!om) { delete counters[ind]; continue; }
    counters[ind] = (counters[ind] || 0) + 1;
    lines[i] = m[1] + counters[ind] + om[2] + m[3] + (m[4] || '') + lines[i].slice(m[0].length);
  }
  return lines;
}

function LiveSource(opts) {
  const { placeholder = '', minHeight = 240, onInput, onBlur } = opts;

  const root = h('div', { className: 'md-live' });
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('spellcheck', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  if (placeholder) root.setAttribute('data-ph', placeholder);
  root.style.minHeight = minHeight + 'px';

  let value = opts.value || '';
  const undo = [], redo = [];
  let burst = false, burstT = null, composing = false, lastDepths = [];

  const lines = () => value.split('\n');

  function render() {
    clear(root);
    const ls = lines();
    lastDepths = lvDepths(ls);
    let code = false;
    for (let i = 0; i < ls.length; i++) {
      const r = lvLine(ls[i], code, lastDepths[i]);
      code = r.code;
      root.appendChild(r.el);
    }
    if (!root.firstChild) root.appendChild(lvLine('', false, 0).el);
    root.classList.toggle('is-empty', value === '');
  }

  /* ── caret, measured in characters ─────────────────────────────────── */

  function lineIndex(node) {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    el = el && el.closest ? el.closest('.ln') : null;
    return el && el.parentElement === root
      ? Array.prototype.indexOf.call(root.children, el) : -1;
  }

  function posOf(container, offset) {
    if (!container || !root.contains(container)) return null;
    if (container === root) {
      const i = Math.max(0, Math.min(offset, root.children.length - 1));
      return { line: i, off: 0 };
    }
    const i = lineIndex(container);
    if (i < 0) return null;
    const pre = document.createRange();
    pre.selectNodeContents(root.children[i]);
    try { pre.setEnd(container, offset); } catch (_) { return null; }
    return { line: i, off: pre.toString().length };
  }

  function selRange() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const a = posOf(r.startContainer, r.startOffset);
    const b = posOf(r.endContainer, r.endOffset);
    return a && b ? { a, b, collapsed: r.collapsed } : null;
  }
  const caretNow = () => { const s = selRange(); return s ? s.a : null; };

  function setCaret(c) {
    if (!c) return;
    const el = root.children[Math.max(0, Math.min(c.line, root.children.length - 1))];
    if (!el) return;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n, acc = 0, target = null, toff = 0;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length;
      target = n; toff = len;
      if (acc + len >= c.off) { toff = c.off - acc; break; }
      acc += len;
    }
    const r = document.createRange();
    if (target) r.setStart(target, Math.max(0, Math.min(toff, target.nodeValue.length)));
    else r.selectNodeContents(el);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }

  const toAbs = (ls, c) => {
    let n = 0;
    for (let i = 0; i < c.line && i < ls.length; i++) n += ls[i].length + 1;
    return n + c.off;
  };
  const toPos = (ls, abs) => {
    let n = 0;
    for (let i = 0; i < ls.length; i++) {
      if (abs <= n + ls[i].length) return { line: i, off: abs - n };
      n += ls[i].length + 1;
    }
    return { line: ls.length - 1, off: ls[ls.length - 1].length };
  };

  /* ── undo, because reprogramming the DOM destroyed the browser's ───── */

  function snap() {
    const top = undo[undo.length - 1];
    if (top && top.text === value) return;
    undo.push({ text: value, caret: caretNow() });
    if (undo.length > 300) undo.shift();
    redo.length = 0;
  }
  function restore(from, to) {
    if (!from.length) return;
    const prev = from.pop();
    to.push({ text: value, caret: caretNow() });
    value = prev.text;
    render(); setCaret(prev.caret);
    onInput && onInput(value);
  }
  const doUndo = () => restore(undo, redo);
  const doRedo = () => restore(redo, undo);

  /* ── writing ───────────────────────────────────────────────────────── */

  function commit(text, caret) {
    value = text;
    render(); setCaret(caret);
    onInput && onInput(value);
  }
  /* Replace the selection with `ins` — the one path every command shares, so
     there is a single place where a selection is consumed. */
  function splice(ins, sr) {
    const ls = lines();
    const a = toAbs(ls, sr.a), b = toAbs(ls, sr.b);
    const text = ls.join('\n');
    const next = text.slice(0, a) + ins + text.slice(b);
    commit(next, toPos(next.split('\n'), a + ins.length));
  }

  function onEnter() {
    const sr = selRange(); if (!sr) return;
    snap();
    let ls = lines(), c = sr.a;
    if (!sr.collapsed) {
      const a = toAbs(ls, sr.a), b = toAbs(ls, sr.b);
      const t = ls.join('\n');
      const cut = t.slice(0, a) + t.slice(b);
      ls = cut.split('\n'); c = toPos(ls, a);
    }
    const cur = ls[c.line] || '';
    const inCode = lvCodeAt(ls, c.line);
    const m = inCode ? null : LV_LIST.exec(cur);

    if (m) {
      // Enter on an item with no text ends the list, one level at a time.
      if (!cur.slice(m[0].length).trim() && c.off >= m[0].length) {
        // Outdent to the level that actually exists above, not two columns left.
        const back = lvOutdentTo(ls, c.line);
        ls[c.line] = lvIndentOf(m) > 0
          ? ' '.repeat(back) + m[2] + m[3] + (m[4] || '')
          : '';
        lvRenumber(ls, c.line);
        commit(ls.join('\n'), { line: c.line, off: ls[c.line].length });
        return;
      }
      const om = /^(\d+)([.)])$/.exec(m[2]);
      const marker = om ? (parseInt(om[1], 10) + 1) + om[2] : m[2];
      const box = m[4] ? '[ ] ' : '';
      ls.splice(c.line, 1, cur.slice(0, c.off),
                m[1] + marker + m[3] + box + cur.slice(c.off));
      lvRenumber(ls, c.line + 1);
      // Re-measure after renumbering: `9.` becoming `10.` moves the text.
      const nm = LV_LIST.exec(ls[c.line + 1]);
      commit(ls.join('\n'), { line: c.line + 1, off: nm ? nm[0].length : 0 });
      return;
    }

    // A blockquote continues; anything else is a plain split.
    const q = inCode ? null : /^(\s*>+[ \t]?)/.exec(cur);
    // …and an empty quote line ends the quote, the way an empty item ends a
    // list. Without this the second Enter leaves a stray `> ` behind, which
    // is a line of markup the writer has to go back and delete.
    if (q && !cur.slice(q[1].length).trim() && c.off >= q[1].length) {
      ls[c.line] = '';
      commit(ls.join('\n'), { line: c.line, off: 0 });
      return;
    }
    const pre = q ? q[1] : '';
    ls.splice(c.line, 1, cur.slice(0, c.off), pre + cur.slice(c.off));
    commit(ls.join('\n'), { line: c.line + 1, off: pre.length });
  }

  function onTab(outdent) {
    const sr = selRange(); if (!sr) return;
    const ls = lines();
    const from = Math.min(sr.a.line, sr.b.line);
    const to = Math.max(sr.a.line, sr.b.line);
    const multi = from !== to || !sr.collapsed;

    // A lone caret on a line that is not a list item: Tab is just an indent.
    if (!multi && !LV_LIST.test(ls[from])) {
      snap();
      const abs = toAbs(ls, sr.a), t = ls.join('\n');
      if (outdent) {
        const line = ls[from];
        if (!/^[ \t]/.test(line)) return;
        const cut = /^\t/.test(line) ? 1 : Math.min(2, /^ */.exec(line)[0].length);
        ls[from] = line.slice(cut);
        commit(ls.join('\n'), { line: from, off: Math.max(0, sr.a.off - cut) });
      } else {
        const next = t.slice(0, abs) + '  ' + t.slice(abs);
        commit(next, toPos(next.split('\n'), abs + 2));
      }
      return;
    }

    snap();
    let delta = 0;
    for (let i = from; i <= to; i++) {
      const cur = LV_LIST.exec(ls[i]);
      if (outdent) {
        const cut = cur ? lvIndentOf(cur) - lvOutdentTo(ls, i)
                        : Math.min(2, /^[ \t]*/.exec(ls[i])[0].length);
        if (cut <= 0) continue;
        ls[i] = ls[i].slice(cut);
        if (i === sr.a.line) delta = -cut;
      } else {
        /* The width of the parent's marker, not two spaces. `- ` is two and
           `1. ` is three, so a fixed indent nests under bullets and silently
           fails under numbers — the bug that made sub-points vanish between
           the editor and the view. */
        const pad = ' '.repeat(Math.max(1, lvNestPad(ls, i)));
        ls[i] = pad + ls[i];
        if (i === sr.a.line) delta = pad.length;
      }
    }
    lvRenumber(ls, from);
    commit(ls.join('\n'), { line: sr.a.line, off: Math.max(0, sr.a.off + delta) });
  }

  /* Backspace with the caret just past a marker removes the marker rather
     than a space of it — otherwise unmaking a bullet takes three presses and
     leaves `-` behind on the way. */
  function onBackspace() {
    const sr = selRange();
    if (!sr || !sr.collapsed) return false;
    const ls = lines();
    const m = LV_LIST.exec(ls[sr.a.line] || '');
    if (!m || sr.a.off !== m[0].length || lvCodeAt(ls, sr.a.line)) return false;
    snap();
    ls[sr.a.line] = ls[sr.a.line].slice(m[0].length);
    lvRenumber(ls, sr.a.line);
    commit(ls.join('\n'), { line: sr.a.line, off: 0 });
    return true;
  }

  /* Make the selected lines a list of `kind`, or strip the markers if they
     already are one. The indent is preserved, so toggling a nested run keeps
     its shape — and renumbering runs after, so `1.` on four lines becomes
     1, 2, 3, 4 rather than four ones. */
  function toggleList(kind) {
    const sr = selRange(); if (!sr) return;
    snap();
    const ls = lines();
    const from = Math.min(sr.a.line, sr.b.line);
    const to = Math.max(sr.a.line, sr.b.line);
    const want = kind === '-' ? /^[-*+]$/ : /^\d+[.)]$/;
    // Already entirely this kind → this is an "off" press.
    let allSame = true;
    for (let i = from; i <= to; i++) {
      const m = LV_LIST.exec(ls[i]);
      if (!m || !want.test(m[2])) { allSame = false; break; }
    }
    let delta = 0;
    for (let i = from; i <= to; i++) {
      const m = LV_LIST.exec(ls[i]);
      if (allSame) {
        ls[i] = m[1] + ls[i].slice(m[0].length);
        if (i === sr.a.line) delta = -(m[0].length - m[1].length);
      } else if (m) {
        const marker = kind === '-' ? '-' : '1.';
        ls[i] = m[1] + marker + ' ' + (m[4] || '') + ls[i].slice(m[0].length);
        if (i === sr.a.line) delta = (marker.length + 1) - (m[0].length - m[1].length);
      } else {
        if (ls[i].trim() === '' && from !== to) continue;
        const ind = /^[ \t]*/.exec(ls[i])[0];
        const marker = kind === '-' ? '-' : '1.';
        ls[i] = ind + marker + ' ' + ls[i].slice(ind.length);
        if (i === sr.a.line) delta = marker.length + 1;
      }
    }
    if (!allSame) lvRenumber(ls, from);
    commit(ls.join('\n'), { line: sr.a.line, off: Math.max(0, sr.a.off + delta) });
  }

  function wrap(mark) {
    const sr = selRange(); if (!sr) return;
    snap();
    const ls = lines();
    const a = toAbs(ls, sr.a), b = toAbs(ls, sr.b);
    const t = ls.join('\n');
    const next = t.slice(0, a) + mark + t.slice(a, b) + mark + t.slice(b);
    const nl = next.split('\n');
    commit(next, toPos(nl, sr.collapsed ? a + mark.length : b + mark.length * 2));
  }

  /* ── events ────────────────────────────────────────────────────────── */

  root.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo') { e.preventDefault(); doUndo(); }
    else if (e.inputType === 'historyRedo') { e.preventDefault(); doRedo(); }
    // The browser would happily put a <b> in here. This is source text.
    else if (/^format/.test(e.inputType)) e.preventDefault();
  });

  root.addEventListener('input', (e) => {
    /* Mid-composition the browser owns this line: a Pinyin or Hangul buffer
       lives in the DOM as provisional text, and replacing the node under it
       cancels the compose. Read the text so nothing is lost, but leave the
       decoration until compositionend. */
    if (composing || e.isComposing) {
      value = Array.prototype.map.call(root.children, (el) => el.textContent).join('\n');
      onInput && onInput(value);
      return;
    }
    // `value` is still the pre-edit text, so this snapshot is the state to
    // come back to. One per burst of typing, not one per keystroke.
    if (!burst) { snap(); burst = true; }
    clearTimeout(burstT);
    burstT = setTimeout(() => { burst = false; }, 700);

    value = Array.prototype.map.call(root.children, (el) => el.textContent).join('\n');
    root.classList.toggle('is-empty', value === '');
    onInput && onInput(value);

    // Re-decorate. One line if the shape did not change, the document if it
    // did — a fence flips every line below it, so it can never be local.
    const c = caretNow();
    const ls = lines();
    /* One line is only safe to redraw alone when the nesting of every OTHER
       line is unchanged — typing a space at the head of an item re-parents
       everything under it, and a stale depth is the editor lying again. */
    const depths = lvDepths(ls);
    const shapeSame = depths.length === lastDepths.length
      && depths.every((d, i) => i === (c && c.line) || d === lastDepths[i]);
    if (c && ls.length === root.children.length && ls[c.line] != null
        && !LV_FENCE.test(ls[c.line]) && shapeSame) {
      const r = lvLine(ls[c.line], lvCodeAt(ls, c.line), depths[c.line]);
      root.replaceChild(r.el, root.children[c.line]);
      lastDepths = depths;
      setCaret(c);
    } else {
      render(); setCaret(c);
    }
  });

  root.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.preventDefault(); root.blur(); return; }
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return;
    }
    if (mod && e.key === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && !e.altKey && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault(); wrap(e.key === 'b' ? '**' : '*'); return;
    }
    /* There was no way to MAKE a list except typing the marker, which is fine
       on a fresh line and miserable inside one — to turn item 12 of a numbered
       list into a bullet you had to delete `12. ` first. ⌘⇧8 and ⌘⇧7 are the
       bindings every other editor uses for this. */
    if (mod && e.shiftKey && (e.key === '8' || e.key === '*')) {
      e.preventDefault(); toggleList('-'); return;
    }
    if (mod && e.shiftKey && (e.key === '7' || e.key === '&')) {
      e.preventDefault(); toggleList('1.'); return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod) { e.preventDefault(); onEnter(); return; }
    if (e.key === 'Tab') { e.preventDefault(); onTab(e.shiftKey); return; }
    if (e.key === 'Backspace' && !mod && onBackspace()) e.preventDefault();
  });

  root.addEventListener('paste', (e) => {
    e.preventDefault();
    const sr = selRange();
    const t = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!sr || !t) return;
    snap();
    splice(t.replace(/\r\n?/g, '\n'), sr);
  });

  root.addEventListener('compositionstart', () => { snap(); composing = true; });
  root.addEventListener('compositionend', () => {
    composing = false;
    const c = caretNow();
    render(); setCaret(c);
  });

  root.addEventListener('blur', () => { burst = false; onBlur && onBlur(); });

  render();

  return {
    el: root,
    get value() { return value; },
    set value(v) {
      const next = v || '';
      if (next === value) return;
      value = next; render();
    },
    focus(atEnd) {
      root.focus();
      const n = root.children.length - 1;
      if (atEnd && n >= 0) setCaret({ line: n, off: (lines()[n] || '').length });
    },
    blur() { root.blur(); },
  };
}

/* ── ProseEditor ────────────────────────────────────────────────────────
   ONE writing surface, used by every kind that holds prose.

   There were six. Three kinds (topic, markdown, project) had each grown
   their own view/edit toggle — same idea, three code paths, three different
   labels ("edit"/"done", "✎ edit", "Edit"/"Done") and three layouts. The
   other three (note default, snippet, bookmark context, about-me) had no
   rendered view at all: they were permanent mono textareas, so a bookmark's
   context — the user's own prose — sat in JetBrains Mono forever, breaking
   the system's one typographic rule that mono means machine text.

   The split that matters is preserved: the EDITOR is mono, because you are
   editing raw markdown and `##`, `-` and `[[…]]` are structure you need to
   see as characters. The VIEW is proportional, because it is prose. Toggling
   between them is the same gesture on every kind. */
function ProseEditor(opts) {
  const {
    getValue, setValue, placeholder = 'Write…',
    label = null, minHeight = 240, measure = true,
  } = opts;

  const wrap = h('div', { className: 'prose-editor' });
  const view = h('div', { className: 'md-rendered' + (measure ? '' : ' md-wide') });
  const src = LiveSource({
    placeholder,
    minHeight,
    value: getValue() || '',
    onInput: (text) => { setValue(text); schedule(); },
    /* Leaving the field IS finishing. The mode was previously exited by
       finding a "Done" button, which is the ceremony this editor is trying
       not to have — and it is also the moment the text should reach disk,
       so the blur both renders and commits rather than waiting out a timer. */
    onBlur: () => { if (mode === 'edit') setMode('view'); },
  });
  const ta = src.el;
  if (!measure) ta.classList.add('md-wide');

  let mode = (getValue() || '').trim() ? 'view' : 'edit';
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 350); };

  function setMode(next) { mode = next; apply(); }

  async function paint() {
    const body = (getValue() || '').trim();
    clear(view);
    if (!body) {
      view.appendChild(h('div', { className: 'prose-empty' },
        'Nothing written yet.'));
      return;
    }
    try {
      const r = SB.data().renderHtml(body);
      const rendered = h('div', { html: r.html });
      await getPageIndex();
      decorateMentions(rendered);
      decorateHashtags(rendered);
      view.appendChild(rendered);
    } catch (e) {
      view.appendChild(h('div', { className: 'prose-empty' },
        'Could not render: ' + (e.message || e)));
    }
  }

  const toggle = h('button', {
    className: 'md-mode-btn',
    // mousedown, not click: by the time `click` fires the textarea has already
    // blurred and put us back in view mode, so the button would toggle straight
    // back in and read as doing nothing.
    onMouseDown: (e) => { e.preventDefault(); setMode(mode === 'view' ? 'edit' : 'view'); },
  });

  /* Click the prose to edit the prose.
     Hunting for an Edit button to change a word is the ceremony; the text is
     already the thing you are pointing at. Links, mentions and hashtags keep
     their own click — you cannot follow a link if the paragraph swallows the
     press — and so does a real text selection, because dragging to select is
     not a request to edit. */
  view.addEventListener('mouseup', (e) => {
    if (mode === 'edit') return;
    if (e.target.closest && e.target.closest('a, .mention-link, .mention-chip, .hashtag, button')) return;
    const sel = window.getSelection();
    if (sel && String(sel).length) return;
    setMode('edit');
  });

  function apply() {
    const editing = mode === 'edit';
    wrap.classList.toggle('is-editing', editing);
    clear(toggle);
    toggle.appendChild(icon(editing ? 'check' : 'pen-line'));
    toggle.appendChild(document.createTextNode(editing ? 'Done' : 'Edit'));
    toggle.setAttribute('title', editing ? 'Finish editing' : 'Edit this text');
    if (!editing) {
      paint();
      // Leaving the field is a commit point: the debounce is for typing, not
      // for the gap between finishing and closing the tab.
      if (opts.onDone) opts.onDone();
    } else {
      // Caret at the end rather than at 0 — you are almost always adding.
      src.value = getValue() || '';
      setTimeout(() => src.focus(true), 0);
    }
  }

  wrap.appendChild(h('div', { className: 'prose-editor-hd' },
    label ? h('span', { className: 'prose-editor-l' }, label) : h('span'),
    toggle));
  wrap.appendChild(view);
  wrap.appendChild(ta);
  apply();
  return wrap;
}

function renderMarkdown(text) {
  if (text == null) return [];
  const raw = String(text);
  const out = [];
  // Pull fenced code blocks out first so their content isn't mangled by other rules.
  const parts = raw.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith('```')) {
      const inner = part.slice(3, -3).replace(/^[A-Za-z0-9_+\-]*\n/, '');  // strip optional language tag
      out.push(h('pre', { className: 'md-pre' }, h('code', null, inner.replace(/\n$/, ''))));
      continue;
    }
    // Split into block-level chunks on blank lines.
    const blocks = part.split(/\n{2,}/);
    for (let block of blocks) {
      block = block.replace(/\n+$/, '');
      if (!block.trim()) continue;
      const lines = block.split('\n');

      // Heading: # / ## / ### (only treat top-of-block lines)
      const hMatch = /^(#{1,3})\s+(.+)$/.exec(lines[0]);
      if (hMatch && lines.length === 1) {
        const level = hMatch[1].length;
        const tag = 'h' + (level + 1);  // h1→h2, h2→h3 to avoid clashing with page H1
        const el = document.createElement(tag);
        el.className = 'md-h md-h' + level;
        el.innerHTML = _inlineMarkdown(hMatch[2]);
        out.push(el);
        continue;
      }

      // Blockquote
      if (lines.every((l) => l.startsWith('>'))) {
        const inner = lines.map((l) => l.replace(/^>\s?/, '')).join('\n');
        const bq = document.createElement('blockquote');
        bq.className = 'md-quote';
        bq.innerHTML = _inlineMarkdown(inner).replace(/\n/g, '<br>');
        out.push(bq);
        continue;
      }

      // Unordered list
      if (lines.every((l) => /^[\-*+]\s+/.test(l))) {
        const ul = document.createElement('ul');
        ul.className = 'md-list';
        for (const l of lines) {
          const li = document.createElement('li');
          li.innerHTML = _inlineMarkdown(l.replace(/^[\-*+]\s+/, ''));
          ul.appendChild(li);
        }
        out.push(ul);
        continue;
      }

      // Ordered list
      if (lines.every((l) => /^\d+\.\s+/.test(l))) {
        const ol = document.createElement('ol');
        ol.className = 'md-list';
        for (const l of lines) {
          const li = document.createElement('li');
          li.innerHTML = _inlineMarkdown(l.replace(/^\d+\.\s+/, ''));
          ol.appendChild(li);
        }
        out.push(ol);
        continue;
      }

      // Default: paragraph with inline markdown + <br> for soft line breaks
      const p = document.createElement('p');
      p.className = 'md-p';
      p.innerHTML = _inlineMarkdown(lines.join(' \n')).replace(/\s*\n/g, '<br>');
      out.push(p);
    }
  }
  return out;
}




/* ── screen: Projects (containers — group anything under one project) ── */
function ProjectsScreen() {
  const wrap = h('div', { className: 'screen sb-pane projects-screen' });
  let projects = [];
  let busy = true;
  let counts = {};      // projectId → number of pages mentioning it

  async function load() {
    busy = true; layout();
    try {
      // `project` is not a kind — asking for one returned nothing, forever.
      // A project is a folder under `projects/` with a `<name>/<name>.md`
      // folder note, so the vault derives them from the tree.
      const data = await SB.data().projects();
      projects = data.items || [];
      projects.forEach((p) => { counts[p.id] = p.memberCount; });
    } catch (_) { projects = []; }
    busy = false;
    layout();
  }

  /* Opens the app's own picker, pre-stepped to the project-name field, rather
     than a browser prompt(). prompt() cannot be themed, cannot be styled, and
     drops the user into an OS dialog in the middle of an app that has spent
     some effort looking like itself. */
  function newProject() {
    app.createOpen = 'project';
    render();
  }

  /* The card shows the folder the way the folder shows itself: what is
     inside, by kind, and a glimpse of the actual pages. It was a name, a
     count and a timestamp — which distinguishes two projects exactly as well
     as two unlabelled boxes. (No status pill and no date line: neither value
     ever round-tripped to disk.) */
  function projectCard(p) {
    const members = p.inside || p.members || [];
    // Composition, in nav order: one glyph+count per kind present.
    const byKind = {};
    members.forEach((m) => {
      const meta = metaForPage(m);
      const key = meta === KIND_META.bookmark ? 'bookmark'
                : meta === KIND_META.drawing ? 'drawing' : m.kind;
      byKind[key] = (byKind[key] || 0) + 1;
    });
    const comp = KIND_ORDER.filter((k) => byKind[k]);

    return h('div', {
      className: 'project-card',
      onClick: (e) => {
        if (e.metaKey || e.ctrlKey) { newTab('page', p.id, { switchTo: true }); return; }
        const t = activeTab();
        if (t) { t.parentRoute = 'projects'; persistTabs(); }
        openPage(p.id);
      },
    },
      h('div', { className: 'project-card-hd' },
        h('span', { className: 'project-card-glyph' }, icon('folder')),
        h('div', { className: 'project-card-name' }, p.title || p.slug || 'Untitled project'),
        comp.length
          ? h('span', { className: 'project-card-comp' },
              comp.map((k) => h('span', {
                className: 'project-card-comp-k',
                style: { '--k-c': (KIND_META[k] || {}).color || 'var(--muted)' },
                title: nOf(byKind[k], (KIND_META[k] || {}).label || k,
                           ((KIND_META[k] || {}).label || k) + 's'),
              },
                icon((KIND_META[k] || {}).icon || 'file-text'),
                String(byKind[k]))))
          : null),
      members.length
        ? h('ul', { className: 'project-card-peek' },
            members.slice(0, 3).map((m) => h('li', { className: 'project-card-peek-row' },
              h('span', { className: 'project-card-peek-t' }, m.title || m.slug || '(untitled)'))),
            members.length > 3
              ? h('li', { className: 'project-card-peek-row project-card-peek-more' },
                  '+ ' + nOf(members.length - 3, 'more page', 'more pages'))
              : null)
        : h('div', { className: 'project-card-peek-empty' }, 'Empty — open it to add pages.'),
      h('div', { className: 'project-card-meta' },
        h('span', { 'data-pjcount': p.id },
          counts[p.id] != null
            ? (nOf(counts[p.id], 'page') + ' inside')
            : 'counting\u2026'),
        p.updated ? h('span', { className: 'project-card-when' }, fmtDate(p.updated)) : null));
  }

  function layout() {
    clear(wrap);
    const headerRow = h('div', { className: 'projects-hd' },
      h('div', null,
        h('h1', null, 'Projects'),
        h('p', { className: 'sb-sub' },
          busy ? 'loading…' : projects.length === 0
            ? 'no projects yet — projects are containers; create one and drop topics / canvases under it'
            : nOf(projects.length, 'project'))),
      h('div', { className: 'sb-row' },
        h('button', { className: 'sb-primary', onClick: newProject }, '+ new project')));

    append(wrap, [
      headerRow,
      busy
        ? h('div', { className: 'sb-meta' }, 'loading projects…')
        : (projects.length === 0
            ? EmptyState('No projects yet.',
                'Click "+ new project" to create one. Inside it you can attach topics, canvases — anything.')
            /* One grid. This used to group by status — "Active", "Paused",
               "Shipped" — which was the right idea for a project list and
               impossible in practice: status never reached disk, so every
               project landed in the same "No status" bucket and the heading
               was suppressed to hide it. Most recent first, which the vault
               does know. */
            : h('div', { className: 'projects-grid' },
                [...projects]
                  .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
                  .map(projectCard))),
    ]);
  }

  load();
  return wrap;
}




/* ── app root (v2) ────────────────────────────────────────────────────── */
// Light is the default, not System. System is the more fashionable default,
// but it means anyone whose OS is dark never sees the theme this app was
// designed around — and light IS the design here. System stays one click away
// for people who want it.
const TWEAK_DEFAULTS = { theme: 'light', density: 'cozy' };
function _newTabId() {
  return 'tab-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const app = {
  t: { ...TWEAK_DEFAULTS },
  // ── Tabs (Notion-style multi-tab work surface) ────────────────────────
  // app.route + app.openPageId mirror the *active* tab so existing code can
  // keep reading those two fields. Tab switches sync them.
  tabs: [{ id: 'tab-init', route: 'home', openPageId: null }],
  activeTabId: 'tab-init',
  route: 'home',                // home | pages | page | ask | graph | kind:<k> | …
  search: '',
  searchOpen: false,            // command-palette / quick-search modal
  openPageId: null,             // id of currently-open v2 page
  pendingFilter: null,
  kindCounts: {},
  recentPages: [],
  listCache: { kind: null, pages: [], stale: true },
  offline: false,
  loaded: false,
  createOpen: false,
  lastSynced: '',               // surfaced in sidebar footer
  navW: (() => { try { return Number(localStorage.getItem('sb.navW')) || 244; } catch (_) { return 244; } })(),
  navCollapsed: (() => { try { return localStorage.getItem('sb.navCollapsed') === '1'; } catch (_) { return false; } })(),
};
let currentMain = null;
const root = document.getElementById('root');

// The sidebar width is a live CSS variable rather than a constant baked into
// the grid templates, so dragging it costs one custom-property write and no
// re-render. Collapsing is a separate attribute: it swaps to an icon rail
// rather than animating the width to zero, because a 0px column would take
// the nav's borders and focus targets with it.
function applyNavW() {
  document.documentElement.style.setProperty('--nav-w', (app.navW || 244) + 'px');
}
function setNavCollapsed(v) {
  app.navCollapsed = !!v;
  try { localStorage.setItem('sb.navCollapsed', app.navCollapsed ? '1' : '0'); } catch (_) {}
  const el = document.querySelector('.app');
  if (el) el.setAttribute('data-nav', app.navCollapsed ? 'collapsed' : 'open');
}
function startNavResize(e, handle) {
  e.preventDefault();
  if (app.navCollapsed) return;
  const min = 190;
  const max = Math.min(420, Math.round(window.innerWidth * 0.4));
  handle.classList.add('dragging');
  document.body.classList.add('col-resizing');
  const onMove = (ev) => {
    app.navW = Math.max(min, Math.min(max, ev.clientX));
    applyNavW();
  };
  const onUp = () => {
    handle.classList.remove('dragging');
    document.body.classList.remove('col-resizing');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    try { localStorage.setItem('sb.navW', String(app.navW)); } catch (_) {}
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
/* The single writer for look-and-feel preferences.
   There used to be two: this one, which updated `app.t` in memory, and the
   Settings screen, which wrote localStorage. So a mode chosen from the
   sidebar looked applied and then vanished on reload, while the same choice
   made two clicks away in Settings stuck. Both now go through here, and
   `sb.prefs` is the one store. */
function setTweak(key, val) {
  app.t = { ...app.t, [key]: val };
  if (key === 'theme' || key === 'density') {
    applyHtmlAttrs();
    try {
      const p = loadPrefs();
      p[key] = val;
      savePrefs(p);
    } catch (_) { /* private mode / quota — the choice still applies for the session */ }
  }
  render();
}
/* ── Colour modes ───────────────────────────────────────────────────────
   Four palettes across two families, plus System. `swatch` is the pair the
   picker paints — page colour and ink — so the control shows you the actual
   mode rather than naming it and hoping.

   Adding a fifth is six CSS lines and one row here; see DESIGN.md. */
const THEMES = [
  { id: 'system',   label: 'System',   family: null,   swatch: null },
  { id: 'light',    label: 'Light',    family: 'light', swatch: ['#faf9f8', '#1c1917'] },
  { id: 'sepia',    label: 'Sepia',    family: 'light', swatch: ['#f2e9d8', '#1f1a12'] },
  { id: 'dark',     label: 'Dark',     family: 'dark',  swatch: ['#09090b', '#fafafa'] },
  { id: 'midnight', label: 'Midnight', family: 'dark',  swatch: ['#0b1020', '#f5f7fa'] },
];
const THEME_IDS = THEMES.map((t) => t.id);

/* "System" is a preference, not a theme — it has to resolve to a real one at
   paint time, and re-resolve when the OS flips while the app is open. */
function prefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
  catch (_) { return false; }
}
function resolveTheme(pref) {
  if (pref === 'system' || !pref) return prefersDark() ? 'dark' : 'light';
  return THEME_IDS.includes(pref) ? pref : 'light';
}
/* Four modes, two families. Anything asking "is this a dark surface?" — a
   vendored editor with its own two-value theme, an embedded document — has to
   ask this, not compare against the string 'light', or Sepia comes out dark. */
function themeFamily() {
  const t = THEMES.find((x) => x.id === document.documentElement.getAttribute('data-theme'));
  return (t && t.family) || (prefersDark() ? 'dark' : 'light');
}
try {
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (app.t.theme === 'system') applyHtmlAttrs(); });
} catch (_) {}

function applyHtmlAttrs() {
  const resolved = resolveTheme(app.t.theme);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-density', app.t.density || 'cozy');
  // Keep the browser chrome in step with the mode — otherwise the address bar
  // stays light while the app is midnight.
  const meta = THEMES.find((t) => t.id === resolved);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  if (meta && meta.swatch) {
    const m = document.createElement('meta');
    m.setAttribute('name', 'theme-color');
    m.setAttribute('content', meta.swatch[0]);
    document.head.appendChild(m);
  }
}
/* ── Hash-based routing ─────────────────────────────────────────────
   URL format:
     #home              → home
     #pages             → all pages
     #kind:canvas       → kind tab
     #page/<id>         → a specific page
     #ask               → ask widget
     #graph / #about-me / #mention-tags / #import
   We use hashes so the SPA works without any server-side rewrite. */
function routeToHash(r, openPageId) {
  if (r === 'page' && openPageId) return '#page/' + openPageId;
  return '#' + r;
}
function hashToRoute(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (!h) return { route: 'home', openPageId: null };
  if (h.startsWith('page/')) return { route: 'page', openPageId: h.slice(5) };
  return { route: h, openPageId: null };
}

// ── Tab helpers ──────────────────────────────────────────────────────────
// Tabs are persisted to localStorage so a reload restores your work surface.
// All routing (setRoute, openPage, popstate) keeps the active tab in sync.
function activeTab() {
  return app.tabs.find((t) => t.id === app.activeTabId) || app.tabs[0];
}

function persistTabs() {
  try {
    localStorage.setItem('sb.tabs', JSON.stringify({
      tabs: app.tabs.map((t) => ({
        id: t.id, route: t.route, openPageId: t.openPageId,
        parentRoute: t.parentRoute || null,
        title: t.title || null,
      })),
      activeTabId: app.activeTabId,
    }));
  } catch (_) {}
}

function loadTabs() {
  try {
    const raw = localStorage.getItem('sb.tabs');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.tabs) || s.tabs.length === 0) return false;
    // Sanitize: keep only well-formed records.
    const clean = s.tabs.filter((t) => t && t.id && typeof t.route === 'string');
    if (clean.length === 0) return false;
    app.tabs = clean;
    app.activeTabId = s.activeTabId && clean.find((t) => t.id === s.activeTabId)
      ? s.activeTabId
      : clean[0].id;
    const t = activeTab();
    app.route = t.route;
    app.openPageId = t.openPageId;
    return true;
  } catch (_) { return false; }
}

function tabLabel(t) {
  if (t.route === 'page' && t.openPageId) {
    // Recorded on the tab by noteTabTitle, so it survives a reload and an
    // evicted cache. The cache is the fallback; the ULID is the last resort.
    if (t.title) return t.title;
    const cached = (typeof cacheGetPage === 'function') ? cacheGetPage(t.openPageId) : null;
    if (cached && (cached.title || cached.slug)) return cached.title || cached.slug;
    return 'Page · ' + t.openPageId.slice(0, 6);
  }
  const r = t.route;
  if (r === 'home') return 'Home';
  if (r === 'pages') return 'All pages';
  if (r === 'about-me') return 'About me';
  if (r === 'tags') return 'Tags';
  if (r === 'projects') return 'Projects';
  if (r.startsWith('kind:')) {
    const k = r.slice(5);
    return (KIND_META[k] && KIND_META[k].label) || k;
  }
  if (r.startsWith('tag:')) return '#' + r.slice(4);
  if (r.startsWith('mention:')) return '@' + r.slice(8);
  return r;
}

function newTab(route, openPageId, opts) {
  opts = opts || {};
  const t = { id: _newTabId(), route: route || 'home', openPageId: openPageId || null };
  app.tabs.push(t);
  if (opts.switchTo !== false) {
    app.activeTabId = t.id;
    app.route = t.route;
    app.openPageId = t.openPageId;
  }
  persistTabs();
  if (opts.switchTo !== false) {
    pushHash(t.route, t.openPageId);
    render();
  }
  return t;
}

function closeTab(id) {
  const idx = app.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  app.tabs.splice(idx, 1);
  if (app.tabs.length === 0) {
    app.tabs.push({ id: _newTabId(), route: 'home', openPageId: null });
  }
  if (app.activeTabId === id) {
    const next = app.tabs[Math.max(0, idx - 1)] || app.tabs[0];
    app.activeTabId = next.id;
    app.route = next.route;
    app.openPageId = next.openPageId;
    pushHash(next.route, next.openPageId);
  }
  persistTabs();
  render();
}

function switchTab(id) {
  const t = app.tabs.find((x) => x.id === id);
  if (!t) return;
  app.activeTabId = id;
  app.route = t.route;
  app.openPageId = t.openPageId;
  persistTabs();
  pushHash(t.route, t.openPageId);
  render();
}

function _syncActiveTab() {
  const t = activeTab();
  if (!t) return;
  t.route = app.route;
  // The recorded name belongs to the page that was open. Point the tab
  // somewhere else and the name has to go with it, or the strip lies.
  if (t.openPageId !== app.openPageId) t.title = null;
  t.openPageId = app.openPageId;
  persistTabs();
}
let _suppressHashPush = false;
function setRoute(r) {
  app.route = r;
  // setRoute always clears openPageId — switching screens unloads the page view.
  // (openPage() handles the page-detail case and sets openPageId itself.)
  if (r !== 'page') app.openPageId = null;
  _syncActiveTab();
  if (r.startsWith('kind:')) app.listCache.stale = true;
  if (r === 'pages') app.listCache.stale = true;
  if (r === 'home') {
    Promise.all([refreshCounts(), refreshRecent()]).then(render);
  }
  pushHash(r, app.openPageId);
  render();
}
function pushHash(r, openPageId) {
  if (_suppressHashPush) return;
  const target = routeToHash(r, openPageId);
  if (location.hash !== target) history.pushState({ r, openPageId }, '', target);
}
window.addEventListener('popstate', () => {
  _suppressHashPush = true;
  try {
    const { route, openPageId } = hashToRoute(location.hash);
    app.route = route;
    app.openPageId = openPageId;
    _syncActiveTab();
    if (route === 'home') Promise.all([refreshCounts(), refreshRecent()]).then(render);
    render();
  } finally { _suppressHashPush = false; }
});
function submitSearch(q) {
  // 'ask' was one of the screens the migration removed, and nothing renders it,
  // so Enter used to drop the user on the dashboard under an `~/ask` crumb with
  // no explanation. Search now opens the full list filtered by what was typed.
  app.pendingFilter = q;
  setRoute('pages');
}

/* Search opens its results in their own tab: the tab you searched from keeps
   what it had. If some tab already shows the page, focus that one instead of
   minting a duplicate — searching for the same page twice should not cost two
   tabs. */
function openPageTab(id) {
  const existing = app.tabs.find((t) => t.route === 'page' && t.openPageId === id);
  if (existing) { switchTab(existing.id); return; }
  newTab('page', id, { switchTo: true });
}

function openPage(id, opts) {
  opts = opts || {};
  // Cmd / Ctrl click → open the page in a new tab without disturbing this one.
  if (opts.newTab) {
    newTab('page', id, { switchTo: true });
    return;
  }
  // Capture the route we're navigating *from* before we overwrite app.route.
  // Page → page navigation (clicking a [[wikilink]] inside an open page)
  // keeps the existing parentRoute — we want crumbs to still point at the
  // list view, not at the previous page.
  const fromRoute = app.route;
  if (fromRoute && fromRoute !== 'page') app._returnRoute = fromRoute;
  app.openPageId = id;
  app.route = 'page';
  const t = activeTab();
  if (t) {
    t.route = 'page';
    if (t.openPageId !== id) t.title = null;
    t.openPageId = id;
    if (fromRoute && fromRoute !== 'page') t.parentRoute = fromRoute;
    persistTabs();
  }
  pushHash('page', id);
  render();
}

function _fmtTimeAgo() {
  const d = new Date();
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function refreshCounts() {
  try {
    const { counts } = SB.data().counts();
    app.kindCounts = counts || {};
    // The true page count, for the sidebar header. Summing the by-kind
    // counts double-counts bookmarks, which are notes with a url rather
    // than a kind of their own.
    try {
      const all = SB.data().pages({ limit: 5000 });
      const items = (all && all.items) || [];
      app.stats = { pages_total: items.length };
    } catch (_) {}
    app.lastSynced = _fmtTimeAgo();
  } catch (_) {}
}
async function refreshRecent() {
  try {
    const { items } = SB.data().pages({ limit: 12 });
    app.recentPages = items || [];
    // Seed page cache so clicking a recent tile is instant.
    (items || []).forEach((p) => cacheSetPage(p));
  } catch (_) {}
}

async function createPage(kind, name) {
  app.createOpen = false;
  try {
    // A project is a folder, not a kind, so it takes a different call — but
    // that is the data layer's business, not the picker's. From the user's
    // side it is one more thing you can create.
    const p = kind === 'project'
      ? await SB.data().createProject(name)
      : await SB.data().createPage({ kind, title: '', body: '' });
    if (p && p.ok === false) throw new Error(p.message || p.reason || 'refused');
    if (!p || !p.id) throw new Error('no page id came back — ' + JSON.stringify(p).slice(0, 180));
    invalidatePageIndex();
    cacheSetPage(p);
    await refreshCounts();
    openPage(p.id);
  } catch (e) {
    toast('Could not create that — ' + e.message, { tone: 'error' });
    render();
  }
}

// Work mode is project-first: the entry point is creating a project, which
// opens as a workspace where IA / flows / screens / components / tokens are

// Render a label for the parent-route portion of a page crumb chain.
// Returns the array of intermediate crumbs (between `~` and the page title).
/* A `kind:` route id is internal — `kind:drawing` is the facet the UI calls
   Board, and the crumb used to print the raw id, so the trail read
   "pages / drawing / Sewing Order" under a page wearing a Board pill. The
   label comes from the same place every other label does. Lowercased because
   the crumb row is lowercase throughout; an unknown kind falls back to its own
   id rather than to nothing. */
function kindCrumbLabel(kind) {
  const meta = (kind === 'drawing') ? DRAWING_META : KIND_META[kind];
  return ((meta && meta.label) || kind).toLowerCase();
}

function _parentCrumbsFor(parent) {
  if (!parent || parent === 'pages' || parent === 'home') {
    return [{ label: 'pages', route: 'pages' }];
  }
  if (parent === 'projects') {
    return [{ label: 'projects', route: 'projects' }];
  }
  if (parent && parent.startsWith('project:')) {
    // page that lives inside a specific project — show the project's title
    const projectId = parent.slice(8);
    const cached = (typeof cacheGetPage === 'function') ? cacheGetPage(projectId) : null;
    const label = (cached && (cached.title || cached.slug)) || 'project';
    return [
      { label: 'projects', route: 'projects' },
      { label, route: 'page', openPageId: projectId },
    ];
  }
  if (parent.startsWith('kind:')) {
    return [
      { label: 'pages', route: 'pages' },
      { label: kindCrumbLabel(parent.slice(5)), route: parent },
    ];
  }
  if (parent.startsWith('tag:')) {
    return [
      { label: 'tags', route: 'tags' },
      { label: '#' + parent.slice(4), route: parent },
    ];
  }
  if (parent === 'tags') return [{ label: 'tags', route: 'tags' }];
  if (parent.startsWith('mention:')) {
    return [
      { label: 'mention tags', route: 'mention-tags' },
      { label: '@' + parent.slice(8), route: parent },
    ];
  }
  if (parent === 'mention-tags') return [{ label: 'mention tags', route: 'mention-tags' }];
  return null;
}

/* A breadcrumb is a containment claim, not a history trail. Only these routes
   are places a page can be *in*; arriving from anywhere else — Settings, About
   me, the dashboard — used to be reported as "settings / Bindery", which says
   the page lives in Settings. */
function routeContainsPages(r) {
  // `tag:x` lists pages; `tags` lists tags. Only the first is somewhere a page
  // can be. Same for `mention:` versus `mention-tags`.
  return !!r && (r === 'pages' || r === 'projects' || r.startsWith('project:')
    || r.startsWith('kind:') || r.startsWith('tag:') || r.startsWith('mention:'));
}

/* Where the page actually lives, for when the route you came from cannot say. */
function containerRouteOf(p) {
  if (!p) return 'pages';
  if (/^projects\/[^/]+\//.test(String(p.path || ''))) return 'projects';
  const m = metaForPage(p);
  const k = m === KIND_META.bookmark ? 'bookmark'
          : m === KIND_META.drawing ? 'drawing'
          : p.kind;
  return KIND_ORDER.includes(k) ? 'kind:' + k : 'pages';
}

function crumbsFor(route) {
  const home = { label: '~', route: 'home' };
  if (route === 'home') return [home, 'home'];
  if (route === 'pages') return [home, 'pages'];
  if (route === 'projects') return [home, 'projects'];
  if (route === 'settings') return [home, 'settings'];
  if (route === 'page') {
    // Build chain: ~ / <parent-chain> / <page title>
    const t = activeTab();
    // Resolve the page title from cache when we have it; fall back to the
    // id prefix and let V2PageView patch the DOM once it loads.
    const cached = (typeof cacheGetPage === 'function' && app.openPageId)
      ? cacheGetPage(app.openPageId) : null;
    const recorded = t && t.parentRoute;
    const parent = routeContainsPages(recorded) ? recorded : containerRouteOf(cached);
    const chain = [home, ...(_parentCrumbsFor(parent) || _parentCrumbsFor('pages'))];
    const title = (cached && (cached.title || cached.slug)) ||
                  (app.openPageId ? app.openPageId.slice(0, 8) + '…' : '?');
    chain.push(title);
    return chain;
  }
  if (route.startsWith('kind:')) {
    return [home, { label: 'pages', route: 'pages' }, kindCrumbLabel(route.slice(5))];
  }
  if (route === 'tags') return [home, 'tags'];
  if (route.startsWith('tag:')) {
    return [home, { label: 'tags', route: 'tags' }, '#' + route.slice(4)];
  }
  if (route === 'mention-tags') return [home, 'mention tags'];
  if (route.startsWith('mention:')) {
    return [home, { label: 'mention tags', route: 'mention-tags' }, '@' + route.slice(8)];
  }
  return [home, route];
}

// Settings — model / provider / API keys (with env-lock awareness) + a
// copy-paste MCP connect panel. Talks to /api/v2/settings*. Model save/layout
// pattern mirrors AboutMeScreen.
/* ── Settings (6.17) ───────────────────────────────────────────────
   Everything server-shaped is gone: model, provider, MCP, storage backend and
   API token had a backend to talk to and no longer do. What is left is genuinely
   local preference, and it is stored in localStorage — never in the vault, because
   the vault belongs equally to Obsidian and to your agent, and neither of them
   should have to read this app's UI state. */
const SB_PREFS_KEY = 'sb.prefs';
const SB_PREF_DEFAULTS = {
  theme: 'light',
  density: 'cozy',
  historyKeep: 10,
  obsidianVault: '',       // blank = derive from the picked folder
  thumbCacheOn: true,
  welcomeSeen: false,      // the first-run card on the dashboard
  tagColors: {},           // tag name → hue index; absent means derive from the name
  tourSeen: false,         // the stepped tour — runs once, replayable from Settings
};
function loadPrefs() {
  try {
    return { ...SB_PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(SB_PREFS_KEY) || '{}') };
  } catch (_) { return { ...SB_PREF_DEFAULTS }; }
}
function savePrefs(p) {
  try { localStorage.setItem(SB_PREFS_KEY, JSON.stringify(p)); } catch (_) {}
  if (window.SB_VAULT) window.SB_VAULT.historyKeep = p.historyKeep;
}

function SettingsScreen() {
  const wrap = h('div', { className: 'screen settings' });
  let prefs = loadPrefs();

  const section = (title, sub, ...rows) => h('div', { className: 'set-sec' },
    h('div', { className: 'set-sec-hd' }, h('b', null, title),
      sub ? h('span', { className: 'set-sec-sub' }, sub) : null),
    ...rows);

  // Every settings row is built here, so the label association is made here
  // too — a row's text is its control's name, and a screen reader had no way
  // to know that from a sibling <div>. The hint becomes the description.
  const row = (label, hint, control) => {
    const native = control && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName || '');
    // A radiogroup cannot be the target of `for`; it takes aria-labelledby.
    const group = !native && control && control.getAttribute
      && control.getAttribute('role') === 'radiogroup';
    if ((native || group) && !control.id) control.id = 'set-' + (++row._n);
    const hintEl = hint ? h('div', { className: 'set-row-hint' }, hint) : null;
    if ((native || group) && hintEl) {
      hintEl.id = control.id + '-hint';
      control.setAttribute('aria-describedby', hintEl.id);
    }
    const labelEl = h(native ? 'label' : 'div',
      native ? { className: 'set-row-label', for: control.id }
             : { className: 'set-row-label' },
      label);
    if (group) {
      labelEl.id = control.id + '-label';
      control.setAttribute('aria-labelledby', labelEl.id);
      control.removeAttribute('aria-label');   // the visible label is the name
    }
    return h('div', { className: 'set-row' },
      h('div', { className: 'set-row-l' }, labelEl, hintEl),
      h('div', { className: 'set-row-c' }, control));
  };
  row._n = 0;

  /* Options take `[value, label]` pairs. They used to be bare strings used as
     both, so the one screen where you choose your colour mode offered
     "midnight" and "cozy" in lowercase while the swatch row two panels away
     called them Midnight and Cozy. */
  const select = (key, options) => h('select', {
    className: 'set-input',
    onChange: (e) => { prefs[key] = e.target.value; savePrefs(prefs); applyHtmlAttrs2(); },
  }, options.map(([v, l]) => h('option', { value: v, selected: prefs[key] === v }, l)));

  function applyHtmlAttrs2() {
    document.documentElement.setAttribute('data-theme', prefs.theme);
    document.documentElement.setAttribute('data-density', prefs.density);
    app.t.theme = prefs.theme; app.t.density = prefs.density;
  }

  const vaultName = window.SB_VAULT_NAME || '(not connected)';

  wrap.appendChild(h('div', { className: 'screen-hd' },
    h('h1', null, 'Settings'),
    h('div', { className: 'screen-sub' },
      'Local preferences only. Nothing here is written into your vault.')));

  /* This button was `location.reload()`. With the folder grant still live that
     reloads straight back into the same vault: no dialog, no message, nothing
     visibly different — a control that looks broken because you cannot tell it
     ran. Now it opens the folder picker and says what happened, every time,
     including the two ways it can decline. */
  const connected = vaultName !== '(not connected)';
  const vaultBtn = h('button', { className: 'btn' }, connected ? 'reconnect…' : 'connect…');
  const runConnect = async (opts = {}) => {
    if (vaultBtn.disabled) return;
    const label = vaultBtn.textContent;
    vaultBtn.disabled = true;
    vaultBtn.textContent = 'Choose a folder…';
    try {
      if (typeof window.SB_RECONNECT !== 'function') { location.reload(); return; }
      const r = await window.SB_RECONNECT({ pick: true, quiet: true, ...opts });
      if (r && r.ok) {
        toast('Connected to ' + (r.name || 'your vault'));
        render();
        return;
      }
      if (r && r.cancelled) {
        toast(connected ? 'Still connected to ' + vaultName + ' — no folder was picked.'
                        : 'No folder picked.');
        return;
      }
      toast((r && r.reason) || 'That folder could not be opened as a vault.', Object.assign(
        { tone: 'error' },
        r && r.adoptable
          ? { actionLabel: 'Use it anyway', onAction: () => runConnect({ adopt: true }) }
          : {}));
    } catch (e) {
      toast('Could not connect — ' + e.message, { tone: 'error' });
    } finally {
      vaultBtn.disabled = false;
      vaultBtn.textContent = label;
    }
  };
  vaultBtn.onclick = () => runConnect();

  /* The check. The clipper's setup page has answered "is it actually
     connected?" out loud since it was written; the app never did, so a lapsed
     grant, a read-only second tab and a folder that is simply empty all looked
     identical from in here — nothing happening, no reason given. It only
     reads: a diagnostic must not be the thing that touches your notes. */
  /* The clipper panel is built further down — it needs `row` — but the Vault
     section points at it, so the slot it lands in is declared up here. */
  const clipperSlot = h('div');

  const checkOut = h('div', { className: 'set-check', style: { display: 'none' } });
  const checkBtn = h('button', { className: 'btn' }, 'Check connection');
  const paintCheck = (r) => {
    clear(checkOut);
    checkOut.style.display = '';
    (r.steps || []).forEach((st) => {
      checkOut.appendChild(h('div', { className: 'set-check-row' },
        h('span', { className: 'set-check-mark', 'data-ok': st.ok ? '1' : '0' },
          st.ok ? '\u2713' : '\u2715'),
        h('span', { className: 'set-check-name' }, st.name),
        h('span', { className: 'set-check-detail' }, st.detail)));
    });
    checkOut.appendChild(h('div', { className: 'set-check-foot' },
      r.ok ? 'Everything the app needs in order to write is in place.'
           : 'The first line with a cross is the one to fix.'));
  };
  checkBtn.onclick = async () => {
    if (typeof window.SB_CHECK !== 'function') {
      toast('The data layer is not standing — reload the app.', { tone: 'error' });
      return;
    }
    const label = checkBtn.textContent;
    checkBtn.disabled = true; checkBtn.textContent = 'Reading the folder…';
    try {
      paintCheck(await window.SB_CHECK());
    } catch (e) {
      toast('The check itself failed — ' + e.message, { tone: 'error' });
    } finally {
      checkBtn.disabled = false; checkBtn.textContent = label;
    }
  };

  wrap.appendChild(section('Vault', 'the folder this app reads and writes',
    row('Connected folder',
      window.SB_DEMO ? 'The demo vault — invented pages held in memory, not a folder.'
        : connected ? vaultName + ' — everything stays on your disk.'
        : 'No folder connected yet.',
      vaultBtn),
    row('Obsidian vault name',
      'Used for obsidian:// deep links. Blank derives it from the folder you picked.',
      h('input', {
        className: 'set-input', value: prefs.obsidianVault,
        placeholder: vaultName,
        onInput: (e) => {
          prefs.obsidianVault = e.target.value.trim();
          savePrefs(prefs);
          window.SB_VAULT_NAME = prefs.obsidianVault || window.SB_VAULT_NAME;
        },
      })),
    (() => {
      /* Only when there is something to fix. A row reading "0 problems" is
         furniture; the vault having nothing wrong with it is not news. */
      const probs = (window.SB_VAULT && window.SB_VAULT.problems) || [];
      if (!probs.length) return null;
      const names = probs.filter((p) => p.type !== 'unreadable').length;
      return row('Vault problems',
        (names ? `${names} name collision${names === 1 ? '' : 's'}` : '')
        + (names && probs.length > names ? ', and ' : '')
        + (probs.length > names
            ? `${probs.length - names} file${probs.length - names === 1 ? '' : 's'} that could not be read`
            : '')
        + '. Ambiguous names break [[wikilinks]] here and in Obsidian — fix them from one list.',
        h('button', { className: 'btn', onClick: () => problemsDialog() }, 'Resolve…'));
    })(),
    row('Is it connected?',
      'Asks every question that stands between a click and a written file, and '
      + 'answers each one. Reads the folder; never writes to it.',
      checkBtn),
    checkOut,
    /* Said here because the opposite is the natural assumption, and acting on
       it means closing the app to make the clipper work. They are two origins
       with two folder grants and two copies of the data layer — neither waits
       for the other. */
    row('The Chrome clipper',
      'Connects to the same folder separately, with its own permission. Both can be '
      + 'connected at once — you never have to close one for the other.',
      h('button', {
        className: 'btn',
        onClick: () => {
          const el = clipperSlot.querySelector('.set-sec') || clipperSlot;
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, 'set it up'))));

  /* BUILT below (it needs `row`), but it belongs here —
     second, under the vault it writes into. It was under Appearance, three
     scrolls down and shaped like a preference, and the one person who went
     looking for it did not find it. A thing you install is not a setting. */
  wrap.appendChild(clipperSlot);

  wrap.appendChild(section('Getting around', 'how this app works, in seven steps',
    row('The tour', 'Points at each control as it explains it. Runs once on a new vault.',
      h('button', {
        className: 'btn',
        onClick: () => { app.route = 'home'; render(); setTimeout(() => startTour(0), 80); },
      }, 'Take the tour'))));

  /* ── The clipper ──────────────────────────────────────────────────────
     Not a Web Store listing, so not one click — and the panel says so rather
     than pretending. What it can do is remove every other obstacle: build the
     zip of just the extension, name the folder to pick, and copy the
     `chrome://` address the browser refuses to let a page link to. */
  const clipperSteps = [
    ['Unzip it', `You get a folder called ${CLIPPER_DIR}.`],
    ['Open the extensions page', 'Chrome blocks links to chrome:// — copy it above and paste it in a new tab.'],
    ['Turn on Developer mode, then Load unpacked', `Pick the ${CLIPPER_DIR} folder itself.`],
    ['Choose your vault', 'The clipper opens its own setup page and asks for one thing: the same folder you opened here. Pin its toolbar icon while you are there.'],
  ];
  const copyBtn = h('button', {
    className: 'btn',
    onClick: async (e) => {
      const b = e.currentTarget;
      try {
        await navigator.clipboard.writeText(CLIPPER_EXT_PAGE);
        b.textContent = 'copied';
        setTimeout(() => { b.textContent = 'copy address'; }, 1400);
      } catch (_) {
        // Clipboard can be refused (permissions, insecure context). Say so
        // rather than flashing a success the user cannot verify.
        toast('Could not copy — the address is ' + CLIPPER_EXT_PAGE, { tone: 'error' });
      }
    },
  }, 'copy address');

  /* Built on click, not on load: the bundle is ~310KB of base64 and most
     visits never touch it. Dynamically imported for the same reason
     demo-vault.js is. */
  const dlBtn = h('button', { className: 'btn-primary set-dl' },
    icon('download'), 'Download .zip');
  dlBtn.addEventListener('click', async () => {
    if (dlBtn.disabled) return;
    dlBtn.disabled = true;
    const restore = (label) => {
      clear(dlBtn);
      dlBtn.appendChild(icon('download'));
      dlBtn.appendChild(document.createTextNode(label));
      dlBtn.disabled = false;
    };
    clear(dlBtn); dlBtn.appendChild(document.createTextNode('building…'));
    try {
      const v = window.SB_ASSET_V ? `?v=${window.SB_ASSET_V}` : '';
      const [{ zip, fromBase64 }, { CLIPPER_BUNDLE }] = await Promise.all([
        import(`./clipper/zip.js${v}`),
        import(`./clipper/bundle.js${v}`),
      ]);
      // Everything nests under one named folder, so unzipping always yields a
      // folder Chrome can be pointed at — rather than 23 loose files landing
      // in Downloads, which is what a flat archive does on some unzippers.
      const bytes = zip(CLIPPER_BUNDLE.map(([name, b64]) =>
        ({ name: `${CLIPPER_DIR}/${name}`, data: fromBase64(b64) })));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${CLIPPER_DIR}.zip`;
      // In the document, because a detached anchor's click is ignored in
      // enough browsers to matter, and this is a quarter of a megabyte the
      // user is waiting on.
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // NOT revoked on the next line. The save reads from the object URL
      // after click() returns, and revoking synchronously races it — for a
      // 238KB blob that race is winnable, which is the worst kind of bug.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      restore('Download again');
    } catch (e) {
      toast('Could not build the zip — ' + (e.message || e), { tone: 'error' });
      restore('Download .zip');
    }
  });

  const clipperSec = section('The clipper', 'a Chrome extension that saves images, links and quotes into this vault',
    row('Get the files',
      'Chrome only allows one-click installs from its Web Store, and this is not listed there. '
      + 'So: download the extension, then three steps.',
      dlBtn),
    row(h('span', null, 'Extensions page ',
          h('code', { className: 'set-code' }, CLIPPER_EXT_PAGE)),
      'Paste this into a new tab — a web page is not allowed to open it for you.',
      copyBtn),
    h('ol', { className: 'set-steps' },
      clipperSteps.map(([t, d]) => h('li', null,
        h('span', { className: 'set-step-t' }, t),
        h('span', { className: 'set-step-d' }, d)))),
    row('What it does', 'It writes through the same safety as the app: history snapshots, '
      + 'conflict checks, and it will never turn a folder into a vault by mistake.',
      h('a', { className: 'btn', href: CLIPPER_HELP, target: '_blank', rel: 'noopener noreferrer' },
        'Read the docs')));
  clipperSec.id = 'set-clipper';
  clipperSec.classList.add('set-sec-feature');
  clipperSlot.appendChild(clipperSec);

  /* Arriving from the sidebar's Clipper row: bring it into view and flash it
     once. Without the flash, a scroll that lands mid-screen leaves you asking
     which panel you were sent to. */
  if (app._settingsFocus === 'clipper') {
    app._settingsFocus = null;
    requestAnimationFrame(() => {
      clipperSec.scrollIntoView({ block: 'center', behavior: 'smooth' });
      clipperSec.classList.add('is-flash');
      setTimeout(() => clipperSec.classList.remove('is-flash'), 1600);
    });
  }

  wrap.appendChild(section('Appearance', null,
    // The swatch row, not a dropdown: the chip paints the mode's own page and
    // ink, so the control answers "what will this look like" instead of
    // naming it and hoping. System is the split chip.
    row('Colour mode', 'System follows your operating system.', ThemePicker()),
    row('Density', null, select('density',
      [['compact', 'Compact'], ['cozy', 'Cozy'], ['comfortable', 'Comfortable']]))));

  wrap.appendChild(section('Write safety', 'how much undo the app keeps for you',
    row('History snapshots per page',
      'Kept in .history/ beside your notes. Older ones are pruned.',
      h('input', {
        className: 'set-input', type: 'number', min: '1', max: '50',
        value: String(prefs.historyKeep),
        onInput: (e) => {
          const n = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 10));
          prefs.historyKeep = n; savePrefs(prefs);
        },
      }))));

  wrap.appendChild(section('Images', 'thumbnails live in the browser, not the vault',
    row('Cache thumbnails', 'Speeds up the inspo grid. Never writes a file.',
      h('input', {
        type: 'checkbox', checked: prefs.thumbCacheOn,
        onChange: (e) => { prefs.thumbCacheOn = e.target.checked; savePrefs(prefs); },
      })),
    row('Clear thumbnail cache', 'Frees browser storage. Images are re-read from disk.',
      h('button', {
        className: 'btn', onClick: async () => {
          try {
            if (window.indexedDB && indexedDB.deleteDatabase) indexedDB.deleteDatabase('sb-thumbs');
            toast('Thumbnail cache cleared');
          } catch (e) { toast('Could not clear the cache — ' + e.message, { tone: 'error' }); }
        },
      }, 'clear'))));

  applyHtmlAttrs2();
  return wrap;
}

function buildMain() {
  const r = app.route;
  if (r === 'home') {
    return V2Home(app, openPage, () => { app.createOpen = true; render(); }, (k) => setRoute('kind:' + k));
  }
  if (r === 'pages' || r.startsWith('kind:')) {
    const kind = r.startsWith('kind:') ? r.slice(5) : null;
    const wrap = h('div', { className: 'screen' });
    wrap.appendChild(Skeleton('rows', 6));
    const path = '/pages?limit=200' + (kind ? '&kind=' + encodeURIComponent(kind) : '');
    Promise.resolve(SB.data().pages(pathToQuery(path))).then(({ items }) => {
      // Seed the page cache — list_pages already returns full PageOut, so
      // clicking a row should not require another round trip.
      (items || []).forEach((p) => cacheSetPage(p));
      clear(wrap);
      const view = V2PagesList(kind, items || [], openPage,
        () => { kind ? createPage(kind) : (app.createOpen = true, render()); });
      while (view.firstChild) wrap.appendChild(view.firstChild);
      // copy className additions
      wrap.className = view.className;
      // The children move to this wrap, so any cleanup the view registered has
      // to move with them — `render()` only ever calls __teardown on the outer
      // element it is holding.
      if (view.__teardown) wrap.__teardown = view.__teardown;
    }).catch((e) => {
      clear(wrap);
      wrap.appendChild(EmptyState('Failed to load.', String(e.message)));
    });
    return wrap;
  }
  if (r === 'page') {
    if (!app.openPageId) return EmptyState('No page selected.', 'Pick one from a list.');
    return V2PageView(app.openPageId,
      async (patched) => { await refreshCounts(); /* keep nav counts in sync */ },
      async () => {
        // Return to wherever we came from — usually the list filter the user
        // was browsing (kind:canvas, tags, etc.). Falls back to 'pages'.
        const back = app._returnRoute || 'pages';
        app._returnRoute = null;
        app.openPageId = null;
        setRoute(back);
        await refreshCounts();
      });
  }
  if (r === 'projects') return ProjectsScreen();
  if (r === 'about-me') return AboutMeScreen();
  if (r === 'settings') return SettingsScreen();
  if (r === 'tags') return TagsIndexScreen();
  if (r.startsWith('tag:')) return TagFilterScreen(r.slice(4));
  if (r.startsWith('mention:')) return MentionFilterScreen(r.slice(8));
  return V2Home(app, openPage, () => { app.createOpen = true; render(); }, (k) => setRoute('kind:' + k));
}

/* Build first, swap second.
   This used to `clear(root)` and then build into it, so anything that threw
   part-way left an EMPTY page — the screen was destroyed before the thing
   replacing it was known to exist. That is how a single "vault not connected"
   became a white void you could not reload your way out of. The old screen
   now stays up until a whole new one has been built successfully. */
function render() {
  applyNavW();
  markSettled();
  const appEl = h('div', { className: 'app app-tabs',
    'data-log': 'hidden',
    'data-nav': app.navCollapsed ? 'collapsed' : 'open' });
  const openSearch = () => { app.searchOpen = true; render(); };
  const closeSearch = () => { app.searchOpen = false; render(); };

  // Top: tabs + breadcrumbs span the full width above sidebar + main.
  appEl.appendChild(TabBar(
    app.tabs, app.activeTabId,
    switchTab, closeTab,
    () => newTab('home', null, { switchTo: true }),
  ));
  appEl.appendChild(BreadcrumbRow(crumbsFor(app.route)));

  // Sidebar (search icon up top, status + settings at bottom).
  appEl.appendChild(Sidebar(
    app.route, setRoute, app.kindCounts,
    () => { app.createOpen = true; render(); },
    app.offline,
    app.lastSynced,
  ));

  // Local until the swap: `currentMain` must keep pointing at the screen that
  // is actually mounted, or the teardown below runs against the incoming one.
  const nextMain = buildMain();
  appEl.appendChild(h('div', { className: 'main' }, nextMain));

  if (app.createOpen) appEl.appendChild(CreateModal(app.createOpen, createPage, () => { app.createOpen = false; render(); }));
  if (app.searchOpen) appEl.appendChild(SearchPanel(closeSearch));
  // Only now is the old screen safe to throw away.
  if (currentMain && currentMain.__teardown) currentMain.__teardown();
  currentMain = nextMain;
  clear(root);
  root.appendChild(appEl);
}

/* Swap the sidebar in place, counts and all.
   For the case where something changed the vault but re-rendering the whole
   screen would throw away what the user is in the middle of — the bookmark
   paste box keeps its focus and its "saved 3" line while the nav behind it
   catches up. A full render() is still right for anything that changes which
   screen you are on. */
function refreshSidebar() {
  const old = document.querySelector('.app > .nav');
  if (!old) return;
  old.replaceWith(Sidebar(
    app.route, setRoute, app.kindCounts,
    () => { app.createOpen = true; render(); },
    app.offline, app.lastSynced));
}

/* Arrow-key movement within a list.
   Every row is focusable now, but walking a fifty-row table by Tab is a
   chore — Tab is for moving between regions, arrows are for moving within
   one. This deliberately does NOT reintroduce single-letter navigation
   (removed because it hijacked typing): arrows only act when focus is
   already on a row, and never inside a field. */
const ROW_SEL = '.pages-row, .list-row, .board-card, .bento-tile, .project-card, .obs-member, .side-link';
window.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const act = document.activeElement;
  if (!act || !act.matches || !act.matches(ROW_SEL)) return;
  const rows = [...document.querySelectorAll(ROW_SEL)].filter((n) => n.offsetParent);
  const i = rows.indexOf(act);
  if (i < 0) return;
  const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}, true);

window.addEventListener('keydown', (e) => {
  // ⌘K / Ctrl-K focuses the always-visible search in the top bar.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const el = document.querySelector('.tab-search-input');
    if (el) { el.focus(); el.select(); }
    return;
  }
  // ⌘T / Ctrl-T opens a new tab.
  if ((e.metaKey || e.ctrlKey) && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    newTab('home', null, { switchTo: true });
    return;
  }
  // ⌘W / Ctrl-W closes the active tab.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'w' || e.key === 'W')) {
    e.preventDefault();
    closeTab(app.activeTabId);
    return;
  }
  // ⌘N / Ctrl-N opens the create picker. Capture is the one primary action in
  // the app, and reaching it meant travelling to the sidebar every time —
  // which is a long way to go for the thing you do most.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    app.createOpen = true;
    render();
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape' && app.searchOpen) { app.searchOpen = false; render(); return; }
  if (e.key === 'Escape' && app.createOpen) { app.createOpen = false; render(); return; }
  // Single-letter and digit navigation was removed on purpose: it hijacked
  // typing and cluttered the nav with key hints. ⌘K / ⌘T / ⌘W above still work,
  // and Escape still closes overlays.
});


/* The entrance stagger is a first-impression device. After the first screen
   has painted it becomes a tax on every navigation, so it retires itself. */
function markSettled() {
  if (document.body.classList.contains('cv-settled')) return;
  setTimeout(() => document.body.classList.add('cv-settled'), 900);
}

/* ── The last resort ────────────────────────────────────────────────────
   There was no `onerror` and no `unhandledrejection` handler anywhere in this
   app, and `render()` destroyed the screen before it built the replacement.
   Together those turned EVERY uncaught error into the same outcome: a blank
   white page, no message, nothing to click, and — when the cause was a
   persisted tab — no way to reload out of it either.

   A crash the user can see and recover from is not a nice-to-have here. This
   app holds the only copy of nothing (the files are on disk, untouched), but
   a screen that says nothing is indistinguishable from one that is still
   loading, which is exactly how half an hour gets spent waiting on something
   that failed in the first second. */
let _crashed = false;
function crashScreen(err, kind) {
  if (_crashed) return;              // one screen, not one per stray rejection
  _crashed = true;
  const msg = (err && (err.message || err.reason && err.reason.message)) || String(err || 'Unknown error');
  clear(root);
  const wrap = h('div', { className: 'sb-crash' },
    h('h1', { className: 'sb-crash-h' }, 'Something broke while drawing this screen.'),
    h('p', { className: 'sb-crash-p' },
      'Your notes are files on disk and nothing here has touched them. '
      + 'This is the app failing to render, not the vault failing to load.'),
    h('pre', { className: 'sb-crash-pre' }, kind + ': ' + msg),
    h('div', { className: 'sb-crash-row' },
      h('button', {
        className: 'btn btn-primary',
        onClick: () => { location.reload(); },
      }, 'Reload'),
      /* The usual cause is a restored tab pointing at something that no
         longer resolves — which survives a reload, so "reload" alone can
         loop forever. This is the escape hatch, and it touches localStorage
         only: never the vault. */
      h('button', {
        className: 'btn',
        onClick: () => {
          try { localStorage.removeItem('sb.tabs'); } catch (_) {}
          location.hash = '';
          location.reload();
        },
      }, 'Reset tabs and reload')));
  root.appendChild(wrap);
}
window.addEventListener('error', (e) => crashScreen(e.error || e, 'Error'));
window.addEventListener('unhandledrejection', (e) => crashScreen(e.reason, 'Unhandled rejection'));

async function boot() {
  // Seed the in-memory tweaks from the persisted store before first paint,
  // otherwise the app flashes the default mode and then corrects itself.
  try {
    const p = loadPrefs();
    if (p.theme) app.t.theme = p.theme;
    if (p.density) app.t.density = p.density;
  } catch (_) {}
  applyHtmlAttrs();
  applyNavW();
  // 1) Restore persisted tabs (best-effort).
  const hadTabs = loadTabs();
  // 2) Hash takes precedence — direct links / refresh on a deep URL should
  //    open into that route, replacing the current active tab.
  const initial = hashToRoute(location.hash);
  if (initial.route && (initial.route !== 'home' || !hadTabs)) {
    app.route = initial.route;
    app.openPageId = initial.openPageId;
    _syncActiveTab();
  }
  /* 3) Fresh load with no deep link / no restored tabs → land on the
        active mode's home (work mode reloads back into the workspace).

     Guarded, and it falls back to Home rather than to nothing: the tab this
     restored is the single most likely thing to be unrenderable, and it is
     also the thing a reload faithfully brings back. */
  try {
    render();
  } catch (e) {
    app.route = 'home';
    app.openPageId = null;
    _syncActiveTab();
    try { render(); } catch (e2) { crashScreen(e2, 'Error'); return; }
  }
  try {
    await Promise.all([refreshCounts(), refreshRecent()]);
    app.offline = false;
  } catch (e) {
    app.offline = true;
  }
  app.loaded = true;
  render();
  // Last, and only after a real screen exists: the tour points at controls,
  // so it has to run once there are controls to point at.
  maybeStartTour();
}
boot();
