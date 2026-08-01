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
  - The dark material scale carries a restrained warm ink-blue cast: blue is
    present in canvas and elevated surfaces, while warm off-white text/borders
    and a faint violet ambient tone keep it from reading as cold navy. The
    landing page repeats this dark scale even when the saved app theme is light.
  - **Compatibility aliases** (`--bg`, `--panel`, `--dim`, `--text`, etc.)
    map to the semantic names above for older components mid-migration.
    Don't introduce new usages of an alias — use the semantic name it
    points to (e.g. `--text-secondary`, not `--dim`) so two components that
    should match don't silently diverge if the alias is ever repointed.
  - Seat/player colors (`TILE_COLORS` in `Game.jsx`) are the one place
    chromatic, non-themed color is intentional — they identify a specific
    player and must stay stable across light/dark mode.
- **Typography** — `--text-xs` (12px) through `--text-3xl` (28px), one
  scale for the whole app. `--font-heading` (Geist, with Inter fallback) is
  reserved for `h1`–`h6`; `--font-sans` (Inter) remains the UI/body face so
  controls and dense game surfaces do not reflow. `--font-mono` (Geist Mono)
  is for code/diagnostic output.
- **Spacing** — `--space-2` (8px) / `--space-5` (20px) cover the common
  cases; most components still use literal px for one-off gaps. If you're
  reaching for a third spacing value repeatedly, consider adding a token
  rather than a new magic number.
  - Page-level shells use a shared 1280px content grid with a 20px minimum
    gutter. `--page-max-width` defines the cap and `--page-gutter` expresses
    the matching header padding, so the wordmark and page content keep the same
    left/right edges at every width.
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

## Scroll areas

Every scrollable surface uses the same unobtrusive scrollbar: an **8px**
transparent track and a rounded, inset `--border-default` thumb that becomes
`--border-strong` on hover. A panel may reserve scrollbar space with
`scrollbar-gutter: stable` when changing content width would be distracting,
but that gutter must remain visually transparent rather than becoming a gray
column beside the content.

Sidebar views reserve **60px** of bottom padding so the final card, control,
or activity object never rests against the panel edge. Chat is the exception:
its outer panel keeps the composer at the normal bottom inset, while the
scrolling message list carries that same 60px trailing clearance.

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

Icons in labeled dropdown action rows use the same **16px** visual size, so
the video options actions (flip, pass turn, shuffle position, and check
ready) align with the small controls that open the menu without overpowering
their text labels.

## Full-width primary actions

Primary actions that submit or perform the main action in a sidebar form use
the same full-width treatment as Roll dice: `var(--input-height)` tall, 8px
radius, `var(--text-primary)` fill and border, and inverse 600-weight label.
They darken slightly on hover and keep their full width while disabled. The
wrong-card report’s Submit report action uses this pattern.

## Account and role controls

The home header is transparent over the hero: Snapcast stays left-aligned and
Discord sign-in or the signed-in profile stays right-aligned, without a filled
bar, blur, border, or shadow. The image-free dark hero canvas provides its
contrast. Hero copy and actions form a centered single-column stack. Its single continuous promise—online
paper Magic with real table feel—caps at 60px, balances naturally across lines,
and uses restrained `-0.025em` tracking so Geist stays compact without its
letterforms colliding. The supporting line names recognition, emotes, sound
effects, table banter, and a live audience as the reasons that promise is
credible. It sits directly beneath the centered headline at a 760px maximum,
with the two actions centered below it in normal reading order at every
breakpoint. It caps at 20px and uses 84%-opacity warm white—clearer
than ordinary secondary copy while remaining subordinate to the headline. The
homepage intentionally uses no decorative hero
imagery. Public-game discovery lives in the dedicated games directory rather
than on the homepage, keeping the landing page focused on its two primary
actions: Make game and View games. Those hero actions are intentionally larger
than ordinary controls (158px minimum width by 56px high, 18px type): Make game
opens creation, while View games is a real link to the public lobby directory.
The hero is deliberately shorter than a full viewport (roughly 70vh, capped at
680px) so the product surface begins to enter the page sooner. The home header's
40px controls sit immediately before the account control: Create is opaque warm
white, Join uses a strong white outline, and the equally sized signed-in profile
control shows only the display name and notification badge (no avatar). They
open the same modal and account flows as the primary page actions.
The join flow presents its six-character game code as six large 82px-high
verification slots with 30px mono characters. A single transparent input spans
the slots so typing, pasting, browser one-time-code autofill, validation, and
screen-reader labeling remain one accessible control; focus advances visually
through the slots without splitting keyboard interaction across six inputs.
Below the hero, the homepage includes a non-interactive four-player Commander
game preview inside a 24px rounded frame. It is coded from the same DOM classes
as the actual game rather than drawn as a separate marketing mockup: the real
left icon rail and card panel, video-panel spacing, 2×2 tile grid, Commander
banners, media controls, mana pips, life-badge corner rules, and
active-turn treatment all render through the production game styles. The camera
contents remain coded playmats, with a small shared set of full-frame Scryfall
card images placed on every battlefield (never art crops). Their static card IDs
avoid API lookups and let the browser cache repeated cards across all four feeds;
the example remains live DOM rather than a screenshot.
Every card slot in the homepage preview—including commanders, battlefield rows,
the current lookup, and Recents—uses a standard framed printing. Borderless,
extended-art, art-only, signature, artist-series, and showcase variants are not
used, so the card name and rules frame always remain visible.
The playmat artwork is centered with a slight overscan inside each preview
camera. This crops the rounded or transparent border baked into the source art
outside the video viewport, while preserving the player tile's own radius and
the full-surface darkening overlay.
Each feed presents three readable battlefield rows: creatures at the top,
artifacts and enchantments in the middle, and four to seven mostly basic lands
at the bottom. The cards in every row stay within the displayed commander's
color identity, so the coded board reads like a plausible Commander game rather
than a decorative card fan. The sample lists follow the commanders' current
EDHREC recommendations: Sai on blue, Krenko on red, Giada on white, and Ghalta
on green. Each land row is mostly the matching basic land plus one EDHREC-listed
utility land. The commander anchors the upper-left of every camera view, with
the face-down library directly beneath it. The camera is represented as pointing
straight down: every commander, library sleeve, creature, support, and land uses
the same card width and the rows have no perspective, skew, or casual-angle
rotation. Cards begin at 78px on the normal 1280px preview and grow fluidly to
102px as the showcase expands; row gaps grow with them, while land overlap eases
from 26px to 18px so the larger battlefield breathes without losing its grouped
rows. Creatures and lands may still tap with an exact 90-degree turn. A shared tabletop-lighting treatment uses a tight contact
shadow plus a soft, low-offset falloff from one overhead light direction. It
avoids bright outlines and large dark halos that make cards look like floating
cutouts, while restrained contrast and small exposure differences preserve the
printed-card feel without obscuring rules text.
Each library is one code-rendered card
back—not a sleeve image or stacked-card asset—with an inset frame and a simple
SVG mana mark whose color matches that player's playmat: water for Maya, flame
for Drew, sun for Sam, and tree for Nora. No offset second-card silhouette is
rendered. The camera
uses the corresponding four supplied full-playmat images in the same order. A
uniform 30% black background layer quiets
each printed playmat without dimming the cards or controls above it. Playmat
art slightly overscans the complete camera frame so only the rounded border
baked into the source is cropped; the white Giada feed uses a warm yellow player accent for a distinct
life badge and border. At narrow
breakpoints the desktop game surface scales as one unit, preserving its exact
layout instead of inventing a different preview-only responsive composition.
The preview's main surface uses one 4px inset on every outer edge, while the
video grid adds no one-sided padding. Including the preview border, the visible
sidebar and last video tile therefore land at matching 5px left/right insets.
The player tiles use a compact 10px outer radius with concentric 8px camera,
banner, and life-badge corners, so their square backgrounds never
visually flatten the player-screen corners;
the top gutter is intentionally zero so the sidebar and first video row share
one exact top edge. Because this is a scaled product view, its player banners
compress the production 52px treatment to 42px, with 11px player names, 12px
commander names, 9px mana pips, and 14px media icons. As the showcase expands,
those values rise smoothly to 48px, 13px, 14px, 10px, and 16px respectively;
chat copy, timestamps, life totals, and its room count follow the same restrained
scale. The real game still keeps its full-size controls and type.
The preview section has no eyebrow; its headline is centered over the coded app
and caps at 42px so it introduces the product surface without competing with the
hero promise. Its compact 36px top inset keeps that headline visually attached
to the rounded showcase edge instead of floating in excess empty space.
On supporting browsers, the section itself uses a view-timeline animation to
grow from the shared 1280px page-content width and 32px radius to an edge-to-edge
surface over a shorter entry range: expansion starts at roughly 25% entry and
finishes around 68%, so a normal downward scroll reaches the full-width product
view quickly. The headline and coded app surface grow with the rounded section
without the site's usual 1280px content cap. At full expansion, the app keeps a
40px gutter on each side of the viewport; scrolling upward reverses the width
change. The coded app has a 690px minimum height and a 1.6:1 responsive frame,
so it becomes taller in proportion to its expanding width instead of flattening
into a wide strip. The centered headline keeps a constant type size and moves
into position without visually scaling. The
short initial delay keeps the section's edges aligned with the header and hero
before expansion. Its
32px radius stays constant while the width grows, then snaps square only at the
very end of the view-timeline so the transition reads as zoom rather than a
progressively sharpening card. The narrow-screen fallback stays inset and
rounded rather than sacrificing usable page gutters. Legal navigation and the
project attribution live in a separate full-width footer below this surface;
they never overlay or visually belong to the coded game preview.
While the showcase is visible, its real sidebar classes run a quiet looping
product story: it begins with Ghalta already displayed from the previous lookup
and populated Recent-card rows below it. Rhystic Study then animates into the
current result and moves Ghalta into Recents, using the same card rows and share
icon as the real sidebar. That share action confirms, then the rail switches to the real chat view with
the shared Rhystic Study and short table conversation. One player responds with
the real in-app sound-effect message object for “Boo!”, including its local-play
control, so the demo also shows how table reactions appear in chat. The preview
composer keeps the real app's drum-shaped sound-picker control beside the
message field. Chat body,
card, sound, and composer copy uses compact 12px type, with 11px names and 9px
timestamps, to match the scaled player banners without changing real-game chat.
The chat header also carries a
quiet people icon and the total room count so viewers can see that the four-seat
table has a live audience. The preview sidebar is a compact
320px variant and the main game gap contracts to 6px so recognition remains
useful without taking space from the four camera feeds. The loop pauses offscreen and
reduced-motion visitors see the complete chat state without timed transitions.
The product preview is followed by a twelve-card feature grid on the shared
1280px content width. It uses four columns on wide screens, three and then two
at intermediate widths, and one on phones. Each non-interactive feature card
uses the standard 12px panel radius, a quiet raised-surface fill, and one Lucide
icon inside a 42px informational well; those icon wells are not buttons and do
not inherit the interactive icon-button tiers. The section names only shipped
product behavior, with short descriptions that stay readable at a glance
rather than reproducing settings documentation.
Account access remains secondary to those hero actions. Outside the landing
header, Discord sign-in and signed-in profile controls remain 34px-tall labeled
buttons with an 8px radius and the shared glass material. The profile menu uses the same dense glass
overlay as other floating menus. Authentication failures appear directly below
that control rather than disappearing into a game-creation modal.

The join modal presents Player and Visitor as two equal choice cards, using the
standard 8px control radius and focus color for the active role. At phone widths
they stack into one column. The post-setup account prompt reuses the normal modal
shell and action hierarchy; both choices have equal width so creating an account
remains optional rather than visually mandatory.

**My Profile** uses the same modal shell rather than introducing a separate
settings language. Its 52px account avatar anchors the header; public identity,
saved entry devices, and preferences are separated by the standard subtle
divider. Saved-device rows use the raised surface and 8px control radius, while
the privacy checkbox makes the whole row hoverable and clickable.

Public-game cards use the normal raised panel hierarchy: 12px outer radius,
8px actions, compact status pills, and commander names as quiet surface chips.
When verified playable-card Scryfall IDs are available, a 146px commander-card
stack sits at the top of the panel; it uses full card-frame images from Scryfall's static CDN and
never adds per-card API lookups to discovery. Discovery cards intentionally
omit player names so the commander lineup stays the only public table detail.
The directory reuses the segmented-control selected state for Lobby/Live and
keeps its intentionally small filter set on the bare page canvas: a compact
search field, an “All brackets” selector, and a table-size selector that
defaults to four players. Field titles and the old filter-panel shell are
omitted so selected values do the labeling. Lobby results always require an
open player seat; that invariant is no longer presented as an optional
checkbox. Directory cards omit the redundant Lobby badge and place bracket
beside player/watcher counts, while Live retains its status badge. Create game
and Join game are distinct header actions on the right and deep-link to their
matching homepage flows.

The owner-only Game Management trigger is a labeled glass control over the
video panel, paired with a compact lifecycle badge. Its modal separates players
and visitors into 52px participant rows; row actions use the standard 24px /
16px tiny-button tier, while lifecycle actions use labeled 38px controls.
During a live game, the player-owned **I’m out** control mirrors the same
34px dense-glass treatment on the opposite edge; its active state uses the
existing danger border/text role and remains explicitly reversible.

Public profiles use a 76px identity avatar, a four-card summary grid, and the
same 12px panel shell used by discovery cards. Saved Commander decks live
inside My Profile as raised 50px rows; their remove action uses the 24px /
16px tiny tier, and the add form keeps the shared 34px inputs and 8px radii.

Friends and notifications remain inside My Profile. Notifications use raised
52px action rows; friends use quiet 40px link rows with semantic presence dots.
Profile search uses the normal labeled input and a compact raised result list.
Public-profile social actions are labeled 34px buttons, with block and deletion
using the existing danger color role rather than introducing a new red.

The post-game review prompt reuses the modal shell, centered 42px star buttons,
and shared form styling. The persistent Leave game control matches the owner
trigger's glass material and shifts beside it when both are visible.

The restricted moderation page uses the public-profile page width and the
standard 14px operational panel shell. Reports and appeals stay in separate
responsive columns, with quiet evidence blocks and labeled actions; permanent
or destructive decisions never use an icon-only control.

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

Current examples: `.modal-close`, `.drawer-toggle` (the sidebar’s 48px-wide
navigation rail — card lookup/counters/dice, then invite/settings below the
divider — and the close
action at the right of every panel header), `.counter-stepper button`
(poison/commander-damage ±), the life-badge's sword and ± buttons
(`.life-btn`, `.life-sword-btn`).

Life-badge ± buttons use a normal click for a one-point adjustment. Holding
either button makes repeated five-point adjustments, so common life changes
stay fast without making a one-point correction awkward.

The sidebar navigation is a dedicated 48px left rail on the app background;
the glass panel begins at the scrollable content column without a separator.
Rail actions stay vertically aligned, with a subtle divider separating the
Settings gear from the game actions. Closing the panel collapses only the
content column: the 48px rail remains visible. Its top panel control reopens
the previously active view; on hover it changes to a right arrow while closed
and a left arrow while open. The card-stack lookup action sits directly beneath
it with the normal icon-button hover treatment. Panel views have no duplicate
close action inside their headers. The rail’s first action aligns with the
content panel’s game-name text. When the panel is closed, the persistent rail
shows no active selection; the selected treatment returns when it is opened.

Rail tooltips use the horizontal `right` anchor so they appear beside the
icons and expand into the app instead of clipping at the viewport’s left edge.

First-use card lookup uses a full-size card tile beneath search: a dashed
card-outline illustration and a short explanation of where selected or looked-up
cards will appear. It is replaced as soon as the player has a current or recent
card result; the Recent section itself is hidden until there is at least one
recent card.

The chat composer’s sound-picker trigger uses this exact 32px tier. It opens
a compact, 360px-wide glass-material picker through a document-level portal
above the composer so neither the sidebar’s clipped scroll area nor its
backdrop layer can cut it off or place video above it. The two-option
Emotes/Creatures segmented control sits above a category-scoped search field,
with Emotes selected by default.
Picker rows use Lucide Cat/Laugh icons and a single-line effect name rather
than repeating the selected category as a subtitle. The chosen effect is shown
as a compact, dismissible chip in the composer; its matching message chip
remains visible in chat even if browser playback is blocked. Effects play at
85% of the listener’s normal browser/tab volume, without a separate in-app
mute or volume control. Pressing Enter sends either text or a selected effect,
so an effect can be sent on its own.

Incoming standard chat messages use a compact 24px circular initial avatar to
the left of the bubble. The sender’s name is exposed in the avatar tooltip,
keeping the message itself compact; timestamps sit below their bubbles.
Remote structured chat objects use that same avatar treatment rather than a
separate sender-name header, and the object itself is the only visible card.

Dice and coin results use a temporary, non-interactive glass card centered
over the video panel. It reuses the former sidebar result-card proportions,
keeps coin values human-readable as Heads/Tails, and fades away after three
seconds. The dice sidebar keeps the selector and a separate full-width Roll
dice/Flip coin action together, so changing the selection never triggers a
roll; the action sits 12px below the selector. Dice rolls, shared cards,
life-total changes, and ready-check outcomes each appear as compact structured
objects in Chat; life clicks wait for a two-second pause and report the net
change. Cards and Chat are separate left-rail actions rather than a segmented
control; a new Chat entry adds a small notification dot to the Chat icon until
it is opened. Opening Chat always returns its message list to the latest entry.

The Dice panel’s counter generator begins 24px below that action. Its staging
well is headed by the same secondary 14px field label as the Die selector and
shows one 96px circular sticker that can be dragged onto the local video. The
counter picker does not repeat a redundant label: its Generate counter action
and accessible name make its purpose clear. It opens upward into a compact
search field plus a 224px scrolling list, avoiding an unwieldy native menu.
Counter placement uses pointer-driven dragging rather than the browser's native
drag cursor. While a counter is over the local video tile, that tile renders
the exact 40px placement preview with no browser icon to communicate position.
Placed stickers use a uniform 40px player-colored circle with centered, balanced text;
hover/focus expands them into a 60px circle. Multi-word labels may wrap over
two lines, but individual words never break; unusually long single words use a
slightly smaller label to fit. Owner-only 22px controls appear in that state,
while remote stickers remain read-only. Sticker positions are normalized to the
video area so they remain stable across tile and viewport sizes. This is a
board annotation, so it uses the owning player's chosen tile color in either
application theme rather than a semantic status color. A clean 3px white rim,
without an inset border, gives every sticker a physical-sticker edge. On
adjustable stickers, the owner-only Lucide Minus/Plus buttons are fixed 22px
circles above the sticker; the Lucide X dismiss control stays just outside its
upper-right edge with the same 8px gap, so it remains distinct from value adjustment. Their current
magnitude is part of the label itself (for example, +2/+2), never a separate
number beneath it. An invisible hover bridge spans the gap to these controls,
so moving the pointer out of the circle never dismisses them before they can
be clicked. On exit, the controls complete their normal opacity fade before
the sticker returns to its compact size, so they never appear squeezed.

**Does not apply** to custom, purpose-built controls that only coincidentally
fall in that size range — the dice picker's select control, the
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

## Segmented controls

The pill-shaped multi-option toggle (Settings' Game view / Video fit /
Appearance rows): a bordered track (`--border-default`, 8px radius,
`var(--input)` background) containing equal-width buttons with **2px gap**
between them, 2px inner padding. Selected state is `aria-pressed="true"`
driving a raised background (`--bg-surface-raised`) plus a subtle inset
shadow — not a color change alone, so it reads correctly for colorblind
users too.

```css
.some-segmented-control {
  display: grid;
  grid-template-columns: repeat(N, 1fr); /* N = option count */
  gap: 2px;
  height: var(--input-height);
  padding: 2px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--input);
}
.some-segmented-control button:hover { background: var(--bg-hover); color: var(--text-primary); }
.some-segmented-control button[aria-pressed="true"] { background: var(--bg-surface-raised); color: var(--text-primary); box-shadow: 0 1px 2px var(--inset-shadow), inset 0 0 0 1px var(--border-subtle); }
```

Current examples: `.theme-options` (3-up: Appearance; 2-up via the
`.two-up` modifier: Video fit, Chat notifications, and Turn notifications), `.view-options` (3-up: Game view). These
two classes are near-duplicates that predate this doc — don't add a third
one; extend `.theme-options` with a modifier the way `.two-up` does.

## Settings-panel field spacing

Every icon-only or text-only button, and every custom control, gets a
`:hover` state — no exceptions. A control users can interact with but that
looks identical before and after hovering reads as broken, not minimal.

Vertical rhythm for stacked fields in the sidebar Settings panel and
similar forms: **16px** between fields that belong to the same labeled
group (a toggle button and the dropdown it controls, e.g. "Camera on" →
camera select), **24px** before the next group's header. In practice this
means the *last* field in a group carries the 24px margin (so the
following header doesn't need its own top margin), while every other field
in that group carries 16px:

```
[Header]
field            } 16px margin-bottom (not last in group)
field            } 16px margin-bottom
field            } 24px margin-bottom (last in group)
[Next header]
field            } ...
```

`.control-row` and `.device-field` both default to a 24px bottom margin
(i.e. "assume you're the last field in your group"); a `.device-field-tight`
modifier (16px) exists for the one case so far where a field is
mid-group — the camera toggle → camera select pairing, both followed by
the Video-fit segmented control in the same "Video" section. Reach for
that modifier (or add an equivalent) rather than a one-off margin value
when a new field needs to sit mid-group.

Field labels are handled the same way as icon buttons above — a control
that already has an on-screen state (the "Camera on"/"Mic on" toggle text)
doesn't need a repeated `<span>` label like "Camera" above its dropdown;
use `aria-label` on the `<select>` instead and let the toggle button above
it carry the visible label.

## Modals and panels

Modals (`.lobby-modal`) and the sidebar (`.sidebar`, `.tile-menu`) share
the glass material above, 10-12px radius, and `--overlay-shadow` for
elevation. Prejoin/create-setup flows reuse the same modal shell with a
`prejoin-modal` modifier rather than a bespoke layout — new multi-step
flows in the lobby should follow that pattern (same shell, a modifier
class, and a `modal` state string per step) instead of a new component.

The card lookup's expanded-card preview (`.card-preview-backdrop` /
`.card-preview-tile`) is the compact exception: it uses the same scrim and
glass material but contains only the card image, with no title or action
bar. Its 40px shell and 32px image corners deliberately crop the printed card
art at the larger zoomed scale, removing visible white card corners. It closes
on a backdrop click or Escape; do not add a separate close button unless the
preview gains other controls.

## Video tile fit modes

Commander color-identity pips sit directly after the commander name on the left
of the 52px-tall video overlay. Only colored identity pips are shown — generic
and colorless mana are not repeated — while a fully colorless commander gets a
single neutral pip. The commander row is pulled 5px toward the player-name row;
its pips are 11px circles with a 1px 50%-opacity white outline and a 2px downward
optical offset, using darker mana-inspired white, blue, black, red, and green
tones so their colors read clearly against the translucent banner.
When a commander has a legal co-commander rule (Partner, any matching
Partner—[text] variant, Partner with, Friends forever, Choose a Background, or
Doctor's companion), its display adds a compact `/ Add partner` affordance on
the same row. Once selected, the two names share that row and their color
identities are combined for the pips.
The commander edit field occupies that same row position, so entering edit
mode does not shift the name downward.

Settings → Video fit controls how each player's camera stream fills its
tile in the game grid, independent of `.grid`'s own layout mode
(tiles/follow/hero):

- **Cover** (default) — the `<video>` fills the entire tile, whatever
  shape the CSS Grid cell happens to compute (`object-fit: cover`,
  stretched to 100%×100%). This is the original behavior; it over-crops
  when a tile's cell shape is more square than the camera's native 16:9,
  which reads as "zoomed in."
- **Fit** (`.grid-fit-16-9` on `.grid`, internal value `"16:9"`) — the
  *tile itself keeps its normal grid-cell size* (banner, life badge, border
  unchanged); only the `<video>` element inside is boxed to a centered
  16:9 area that fits within the available space (`width: 100%; height:
  auto; max-height: 100%; aspect-ratio: 16/9`), with `object-fit: contain`
  scaling the full camera frame down to fit that box — nothing is cropped,
  even if it means pillarboxing inside the box on top of any letterboxing
  the box already has relative to the tile. This is deliberately different
  from constraining the *tile's* aspect ratio — that would leave gaps in
  the grid and shrink the banner/life-badge along with it, which isn't
  what "Fit" should mean here. (An earlier version of this mode used
  `object-fit: cover` here, which still cropped — changed after feedback
  that it should show strictly *more* of the frame than Cover mode, never
  less.)
  - The banner's dark semi-transparent scrim (`.commander-banner`'s
    `background`) exists so name text stays legible over moving video. In
    16:9 mode the banner (pinned to the tile's top edge) frequently sits
    over letterboxed background instead of actual video, so
    `.grid-fit-16-9 .commander-banner` drops the scrim — the name text
    itself is untouched, only the tint goes.

If a third fit mode is ever needed, extend the `videoFit` state
(`"cover" | "16:9"`, persisted to `localStorage` as `snapcast-video-fit`)
and the two-option segmented control in Settings rather than introducing a
parallel toggle.
