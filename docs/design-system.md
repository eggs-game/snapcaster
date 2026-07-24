# UI design system

Living notes on shared visual patterns across `src/styles.css`. This is
the second-most-consulted doc for any UI change (after actually reading the
component) — check it before inventing a new size, color, or radius.

> **Rule: when you change something that affects this system — a size, a
> color role, a spacing value, a new reusable pattern — update this file in
> the same change.** Do not let it drift out of sync with the CSS the way
> the tiny-button sizes and the arrow/thumbs-down colors did before this
> doc existed (18px icons in 24px buttons, two different "dim gray" tokens
> used interchangeably). A design-system doc that lags the code is worse
> than no doc, because it actively misleads the next change.

## Tokens

All tokens live in `:root` (dark, default) and `[data-theme="light"]` at
the top of `src/styles.css`. Treat that block as the source of truth for
exact values — this doc describes the *categories* and *intent*, not a
duplicated value table that will go stale.

- **Color** — semantic names, not raw colors: `--bg-canvas` /
  `--bg-sidebar` / `--bg-surface` / `--bg-surface-raised` for background
  layers (each one step "up" from the page); `--text-primary` /
  `--text-secondary` / `--text-tertiary` / `--text-disabled` for a fixed
  legibility ladder; `--border-subtle` / `--border-default` /
  `--border-strong` likewise. Status colors (`--success`, `--warning`,
  `--danger-*`, `--info`) each have a `-bg`/`-border`/`-text` trio for
  banners and badges. `--accent-primary` (+ `-hover`/`-active`) is the one
  interactive/brand color. A handful of single-purpose tokens exist outside
  these families — e.g. `--active-turn-glow` (white in dark mode, black in
  light) for the active-player pulse.
  - **Compatibility aliases** (`--bg`, `--panel`, `--dim`, `--text`, etc.)
    map to the semantic names above for older components mid-migration.
    Don't introduce new usages of an alias — use the semantic name it
    points to (e.g. `--text-secondary`, not `--dim`) so two components that
    should match don't silently diverge if the alias is ever repointed.
  - Seat/player colors (`TILE_COLORS` in `Game.jsx`) are the one place
    chromatic, non-themed color is intentional — they identify a specific
    player and must stay stable across light/dark mode.
- **Typography** — `--text-xs` (12px) through `--text-3xl` (28px), one
  scale for the whole app. `--font-sans` (Geist/Inter) for UI,
  `--font-mono` (Geist Mono) for code/diagnostic output.
- **Spacing** — `--space-2` (8px) / `--space-5` (20px) cover the common
  cases; most components still use literal px for one-off gaps. If you're
  reaching for a third spacing value repeatedly, consider adding a token
  rather than a new magic number.
- **Radius** — no token, but a de facto scale by usage: **6px** small
  controls (icon buttons, list rows), **8px** most buttons/inputs/cards,
  **10-12px** panels and modals, **999px** pills (badges, chips). Match the
  nearest tier rather than picking a new value.
- **Motion** — `--duration-fast` (100ms) / `--duration-standard` (160ms) /
  `--duration-slow` (240ms), all with `--ease-standard`. Bespoke animations
  (the active-turn pulse, hero crossfades) pick their own duration when the
  effect genuinely needs to be slower/faster than UI motion, but should
  still ease with `--ease-standard` unless there's a specific reason not to.
- **Glass/overlay material** — `--glass-bg`, `--glass-border`,
  `--glass-highlight`, `--glass-blur` (16px), `--glass-saturation` (115%)
  define the frosted-panel look used for the sidebar, the video-tile name
  bar, and dropdown menus. Reuse this set rather than inventing a new blur
  value for a new floating panel.

## Tiny icon buttons

The standard for small, icon-only buttons (video tile controls, card
lookup actions): **24×24px**, **16px icon**, **6px border-radius**, no
visible border, transparent background until hover.

```css
.some-tiny-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
```

```jsx
<SomeIcon size={16} />
```

Icon color at rest should be `var(--text-tertiary)` for buttons on the
app's own themed background (adapts correctly between light/dark mode).
`.menu-btn` (the video-tile name bar's mic/camera/tri-dot buttons) is the
one exception: it sits on a translucent dark banner overlaid on live
video, which stays dark regardless of app theme, so it uses a fixed light
`rgba(255,255,255,0.82)` instead of a theme variable — using a
theme-aware token there would go invisible in light mode.

Current examples: `.menu-btn`, `.wrong-card-btn` (thumbs-down report
button), `.scryfall-link` (arrow-out-of-box link to Scryfall).

## 32px icon buttons

**Any icon-only button larger than 24px and smaller than 40px uses this
tier**, not a one-off size: **32×32px**, **20px icon**, otherwise same
shape rules as the 24px tier (no visible border, transparent until hover,
radius matches whatever tier the component already used — 6px for
circular/minimal ones, 8px for the modal/drawer family).

```css
.some-32px-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px; /* or 6px, or 50% for a circular one — match context */
  background: transparent;
  cursor: pointer;
}
```

```jsx
<SomeIcon size={20} />
```

Current examples: `.modal-close`, `.drawer-toggle` (sidebar header — back/
close/invite/counters/dice/settings), `.chat-compose button` (send,
circular), `.counter-stepper button` (poison/commander-damage ±), the
life-badge's sword and ± buttons (`.life-btn`, `.life-sword-btn`).

**Does not apply** to custom, purpose-built controls that only coincidentally
fall in that size range — the dice picker's 44px grid buttons, the
`.counter-stepper`'s number display, avatar circles, image thumbnails. If a
control isn't an icon-only button (has a visible text label, isn't a
button at all), it isn't part of either tier regardless of its pixel size.

## Tooltips

Every icon-only button that performs a direct action (not a menu trigger —
see below) gets a tooltip via `data-tooltip="…"` plus a matching
`aria-label`, **not** the native `title` attribute. `title` is
browser-styled, slow to appear, inconsistent across platforms, and — worse —
if a child element lacks its own `title`, the browser falls back to showing
the nearest *ancestor's* `title` on hover. That caused a real bug here: the
mic/camera buttons sat inside a parent div with `title="Click to add
commander"`, so hovering them showed the parent's tooltip instead of
nothing. **Never put a native `title` on an element that contains a
`data-tooltip` trigger.**

The `[data-tooltip]` CSS component in `styles.css` renders instead: same
glass material as `.tile-menu` (`--overlay-bg`, blur, `--overlay-shadow`),
fading in after a short delay via `--duration-fast` / `--ease-standard`.

```jsx
<button aria-label="Mute" data-tooltip="Mute">
  <Mic size={16} />
</button>
```

**Positioning — six explicit named positions**, chosen at the call site
based on where the button actually sits in the layout (there's no runtime
viewport or container measurement, so this can't be automatic):

| `data-tooltip-pos` | Placement | Use when the trigger is... |
| --- | --- | --- |
| *(omit)* | center, above | Away from any edge — the default |
| `bottom` | center, below | Near the *top* of the viewport or a scrolling container |
| `left-top` | left-aligned, above | Near the left edge, away from the top |
| `right-top` | right-aligned, above | Near the right edge, away from the top |
| `left-bottom` | left-aligned, below | Near both the left edge and the top |
| `right-bottom` | right-aligned, below | Near both the right edge and the top |

A button near the top of *any* scrolling container (not just the browser
viewport) needs a `bottom`-family position — `.sidebar` has
`overflow-y: auto`, so a tooltip trying to render above a button in the
sidebar header gets clipped by that container's edge, never mind the
browser window. This is why the sidebar header buttons use `bottom` /
`left-bottom` / `right-bottom` while the video-tile corner controls (not
inside a scrolling container) only need `right-top`.

**Exception:** buttons that open a menu/dropdown (the tri-dot "Video
options" trigger) don't strictly need one, since opening them immediately
reveals labeled text — but adding `data-tooltip` there too is harmless and
fine for consistency. Buttons that already show a visible text label (the
dice picker, the invite "Copy" button) don't need a tooltip at all, `title`
or otherwise.

Keep tooltip copy short and imperative ("Mute", not "Mute microphone";
"Add commander damage", not "Open commander damage") — it's a hover label,
not a description.

## Modals and panels

Modals (`.lobby-modal`) and the sidebar (`.sidebar`, `.tile-menu`) share
the glass material above, 10-12px radius, and `--overlay-shadow` for
elevation. Prejoin/create-setup flows reuse the same modal shell with a
`prejoin-modal` modifier rather than a bespoke layout — new multi-step
flows in the lobby should follow that pattern (same shell, a modifier
class, and a `modal` state string per step) instead of a new component.
