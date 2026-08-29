# Design — paper instrument panel

> monochrome instrument panel — the accent *is* the foreground

**Modes:** four palettes across two families, plus System.

| Mode | Family | Ground |
|------|--------|--------|
| **Light** (default) | light | warm off-white |
| **Sepia** | light | warm paper, for long reading |
| **Dark** | dark | zinc |
| **Midnight** | dark | blue-black |

Light is the default rather than System. System is the more fashionable
default, but it means anyone whose OS is dark never sees the theme this app is
designed around — and light *is* the design here. System stays one click away.

The picker lives in **Settings → Appearance**, and nowhere else. It is a row of
colour chips, each painting its own mode's page and ink, because the swatch *is*
the answer to the question you are asking — a dropdown offers you the word
"midnight" and makes you go and find out. System is a split chip, half light and
half dark.

It used to sit in the sidebar footer on the argument that appearance is a whim
and a whim does not survive two clicks. That is true of a whim and untrue of
this: it is a preference, it is set once, and a permanent five-chip strip under
the navigation spends standing screen space on a decision nobody revisits. The
footer says what the footer is for — whether the vault is there, and whether
your work is on disk.

`boot.js` applies the saved mode **synchronously, before first paint**. Without
that the first-run screen ignored the choice entirely (app.js only loads once a
vault is open) and the app flashed light before correcting itself.

## Adding a mode

A mode is **two independent things**, and separating them is what makes adding
one cheap:

- **Palette** — the two ramps. Six values, unique per mode.
- **Direction** — which way light runs. Whether hover is a white wash or a
  black one, whether a shadow reads at all, whether an input well needs a
  ring. This does *not* vary per palette, only per family, so it is declared
  once for all light modes and once for all dark ones.

So a fifth mode is six surface/ink lines, one selector added to its family, and
one row in `THEMES` in `app.js`. Everything else resolves through the ramps.

**Check contrast before shipping one.** Every text step must clear AA on all
three surfaces. Sepia shipped at 4.49 on its sunken surface on the first pass —
under by a hair, on the step that carries timestamps and counts — and had to be
darkened. Current worst-case per mode: light 4.53, sepia 5.01, dark 5.25,
midnight 5.48.

## The architecture, in one paragraph

Two ramps flip per theme and **nothing else does**:

```
--s-page / --s-raised / --s-sunken     three surfaces, by role
--i-1 … --i-7                          ink, ascending contrast on the page
```

Every semantic token (`--bg`, `--fg`, `--muted`, `--line`, `--accent`, …) is a
reference into those ramps. `[data-theme="dark"]` redeclares the ramps and the
handful of tokens whose *direction* genuinely differs; everything else resolves
through them for free. That is the invariant worth protecting: **if a re-skin
needs to touch more than the ramps, something has leaked.**

Surfaces are **roles, not a lightness ladder.** In dark, `--s-raised` is lighter
than the page. In light, `--s-raised` is white and the page is a soft grey it
lifts off. Same token, opposite direction — which is exactly what the
indirection buys: `--paper-2` is a sunken input well on light and a raised panel
on dark, and not one call site changes.

## Provenance

Started as a Linear/acid-lime system, re-skinned to shadcn/zinc dark on
2026-07-30 as a token-level swap, and flipped light-first on 2026-08-15. Each
step was a token change rather than a rewrite, which is why ~460 shared
selectors have survived three visual systems.

The historic `--color-*` names (`onyx`, `charcoal`, `snow`, …) are kept as
**compatibility aliases onto the ramps** so the ~16 call sites that still say
`var(--color-iron)` re-skin instead of painting a dark hex onto a white page.
They now mean their *role*, not their colour — "onyx" is the page and "snow" is
the ink, in both themes. **Do not reach for them in new code.**

## The one rule that defines this system

**The accent is monochrome.** `--accent` and `--cta` both resolve to `--i-7`,
the maximum-contrast ink. There is no chromatic accent at all: emphasis comes
from *contrast and inversion*, and colour is reserved for meaning.

The flip preserves it exactly. Where dark put near-white on near-black, light
puts near-black on near-white. The primary button is still an inversion.

The only chromatic values are semantic: `--signal-pos`, `--signal-warn`,
`--signal-alert`, and the per-kind dot colours.

## Tokens — ink

| Step | Light | Dark | Role |
|------|-------|------|------|
| `--i-1` | `#e9e7e4` | `#27272a` | hairline rules — **structure only** |
| `--i-2` | `#d4d0cb` | `#3f3f46` | medium borders — **structure only** |
| `--i-3` | `#736d65` | `#8b8b94` | faint text, placeholders, inactive |
| `--i-4` | `#635d57` | `#a1a1aa` | secondary text |
| `--i-5` | `#4a4540` | `#d4d4d8` | tertiary text |
| `--i-6` | `#322e2b` | `#e4e4e7` | strong separators, emphatic text |
| `--i-7` | `#1c1917` | `#fafafa` | primary text, and the accent |

`i-1` and `i-2` are structure and **may never carry text**. `i-3` and up are
text, and every one clears WCAG AA on both the page and the sunken surface.
Measured on light (`#faf9f8` / `#f2f1ef`):

```
i-3  4.87 / 4.53      i-5  9.01 / 8.39      i-7  16.63 / 15.49
i-4  6.18 / 5.75      i-6  12.79 / 11.92
```

The lightest text step is much darker in light than the dark theme's
equivalent, deliberately: light-on-dark blooms and reads heavier than it
measures, so dark gets away with a grey that on white just looks broken. This
app puts real content — timestamps, IDs, counts, section labels — in the
faintest step, so it has to be legible.

> Dark's `i-3` was zinc-500 (`#71717a`), which measures **3.94:1** on zinc-950 —
> under AA. It is the one value in the historic zinc mapping that changed, and
> it changed because it was failing.

## Tokens — surfaces

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--s-page` | `#faf9f8` | `#09090b` | the page itself |
| `--s-raised` | `#ffffff` | `#101012` | nav, cards, tab bar |
| `--s-sunken` | `#f2f1ef` | `#18181b` | input wells, table heads, code |

Light is **warm neutral, not zinc**. A notes app rendered in cold grey on white
reads like a spreadsheet; a few degrees of warmth reads like paper. The ink ramp
is warmed to match so nothing looks blue-shifted.

## Tokens — shape & elevation

| Element | Radius |
|---------|--------|
| card | `10px` · btn/input `7px` · badge `5px` · pill `9999px` |

Dark could get away with almost no elevation because a hairline separates well
on black. **On white it does not**, so light has a real three-step ramp, tinted
with the ink hue rather than pure black (pure-black shadows on warm neutrals go
grey and muddy):

- `--shadow-card` — lists, cards, chips that sit on the page
- `--shadow-raised` — hover lift, banners, toasts
- `--shadow-overlay` — modals, the command palette, popovers
- `--shadow-input` — light only: `inset 0 0 0 1px var(--i-1)`, because a field
  with a transparent border is invisible on a white card. Dark sets it `none`.

## Tokens — type

Inter for the interface **and for prose**, JetBrains Mono for machine text.
Both self-hosted in `app/vendor/` — the deployed CSP blocks an external request.
Inter is vendored as a variable face at **300–600**, so there is no 700 and
emphasis tops out at 600.

### One scale, seven steps

```
--fz-display 32   the one big number (stat counters)
--fz-h1      26   screen and page titles
--fz-h2      17   card titles
--fz-h3      14.5 sub-headings inside content
--fz-body    14   default interface text
--fz-mini    12.5 secondary and meta text
--fz-micro   11   the ONE uppercase role: region labels
--fz-prose   15.5 rendered note bodies
```

**Every font-size in the file resolves to one of these.** It previously carried
**sixteen** hardcoded pixel values — 9, 9.5, 10, 10.5, 11, 12, 13, 14, 15, 16,
18, 20, 22, 24, 28, 30 — most of which ignored density entirely. Sizes one pixel
apart cannot signal a difference in rank; they just look like a mistake, and a
hundred and fifty of them look like several designs competing. Nothing renders
below `--fz-micro`: 9px text was unreadable, not dense.

Tracking is bound to role — **five values, no more**. The file previously
carried twelve, of which five different numbers (0.04 / 0.06 / 0.08 / 0.12 /
0.14) all meant the same thing, "this is a caps label":

```
--track-display -0.022em   --track-body   0        --track-caps 0.07em
--track-title   -0.014em   --track-label  0.01em
```

`--measure: 68ch` caps prose so lines never run past the eye's return sweep.

### Uppercase means exactly one thing

**A label that names a region or a column.** Nothing else. That is `.nav-section`,
`.sect-hd`, the table column heads, and the card heads in the rails and panels.

It used to appear on 56 selectors — buttons, kind chips, status values, speaker
roles, breadcrumbs, search-result kinds, log tags, content headings — at which
point it distinguished nothing and merely shouted. It is now on ~20, all of them
region labels. Kind names, statuses and controls are **values and controls, not
labels**, so they are sentence case.

Region labels are also written sentence case **in the markup** (`'Metadata'`,
not `'METADATA'`), and CSS decides whether they render uppercase. Shouting in
the data model means every consumer inherits a styling decision.

### Spacing

A 4px base, `--sp-1` (4) through `--sp-8` (56). Ad-hoc padding was the other
half of the inconsistency — 8/9/10/12/14/16/18 all appeared, so nothing lined up
across components and the interface felt tight without being usefully dense.
Everything structural lands on this scale.

Five regions had each invented their own version of "a small label beside a
value" — the metadata rail, settings rows, project meta, aside blocks, the
tweaks panel. They share one grid now (`.side-row` and friends: 84px label
column, baseline-aligned). About me was the sixth until its fields were
removed; see *About me is prose*.

### Mono is a signal, not a texture

**The rendered note body is proportional.** It used to be mono at 12px with 11px
uppercase headings, which is a terminal readout, not a document — and a note is
the longest-lived text in the app and the thing the product exists to hold.

Mono did not disappear, it moved to where it *means* something: the frontmatter
block, code, IDs, slugs, paths, key hints, and **the markdown editor** (where
`##` and `-` and `[[…]]` are structure you need to see as characters, and a
proportional face makes indentation lie). Seeing mono now tells you you are
looking at machine text. That contrast is load-bearing — do not spend it.

## Tokens — motion

Four durations and three curves, referenced by name:

```
--dur-1  90ms   state flips: hover, active, colour
--dur-2 160ms   small transforms: chips, rows, icons
--dur-3 240ms   cards and panels entering
--dur-4 380ms   overlays, screen transitions

--ease-out    cubic-bezier(0.16, 1, 0.30, 1)     strong decelerate — settles
--ease-in-out cubic-bezier(0.65, 0, 0.35, 1)
--ease-spring cubic-bezier(0.34, 1.4, 0.64, 1)   slight overshoot
```

Three rules:

1. **State flips are near-instant.** Hover must feel like the cursor caused it,
   not like the app is thinking about it.
2. **Anything that moves decelerates.** `--ease-out`, never `linear`.
3. **Nothing animates on load that the user did not ask for**, except one quiet
   entrance per screen. Motion is feedback, not decoration.

List entrances stagger at 22ms, **capped at 8 steps** — past that a stagger
stops reading as sequence and starts reading as lag. The press state
(`translateY(1px)`, 40ms) matters more than the hover: a control that does not
acknowledge the mousedown feels broken even when it works.

`prefers-reduced-motion` turns motion **off**, not down. Anyone who sets it is
saying motion makes the interface harder to use, so every transform and
animation goes and only opacity survives.

## Kind colours

Semantic, not decorative — each kind keeps its dot colour so the four kinds stay
distinguishable at a glance. These were authored for a light ground originally
and needed no shifting.

| Kind | Token | Light | Dark |
|------|-------|-------|------|
| canvas | `--k-canvas` | `#2563eb` | `#60a5fa` |
| topic | `--k-topic` | `#B45309` | `#f59e0b` |
| note | `--k-mdwn` | `#1f6f6b` | `#5eead4` |
| inspo | `--k-desg` | `#be185d` | `#f472b6` |
| project | `--k-proj` | `#047857` | `#34d399` |

`--k-book`, `--k-snip`, `--k-locl`, `--k-self` and `--k-screen` survive for
pages carrying legacy frontmatter; no live kind references them.

## Depth

Gradients are **tonal, never chromatic** — every one is mixed with
`color-mix()` from tokens already in the system (`--accent`, `--k-c`, the
surfaces), not from a new brand colour. That is what lets one set of rules work
across four modes: a wash tuned for warm paper reads as a smudge on blue-black.
Two variables set the whole layer's intensity, `--wash-strength` and
`--wash-edge`, declared once per family — light-on-dark reads hotter, so dark
gets larger percentages for the same apparent weight.

Where depth is spent, and why:

- **Card sheen** — a 42px top highlight. The cheapest way to make a flat
  rectangle read as a surface with an edge rather than a hole cut in the page.
- **Kind wash** — a card carrying `--k-c` gets a corner wash of its own kind,
  falling away by 60% so it tints the corner and never the text. This is what
  makes a grid scannable by kind without the chips shouting.
- **CTA** — a directional fill so the primary reads as raised. Inversion is
  still the system; this only gives it dimension.
- **Page ground** — a single wash at 2.5%. Flat white across 1400px reads as
  unfinished.
- **Section rules** — fade out rather than stopping dead. A hard 1px line at
  full width is the loudest thing on a quiet page.

The restraint is the point. If a gradient is *noticed* rather than felt, it is
too strong.

## Do

- Use `--accent` / `--cta` for emphasis, and let **inversion** carry a primary
  action.
- Reach for a semantic token first, a ramp step second, and a raw hex never.
- Keep the surface stack tight: page → raised → sunken. Three levels is the
  whole range.
- Use `--font-mono` for machine text only.
- Check a new text colour against **both** surfaces before shipping it.
- Bump `?v=` in `app/index.html` **and** `CACHE_VERSION` in `app/sw.js` when
  shipping CSS or JS. `boot.js` and `bridge.js` inherit the query; the service
  worker matches assets exactly, so the bump is what actually reaches a
  returning user. Miss it and you will debug a stylesheet that is not running.

## Don't

- **Don't reintroduce a chromatic accent.** Monochrome emphasis is the system.
  The depth layer adds gradients but no colour — every wash is mixed from
  `--accent` or a kind's own `--k-c`.
- **Don't let an edit fail silently.** A local-first app's only copy is the one
  on disk; a save that is refused and not surfaced is data loss with a happy
  face on it. Every write path ends in a visible state.
- **Don't put text in `--i-1` or `--i-2`.** They are structure.
- Don't hardcode a hex where a token exists — the point of the naming is that
  the next re-skin is one block.
- Don't use `--color-acid-lime`, `--color-indigo`, or any `--color-*` alias in
  new code.
- **Don't write a raw `px` font-size or a raw `em` letter-spacing.** Both scales
  are closed; if a new size seems necessary, the design is wrong, not the scale.
- **Don't reach for uppercase** unless the thing is a region or column label.
- Don't add a dashed border as texture. Dashes now mean exactly one thing: an
  empty placeholder.
- Don't invent another label/value layout. There is one.
- Don't use a unicode glyph where an icon is meant — `↓ ≡ ✎ ¶ ☉ //` were all
  removed from kind pills, actions and pickers. Use `icon(name)`.
  (A bare `×` survives on close buttons and `↗` on external-link markers;
  those are punctuation doing punctuation's job, not icons.)
- Don't fill cards. Cards are `--paper` with a `--line` edge and the lightest
  shadow in the ramp.

## Brand

The **CV monogram** and the **CANON-VAULT wordmark**, inlined as vectors rather
than loaded as images. The deployed CSP blocks an external request and there is
no build step to inline one at ship time, so the geometry lives in the source.

Both are **outlined — filled paths, not live strokes**. That is what makes them
hold from 16px to 512px: there is no stroke width to scale down into a
sub-pixel smear. An earlier stroke-based version looked washed out as a favicon
for exactly that reason.

**The single fill is `currentColor`.** One asset serves both themes; a
hardcoded black mark is invisible on the dark ground. The source exports carry
`fill="black"`, and swapping that for `currentColor` is the only edit made to
them on the way in.

They are sized on **different axes on purpose**. The monogram is compact
(1.44:1), so height binds it. The wordmark is ~19:1 — height would overflow
long before it looked right — so it is sized by **width** and shrinks with its
container. Below ~1100px viewport, and in the collapsed sidebar, it is dropped
entirely and the monogram carries the identity.

There is no "Canon Vault" text label beside the wordmark. Setting the name next
to a mark that already says it is the most common way a lockup goes wrong.

| Where | File |
|-------|------|
| canonical geometry | `app/app.js` — `BRAND_MARK` / `BRAND_WORD` |
| standalone vectors | `app/icons/mark.svg`, `app/icons/wordmark.svg` |
| favicon | `app/icons/favicon.svg` (flips ink on `prefers-color-scheme`) |
| PWA raster | `app/icons/icon-{192,512,512-maskable}.png` |

`app/vault/bridge.js` carries a **second copy** of the lockup for the first-run
screen, which renders before `app.js` exists. Keep the two in step.

**To update the artwork**: re-export `app/icons/mark.svg` and
`app/icons/wordmark.svg`, then swap the path data into `BRAND_MARK` /
`BRAND_WORD` in `app.js` and into the `bridge.js` copy, keeping each viewBox in
sync with its file. Nothing else references the geometry.

Two things to check on any re-export:

- **`fill="currentColor"`, never a literal colour**, and never a `fill:` rule
  inside a `<style>` block that targets a group — a CSS declaration outranks
  the `fill="none"` presentation attribute on the root, which fills every
  shape and collapses the C into a solid disc. The favicon sets its colour on
  the *path*, through a custom property, for this reason.
- **The PNGs must match the sizes the manifest declares.** Chrome compares
  them and skips an icon on a mismatch; a 511px file declared as 512 can cost
  installability, and the install criteria want a genuine ≥512 icon.

`app/icons/favicon.svg` is separate because a favicon loads standalone and
cannot inherit `currentColor` from the page — it flips on
`prefers-color-scheme` instead, so near-black does not vanish against dark
browser chrome.

## Every kind carries the rail

Boards, walls, bookmarks and snippets used to pass `side = null` — a leftover
from when the right column held the chat composer. Once chat was gone, `null`
did not mean "this kind wants the width", it meant those kinds had **no
delete, no export and no version history at all**. A kind you cannot manage is
not a simpler kind, it is an unfinished one.

The spatial kinds get a narrower rail (272px vs 300px) and it drops entirely
below 1180px. They do want the width — they just cannot want it badly enough
to give up the only route to managing the page. Width is recoverable by
collapsing the sidebar; the actions were not recoverable by anything.

No exceptions any more. The project note used to keep `side = null` on the
argument that its body was a full-width management surface — once that body
became a plain contents list, `null` again meant "the one page with no
delete, no export and no history", and the rule above closed it.

The delete control says **"Delete page"**. It was "Forget this" — a euphemism
its own confirm dialog immediately contradicted ("Delete this page?"), and a
word nobody scanning for delete would find.

## The header chips say their own names

Tags and mentions share **one wrapping row** under the title, with no gutter
labels. The chips announce their own type — a tag is a lime `#pill`, a mention
carries a link glyph and squared corners — so the uppercase TAGS / MENTIONS
labels only restated what the chips already said, and the two labelled rows
they anchored were most of the header's height. A hairline seam separates the
families when both are present; the add-affordances sit at the end of each
group, quiet until used.

## The inspo wall is a place things land

**Adding is not a mode.** To put an image on the wall you used to have to
discover that "Arrange" existed, click it, and find "+ image" in a toolbar
that had just changed shape. Three ways in now, all available while simply
looking: the toolbar buttons (+ Image, + Link), **paste** (an image from the
clipboard becomes a card; a bare URL becomes a link card), and **drag-drop**
of image files straight onto the wall — a dashed ring says the wall heard the
drag. Paste never fires while a field has focus or a dialog is open, and the
listener dies with the page. Arrange keeps what belongs to arranging: fields,
groups, moving, removing.

**Click an image and it fills the screen.** A wall you cannot view large is a
wall of thumbnails. The lightbox is near-black in every mode — the subject is
a picture, and any paper tone would tint it — with the caption, tags, source
and count on one bar, ← → walking the wall in render order, Esc or the scrim
closing. Small images show at natural size (upscaling a 200px crop is just
blur) inside a floored frame, so the chrome never huddles around a thumbnail.

**The empty wall teaches the ways in**, because none of them are visible:
nothing about an empty page says it accepts a drop or a paste.

## The inspo wall names its tiles

Each tile on the Inspo wall is a whole **page**, not an image — so it has a
name, and the name stays visible. It used to appear only on hover, which is the
Pinterest pattern and wrong here: a wall of pages you can read one at a time by
hovering is a wall you cannot scan.

What hover reveals is the second line — item count and date — the part you only
want once you are deciding. It is **collapsed**, not merely transparent, because
an always-drawn two-line scrim covers a third of a short tile and this is a
surface you look at.

The scrim holds its weight *through* the text band
(`0.86 → 0.78 @46% → 0.46 @72% → 0`) rather than fading linearly across it. A
single `to top` ramp sits at roughly 40% alpha exactly where the title is, which
is the weakest place it could have been.

## One editing surface

`ProseEditor` in `app.js` is the only writing surface. There were six: three
kinds had grown their own view/edit toggle (three labels, three layouts), and
three others — note default, snippet, bookmark context, about-me — had no
rendered view at all, so a bookmark's context sat in mono forever.

The split it preserves is the one that matters: **the editor is mono** (you are
editing raw markdown; `##`, `-` and `[[…]]` are structure you need to see as
characters) and **the view is proportional** (it is prose). Toggling is the same
gesture on every kind.

The note body no longer prints a frontmatter block. Those facts are in the
Metadata rail and the chips row; three copies, one of them ahead of the
writing, is not a design.

## One creation picker

Every creatable thing is in the Create modal — the five kinds plus Drawing and
Project. There used to be three grammars: this modal (5), the project screen's
picker (6), and a browser `prompt()` for new projects. A person creating
something should meet the same control every time, whichever door they came
through. Project asks for its name inline, because a folder cannot be made
empty and titled later.

## Deletion is reversible, and says so

`.trash/` has existed since 5.7 and nothing could come back out of it — the
safety was real and completely invisible, so deleting was indistinguishable
from destroying. `Vault.untrash()` moves the file back (refusing if something
has taken the old path), `Data.restorePage()` wraps it, and the delete flow
raises a toast with **Undo**. An undo offer gets a longer dismiss timer than a
bare confirmation: you need time to realise you did not mean it.

## Icons

**Lucide** — vendored as a `LUCIDE` path map in `app/app.js` and rendered by
`icon(name)` into an inline `<svg>`. Inline because the no-build rule holds and
because the deployed CSP blocks an external request. Icons inherit
`currentColor` and size from `font-size` (`.lucide` is `1em`), so an icon tracks
the text beside it. `kindIcon(kind)` resolves through `KIND_META[kind].icon`.

There are **no unicode glyphs** in the UI.

## Chrome

**The sidebar is resizable and collapsible.** `--nav-w` is a live custom
property rather than a constant baked into three grid templates, so dragging it
costs one property write and no re-render; double-clicking the handle resets it.
Width and collapsed state persist in `localStorage` (`sb.navW`, `sb.navCollapsed`),
matching how the activity log already worked.

Collapsed is an **icon rail at `--nav-w-collapsed` (56px)**, not a zero-width
column — animating the width to 0 would take the nav's border and its focus
targets with it. Rows get *bigger* when collapsed, not smaller: with the label
gone the icon is the only hit target left, so each row becomes a 38×34 button,
and the group separation that section headings carried moves to a rule between
groups.

The tab bar's brand block is pinned to `var(--nav-w)` so the vertical rule
between sidebar and content runs unbroken through both rows, at any width.

## The project page is a folder

**A project is a folder. It has no description, no tags and no mentions — the
things inside it have those.** A container that also wants to be a document is
why this screen used to read as "a note that happens to list some pages": you
met a 220px description editor, a tag strip and a mentions strip before you
reached a single one of the pages the folder holds.

So the page opens on **its contents**, grouped by kind. Everything else is a
footnote to that: the status strip above (hidden entirely when nothing is set —
"No status or dates set yet." is a sentence whose only content is the absence of
a summary), the dates below, and the folder note below those.

**The folder note is one collapsed row, not a card.** `projects/X/X.md` is a
real file that Obsidian and your agent write to, and it may well have prose in
it — dropping the editor would leave that text on disk and invisible here, which
is the one thing this app must never do. So it stays, closed, with a preview
line that says whether there is anything in it before you spend a click finding
out. The project *card* on the Projects screen drops the prose entirely: a
folder card is a name and what is in it.

**The page wears the Project pill**, via `metaForPage`. The folder note carries
some other `kind:` on disk — the demo's is `topic` — and a page that renders as a
container while calling itself a Topic is the label contradicting the chrome.
Same rule as the bookmark, same bargain: the derived facet takes the pill, the
stored kind keeps the count, Projects tallies separately.

**No status and no dates.** There was a Details card — status, started, ends,
an *Ongoing* checkbox — and it had never once worked in either direction:
`updatePage` writes `status` out of `patch.status` while the editor only ever
sent `patch.meta.status`, `start_date` and `end_date` are not in its write list
at all, and `page(id)` surfaces canvas, excalidraw and bookmark keys into `meta`
and nothing else. Whatever you typed was blank again on reload. The Projects
screen grouped by the same field, so every project fell into one "No status"
bucket and the heading was suppressed to hide it.

Making it work was the other option. CONVENTION.md decides against it:
`end_date` is not part of the format, and the convention already answers how
state is marked — *"Native tags are workflow … `tags: [draft, current]` mark
state — status, lifecycle, review marks."* A project is a folder; the pages
inside it carry their own tags. Anything already in a vault's frontmatter stays
there, untouched and readable in Obsidian.
- **The create picker is the same picker the global Create modal uses**: icon,
  name, and the one-line hint that already lives in `KIND_META` and used to be
  buried in a `title` tooltip. It was a strip of six 10px buttons prefixed with
  `§ ↗ ¶ ▦ ◫ ✎` — you had to already know what the symbols meant to use it.
  Two different pickers for the same choice was most of why this screen felt
  like a different app.
- **Progressive disclosure**: an empty project opens the picker, because that is
  the only useful action. A project with pages shows one button, because the
  pages are the point.

## About me is prose

`context/about-me.md` is the file every agent reads before it writes in your
voice, and the screen is now one prose editor over its body. It used to be a
form — Identity, Taste, Communication and State over four résumé sections
(experience, skills, education, highlights) — and none of it had ever once
worked in either direction. The screen sent eight structured keys through
`updateAboutMe` → `updatePage`, whose write list is title, tags, aliases, url,
status, two `meta` keys and the body; the rest were dropped in transit and the
save reported success. `Data.aboutMe()` returns `{ body, updated, path }`, so
every load re-created the objects empty and the form came back blank whatever
you had typed into it.

Making it work was the other option, and CONVENTION.md decides against it
twice. Frontmatter cannot take it: the key list is closed, `mdfile.serialize`
throws on anything outside it, and YAML there holds neither a nested object nor
a list of dicts. The body could — but only by claiming `## Experience` and its
siblings as structural headings the app parses back and regenerates on every
write, and this is the one file Obsidian and your agent write freely, in
whatever shape the sentence wants. Rewriting it from a form would drop what
they had put there: the loss the inspo wall already documents and write safety
already forbids.

So the fields are gone, along with ~110 lines of CSS for them, and the page is
what the scaffold template and `SETUP-PROMPT.md` always described — who you
are, in your own words. Two things came back with the change. The screen shows
the same three-state save strip the page editor does, because a silent autosave
is a lie the moment a write is refused. And a vault adopted without the file
gets an explanation instead of an editor: **a surface that cannot write must
not accept the gesture**, so `aboutMe()` returns `path: null` and the screen
reads it.

The bug class is closed at the data layer, not just at this call site.
`updatePage` now refuses a patch key it cannot write — `{ ok: false, reason:
"unwritable-fields", fields }` — where it used to drop one silently. Two lists
decide: what reaches disk, and what a caller may legitimately send for this
layer to ignore (`mentions` is recomputed from the body's wikilinks, `kind`
belongs to the frontmatter and the path, `slug` is display). A refusal is
visible in the UI; a quiet drop is visible nowhere, and this app had shipped
that twice.

## Keyboard

No single-letter or digit navigation — it hijacked typing and cluttered the nav.
What remains is `⌘K` (focus search), `⌘T` (new tab), `⌘W` (close tab) and
`Escape` (close overlays). A nav row is `[icon, label, count]` — three tracks,
no fourth.

**Rows, cards and tiles are keyboard-reachable.** They are built as
`<div onClick>`, which is unreachable without a mouse — the app had no keyboard
path to any list item at all. The fix is in `h()`, the single element factory:
when `onClick` lands on a non-native element it also gets `tabindex="0"`,
`role="button"`, and Enter/Space activation. One place, not fourteen call sites
that would drift apart. Space is `preventDefault`ed, since scrolling the page
is never what a focused row is asking for.

## One resolver decides what a page is

`metaForPage(page)` — label, icon, colour — is the **only** thing allowed to
answer "what kind is this". Everything that shows a kind takes the page and asks
it: the header pill, `KindChip`, the metadata rail, the search results, the
obsession members, the project grid, the file-nodes on a board.

The rule exists because two of the four kinds are not what their `kind:` field
says. A `note` carrying a `url` **is a bookmark** to the reader; a `canvas` at a
`.excalidraw.md` path **is a drawing**, and that word is the only thing telling
someone whether their edits will be kept. Every call site that reached for
`KIND_META[p.kind]` instead got both wrong — so in the two tables where you meet
most of your vault, a bookmark wore the note icon and announced itself as
"Note".

The hoisting matters too: a full page object carries the url under `meta.url`,
an index entry from `pages()` carries it at the top level, and `data.js` derives
the bookmark facet from the hoisted one. `metaForPage` reads both.

## Say it once, and say it right

- **The metadata rail owes you the facts the page does not already show.** It
  used to print `Slug` — the H1 restated a centimetre below it — and Tags and
  Mentions **counts** for chips listed in the header row. In their place: the
  **file path**, the one fact this whole app is about and the only one it never
  showed.
- **Plurals go through `nOf(n, one, many)`.** Ten places counted things and each
  decided for itself; most did not bother, so the app said "1 projects".
- **`themeFamily()`, never `theme === 'light'`.** Four modes, two families. A
  vendored surface with its own two-value theme asks the helper, or Sepia comes
  out dark.
- **A tab says the page's name.** It is recorded on the tab when the page loads,
  so it survives a reload and an evicted cache, and it is cleared when the tab
  is pointed somewhere else.

## Breadcrumbs are containment, not history

The crumb chain says **where a page lives**, never where you came from. Only
routes that actually list pages count as parents — `pages`, `projects`,
`project:<id>`, `kind:x`, `tag:x`, `mention:x`. (`tag:x` lists pages; `tags`
lists tags, so it is not one.) Arriving from Settings or About me falls back to
the page's real container: its project folder, or its kind.

That fallback needs the loaded page, and the crumb row renders before the fetch
resolves — so **the row is rebuilt when the page lands**, not patched. Patching
only the last crumb fixed the title and left the chain lying.

## Layout under pressure

**`.main` is the only scroller; a screen just grows.** `.screen` used to be a
scroll container with `height: 100%` nested inside it. That is invisible on a
full-width screen and obvious on a narrow one: Settings is capped at 46rem, so
its scrollbar drew a rule down the middle of the page instead of sitting at the
window edge, and the wheel only moved the page while the pointer was over the
form. (A page's `.page-main` is the deliberate exception — the metadata rail
should hold still while the body scrolls.)

The one hard rule is that **the page body never scrolls sideways**. Tables are
where that gets tested: the dashboard's recent-pages grid needs ~640px of fixed
columns, which it does not have once the sidebar and a rail are out. It sheds
columns instead of overflowing — ID first, then Via, then Tags. **Title and When
always survive**, because they are what you scan for.

## Where this lives

`app/styles.css`, in four blocks, in cascade order:

1. **Tokens** (top) — the two ramps, the semantic mapping, density, and the
   `[data-theme="dark"]` flip. Everything above lives here.
2. **The base file** — ~460 component selectors, all token references.
3. **Polish layer** — geometry, the inverted CTA, inputs, focus rings.
4. **Typography · Motion · Light component pass · System pass** (bottom) — the
   relationships rather than the sizes; the corrections light needs that dark
   did not (hairlines become cards, dashes become solid, decorative ink steps
   back); and the one component language — spacing, the shared label/value
   grid, the sidebar rail, the tab bar, the metadata rail.
