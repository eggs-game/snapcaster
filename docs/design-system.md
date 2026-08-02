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
theme-aware token there would go invisible in light mode. Player names in that
banner follow the same rule at a slightly softer fixed-light opacity; their
identity must remain readable even when a browser or theme transforms the
app's normal secondary-text token.

Current examples: `.menu-btn`, `.wrong-card-btn` (thumbs-down report
button), `.card-share-btn` (share the active card to Chat with the same
Lucide MessagesSquare glyph as the Chat rail action), and
`.scryfall-link` (arrow-out-of-box link to Scryfall). On an identified or
looked-up card, those actions stay ordered as report, share, then external
details.

A temporarily disconnected video tile keeps its place in the grid for a
15-second recovery window. A fixed dark translucent overlay with normal-weight
“Reconnecting…” copy communicates that the seat is being preserved rather than
turning it into an empty tile. The Settings panel ends with a full-width
danger-role **Leave game** button; this is the explicit departure action used
to distinguish a chosen exit from a connection failure.

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
The notifications page reuses this shared header component rather than a
page-specific navigation variant: Create and Join keep the same sizing and
roles, and the signed-in display name opens the same Profile, Friends,
Settings, Notifications, and Sign out menu. Directly below its page heading,
the page uses the shared text-tab treatment for three accessible tabs—Friend
requests, Reviews received, and Reviews sent—so only one full-width activity
panel is visible at a time while its actions remain in context. The selected
tab uses the accent underline; the tab row is not enclosed in an input-like
track.
This shared `SiteHeader` is the only production page-header implementation.
Friends, public profiles, the game directory, legal pages, and moderation all
reuse it rather than maintaining page-specific link groups. Pages that do not
otherwise need account state use the lightweight account-aware routed wrapper,
so Create, Join, sign-in, notification/account menu, and sign-out behavior stay
consistent as new routes are added.
Settings follows the same account-page header in a focused 640px content
column. Its primary Save changes action sits at the right edge of the heading
on desktop and becomes full-width below the heading on small screens. Editable
profile, device, preference, and account-data groups stack without enclosing
section cards; spacing establishes their hierarchy while inputs and device rows
retain their local boundaries. Every section uses the same `--text-2xl` Geist
heading treatment as the content headings beneath profile tabs.
Friends reuses that focused account-page shell rather than maintaining a
separate dashboard layout: its “Your circle” page hero and Friends section are
unboxed, the section heading uses the same `--text-2xl` Geist treatment, and
only the search input and interactive friend rows retain local boundaries.
The signed-in profile also uses this unboxed account-page heading, with the
player's display name as the primary heading. A compact Discord identity row
uses the `--discord-brand` mark and the provider username from the private
account identity. The same row appears on a public profile only for the owner
and accepted Snapcast friends; it is absent for anonymous viewers and
non-friends. Private account email is never used as profile-page identity copy. Decks, Game
history, and Stats use
the same underlined text tabs as Notifications; Decks opens first, existing
match records live under Game history, and Stats summarizes those records in a
responsive analytics grid. Its six 16px-radius tiles show win rate, total games,
average game time, top commander, commander-damage loss rate, and average turn
length. Tiles use no iconography: the large primary value leads, the metric name
sits immediately below it, and supporting context anchors the bottom, all
left-aligned. Metric labels use regular-weight `--text-lg` secondary text so
they remain readable beneath the dominant value. The grid moves from four
columns to two and then one as space narrows.
Profile tab panels are
unboxed so their content sits directly under the tab divider; smaller content
objects such as saved-deck cards and forms keep their own local boundaries.
Game history uses one full-width row per game, preserving a clear chronological
scan order and leaving room for player names and primary match metadata without
compressing adjacent records into columns. Timing drilldowns and per-game
public-visibility controls are intentionally omitted from this surface for now.
Above the rows, a locally bounded filter surface uses the shared 36px input and
8px control radius. Result, bracket, the player's commander, opposing
commander, player, and inclusive from/to dates compose without navigation or a
server round trip. A quiet result count and conditional Clear filters action
make the current scope explicit. The grid moves from four columns to two and
then one at the account-page breakpoints.
Each record is a rounded, locally bounded card with a square commander-art
thumbnail. Results
use circular Lucide icons rather than text pills: a trophy in the success role
for wins, a skull in the danger role for losses, and a neutral minus for draws.
The date and recorded-turn count use `--text-sm` so the primary metadata remains
readable without competing with the commander name.
Each profile panel starts with the same `--text-2xl` Geist heading row: “My
decks,” “Recent game history,” or “Stats.” The row begins one `--space-5` step
inside the panel so it remains clearly separated from the tab divider. A compact
Import deck and Add deck actions sit at the Decks heading's right edge. Import
deck accepts plaintext deck files with a Commander section or `*CMDR*` tags;
Add deck opens the shared modal shell. Deck creation fields do not remain permanently visible below the saved
cards. A second toolbar sits below the heading actions: search and sort controls
occupy the left side while the grid/list segmented control anchors to the right.
Search matches deck, commander, partner, and color-identity text. Sort options
cover name, canonical color identity, and the quantity-weighted average mana
value of nonland commander/mainboard cards. The average is provided by a compact
security-invoker Supabase view so the collection page does not download every
card merely to sort deck tiles. List view keeps its artwork rail narrow (124px on desktop), uses regular-weight
deck titles, and shows one square commander art-crop thumbnail per deck so
metadata receives most of the row width. The
profile shell begins 90px below the desktop site header (48px on
compact layouts), giving the identity block comfortable separation from the
global navigation before the tabs and deck content. Saved decks use three-column
gallery tiles with a 16px outer radius and oversized card art with a 14px radius
inside a 320px-high image window. Single commanders anchor from the top and crop
at the bottom; partner stacks use the same intentional lower-edge crop so the artwork
reads larger without lengthening the tile. Saved decks form a three-column grid
with a 24px gap and as many rows as needed, collapsing to two columns and then one as the
viewport narrows; the gallery never requires horizontal scrolling. Commander
and partner names stay on one line and truncate with an ellipsis so long names
cannot increase a tile footer's height. A compact segmented control at the right
edge of the filter toolbar uses Lucide grid and list icons to switch between the default gallery and
full-width 116px list rows; the non-sensitive preference persists per account
on the device. Card art has no
letter-placeholder layer behind it, avoiding a redundant box when both
commander images are already present.
The tiles have no inline destructive control, keeping this browsing surface
focused on deck recognition rather than deletion.
Each tile is a real link to a focused saved-deck editor rather than an inline
management surface. The editor keeps the shared site header and a 1120px
content column. Its information hierarchy borrows the useful parts of a mature
deck builder without copying marketplace UI: deck identity and total first, a
single bounded control bar second, summary metrics third, then the editing
workspace. The control bar combines search, an icon-only text/card segmented
control, Group and Sort selects, and explicit Import and Add card actions.
Import and add forms expand below that bar only while in use. Import leads with
the manual Moxfield workflow. A validated Moxfield URL produces an “Open deck
in Moxfield” link that opens in a separate tab; the user then chooses More →
Export → Copy for Moxfield, returns to Snapcast, and pastes the list. The URL is
stored only as attribution and is never requested by Snapcast. Direct URL
import is disclosed separately for public Archidekt decks.

On desktop the workspace uses a 280px sticky selected-card inspector and a
three-column grouped text list. Text rows are 36px high with quantity at the
left and mana value at the right, making a 100-card deck scannable without
turning each card into a separate panel. The alternate card view uses compact
image tiles. Selecting a card exposes quantity, deck section, swap, and remove
controls in the inspector; sideboard and considering are first-class sections.
The workspace collapses to two list columns and then one as the viewport
narrows, and the inspector stops being sticky on compact screens. The page
always shows main-deck count, sideboard count, average mana value, and unique
card count. Import is a full-list replacement; individual adds accumulate
quantity in their chosen section, while moves and swaps merge duplicates.
Successful deck mutations use the shared temporary toast pattern rather than
occupying document flow. The toast is fixed to the safe-area-aware lower-right
corner, announces through a polite atomic live region, offers an explicit close
button, and dismisses after four seconds. Its entrance animation respects
reduced-motion preferences. Action errors remain persistent inline alerts so
recovery guidance cannot disappear before the player reads it.
The join flow presents its six-character game code as six large 82px-high
verification slots with 30px mono characters. A single transparent input spans
the slots so typing, pasting, browser one-time-code autofill, validation, and
screen-reader labeling remain one accessible control; focus advances visually
through the slots without splitting keyboard interaction across six inputs.
Below the hero, the homepage includes a non-interactive four-player Commander
game preview inside a 14px rounded frame. That tighter shell follows the
10px player-tile curves with only the preview's narrow inset between them. It is coded from the same DOM classes
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
utility land. Sai, Krenko, and Giada anchor the upper-left of their camera views,
with the face-down library directly beneath them. Ghalta instead joins the green
creature row so the large creature reads as part of Nora's battlefield rather
than an isolated card beside it. The camera is represented as pointing
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
Each library is a code-rendered stack of solid sleeves rather than a graphic
card back. Three slightly offset layers create a dark rear sleeve, fine striped
card edges, and the colored top sleeve, with compact contact shadows and tiny
alignment differences that read like a physical Commander deck. Blue, red,
off-white, and green match the corresponding playmats; no mana symbol or other
graphic appears on the sleeve face. The camera
uses the corresponding four supplied full-playmat images in the same order. A
uniform 30% black background layer quiets
each printed playmat without dimming the cards or controls above it. Playmat
art uses proportional sizing with a slight centered vertical overscan so it
fills the complete camera frame without stretching while cropping the rounded
edge baked into the supplied source outside the player tile.
The white Giada feed uses a warm yellow player accent for a distinct
life badge and border.
The two players across the table use a 180-degree camera-content rotation, so
their cards face them at the top edge of the table. Player banners, media
controls, and life totals remain unrotated and readable to the viewer.
At narrow breakpoints the desktop game surface scales as one unit, preserving its exact
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
at intermediate widths, and one on phones. Features sit directly on the page
without individual card borders or fills. Their Lucide icons are likewise
unboxed and sit close to the title, so each item reads as one compact piece of
content instead of a grid of controls. The section names only shipped product
behavior, with short descriptions that stay readable at a glance rather than
reproducing settings documentation.
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

**My Profile** is a full `/profile` page, not an overlay. It uses the shared
site header and an 1120px content shell, an unboxed identity heading, and
underlined tabs for decks, game history, and stats. Settings and Friends use
the shared focused 640px account-page shell with unboxed sections; saved-device
rows use the raised surface and 8px control radius, while privacy checkboxes
make the whole row hoverable and clickable. Public profiles keep the
query-string form `/profile?id=…` and retain their read-only layout.

Public-game cards use the normal raised panel hierarchy: 12px outer radius,
8px actions, compact status pills, and commander names as quiet surface chips.
When verified playable-card Scryfall IDs are available, a 158px commander-card
strip sits at the top of the panel. Its 98px-wide card frames are large enough
to read as cards at directory scale, and every unoccupied player seat appears
beside them as a dashed card-shaped placeholder. The strip uses full card-frame
images from Scryfall's static CDN and never adds per-card API lookups to
discovery. Discovery cards intentionally
omit player names so the commander lineup stays the only public table detail.
The directory reuses the segmented-control selected state for Lobby/Live and
keeps its intentionally small filter set on the bare page canvas: a compact
search field, an “All brackets” selector, and a table-size selector that
defaults to four players. Field titles and the old filter-panel shell are
omitted so selected values do the labeling. Both selectors use the app's
custom dense-glass listbox pattern—shared 10px overlay radius, blur, border,
shadow, 34px option rows, and raised selected state—rather than an OS-native
menu that breaks visual consistency. Lobby results always require an
open player seat; that invariant is no longer presented as an optional
checkbox. Directory cards omit the redundant Lobby badge and separate player,
viewer, and bracket metadata with quiet middle dots rather than icons. Their
Play and Watch actions use a 40px target, while Live retains its status badge. Create game
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
inside My Profile as a horizontally scrolling, snap-aligned rail of 208px
tiles. Each tile leads with the framed Scryfall printing; partner cards overlap
without perspective. The rail uses the shared 8px inset scrollbar, the remove
action uses the 24px / 16px tiny tier, and the add form keeps the shared 34px
inputs and 8px radii.

Friends live on their own account page and use quiet 40px link rows with
semantic presence dots. Player search uses the normal labeled input and a
compact raised result list. Notifications use raised 52px action rows on the
separate Notifications page.
Public-profile social actions are labeled 34px buttons, with block and deletion
using the existing danger color role rather than introducing a new red.

The post-game review prompt reuses the modal shell, centered 42px star buttons,
and shared form styling. The persistent Leave game control matches the owner
trigger's glass material and shifts beside it when both are visible.

The restricted moderation page uses the public-profile page width and the
standard 14px operational panel shell. Reports and appeals stay in separate
responsive columns, with quiet evidence blocks and labeled actions; permanent
or destructive decisions never use an icon-only control.

Visitor prejoin uses the same 34px, 8px-radius segmented-button treatment as
other two-choice settings for **Mic on / Join muted**. The selected choice is
applied to the audio track before WebRTC negotiation begins, avoiding a brief
live-microphone leak. Visitors retain the normal microphone toggle and device
picker in Settings after joining.

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
Passing the turn keeps the established player order but skips any seat whose
life total is 0. If no living player remains, the active turn does not move.

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
Every tooltip has a viewport-aware maximum width and wraps long labels. Triggers
on the right edge use a right-aligned top/bottom position, bottom-row video
controls open upward, and top-edge controls open downward; centered defaults
are reserved for controls with safe space on both sides.

Game creators receive a second rail divider below Settings followed by a
Lucide Chess Queen action. It opens the **Game management** view, where every
player and visitor appears in an individual 10px-radius surface tile. Tiles
show identity and role first, then relevant commander and media-state details;
visitor tiles omit camera and commander rows that do not apply to them.
Visitors also receive the Commander damage rail action and can inspect every
player's commander-damage and poison totals, but all values render as read-only
text. Dice, life editing, and counter steppers remain player-only.

Card-recognition failures reuse the Cards panel's full dotted placeholder tile
instead of collapsing to a text error. The miniature outlined card swaps its
sparkles for a magnifying glass and the message reads **Image lookup failed**;
when capture evidence exists, a small Help me fix it link opens the wrong-card
report from inside the placeholder.
Clicking a card in video always opens the sidebar directly to Cards at the
start of identification, even when Chat was the previously selected sidebar
tab or the content panel was collapsed.

The Chat panel header shows a compact 16px people icon and the live room count,
including players and visitors. Its hover/focus popover is right-aligned to the
trigger so it expands inward from the panel edge, lists every participant, and
labels visitors separately without exposing additional controls.

First-use card lookup uses a full-size card tile beneath search: a dashed
card-outline illustration and a short explanation of where selected or looked-up
cards will appear. It is replaced as soon as the player has a current or recent
card result. While a camera click or text lookup is identifying a card, that
same full-size dashed placeholder remains in place and changes its message to
“Identifying…”, so the panel does not collapse to a small status line or retain
the previous result. The Recent section itself is hidden until there is at
least one recent card.

The chat composer’s sound-picker trigger uses this exact 32px tier. It opens
a compact, 360px-wide glass-material picker through a document-level portal
above the composer so neither the sidebar’s clipped scroll area nor its
backdrop layer can cut it off or place video above it. The two-option
Emotes/Creatures segmented control sits above a category-scoped search field,
with Emotes selected by default.
The composer sits 8px above the panel’s bottom resting position and uses a
10px radius, keeping it visually distinct without reading as a pill.
Picker rows use Lucide Cat/Laugh icons and a single-line effect name rather
than repeating the selected category as a subtitle. The chosen effect is shown
as a compact, dismissible chip in the composer; its matching message chip
remains visible in chat even if browser playback is blocked. Effects play at
30% of the listener’s normal browser/tab volume because the source clips are
mastered loudly, without a separate in-app
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
objects in Chat. The “Rolled” result uses the panel’s normal 400 text weight,
matching life and ready activity rather than reading like a heading. Life
clicks wait for a two-second pause and report the net change. Cards and Chat
are separate left-rail actions rather than a segmented
control; a new Chat entry adds a small notification dot to the Chat icon until
it is opened. Opening Chat always returns its message list to the latest entry.
Full-width card, life, commander-damage, and sound objects align to the same
left and right edges as the composer; compact dice and ready-state objects
continue to hug their contents. Chat entries use 24px vertical spacing so
activity remains distinct without making the timeline feel sparse.

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

## Tabs and segmented controls

Tabs navigate between peer content views. They are plain text on a single
bottom divider, with the selected tab indicated by a 2px
`--accent-primary` underline and primary text. Hover changes text color only;
it does not add a filled button background. Account/Profile and Notifications
use this pattern through `.account-page-tabs`. On small screens each tab shares
the available row width so labels remain easy to target.

Segmented controls are input-like choice groups rather than content
navigation. The screenshot-style pattern is the canonical segmented control:
a bordered, rounded track containing equal-width options with a raised selected
segment. Keep this treatment for compact mutually exclusive controls such as
Settings choices, game-directory view filters, visitor role selection, and the
sound picker. Do not use it for page or panel tabs.

### Segmented-control construction

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
`.two-up` modifier: Video fit, Chat notifications, and Turn notifications;
4-up via `.four-up`: Outgoing video quality), `.view-options` (3-up: Game view). These
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

`.control-row`, `.device-field`, and `.theme-field` use the normal group-ending
spacing. `.control-row` and `.device-field` both default to a 24px bottom margin
(i.e. "assume you're the last field in your group"); a `.device-field-tight`
modifier and matching `.theme-field-tight` modifier (16px) exist where a field
is mid-group — the camera toggle → camera select → outgoing-quality → Video-fit
sequence in the same "Video" section. Reach for those modifiers rather than a
one-off margin value when a new field needs to sit mid-group.

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
The camera preview may place a 34px icon-only control over its top-right
corner. It uses the compact 8px-radius button treatment, remains inside the
preview bounds, and carries its selected state into the matching in-game
video control so the image does not change orientation after joining.

Signed-in account navigation uses the compact account dropdown as a route
switcher, not as a container for account UI. Its primary destinations are
Profile, Friends, Settings, and Notifications. Each destination is a full page
with the shared sticky site header and normal content gutter:

- **Profile** owns saved Commander decks, match history, and moderation status.
- **Friends** owns player search, social connections, presence, and friend
  removal.
- **Settings** owns editable identity, saved entry devices, appearance,
  presence/privacy preferences, and account data controls.
- **Notifications** owns friend requests and game invitations plus private
  reviews received and sent. Unread activity is counted in both the account
  trigger and the Notifications menu row; opening the page marks notification
  records read without removing them.

Account activity pages use 12px surface radii and compact 7-9px nested row
radii. Keep review history grouped separately from actionable requests so
private feedback reads as durable account history instead of a transient toast.

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
Commander search suggestions follow the same edge-aware overlay rule as tile
menus: on a bottom-row tile they use the `menu-up` modifier and open above the
field, preventing the viewport edge from clipping the available commander
choices.

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
