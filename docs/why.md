# Why Snapcast exists

## The problem

Playing paper Magic over video works badly for one specific reason: **you
cannot read your opponent's cards.**

Everything else about a remote game is fine. You can see faces, hear tone,
track life totals on paper. But Magic is a game of hidden and shifting
information across a board that can hold thirty permanents, and the moment
someone plays a card you do not recognise, the game stops. Somebody leans into
their webcam. Somebody reads rules text aloud. Somebody types a card name into
Scryfall and shares their screen.

A four-player Commander game can lose several minutes an hour to this. It is
the single thing that makes remote paper Magic feel worse than sitting at a
table.

## Why existing tools fall short

SpellTable and similar tools do recognise cards, but the recognition is the
weak part of the experience rather than the strong one. The common failure
modes are all the same shape:

- **It reads the compressed video stream.** Video is aggressively compressed
  for bandwidth, and card text is exactly the high-frequency detail that
  compression discards first.
- **It wants the card presented to the camera.** Hold it up, straight on,
  well lit, filling the frame. That is not how cards sit during a game — they
  lie flat on a table, at an angle, tapped sideways, under a dice, half in
  shadow.
- **It struggles beyond the current Standard sets.** Players own alternate
  arts, showcase frames, retro borders, Secret Lairs and promos. A recogniser
  trained on one printing per card fails on the versions people actually
  sleeve up.

The result is that players stop trusting it and go back to reading cards
aloud, which is the thing the tool was supposed to eliminate.

## What Snapcast does differently

The guiding principle: **recognition must work on the board as it actually
is, not on a card presented for scanning.**

Four decisions follow from that.

**Never look at the video stream.** Clicking a card on someone else's tile
asks *their* browser to photograph its own camera at full native resolution
and send that crop over a peer-to-peer data channel. The compressed stream is
only ever for humans to look at. See [recognition.md](recognition.md).

**Index every printing, not every card.** All ~110,000 English paper
printings from Scryfall — every alternate art, every basic land, every
showcase frame. If a player owns it, it is in the index.

**Assume the card is in a bad position.** Tilted, tapped 90°, upside down
because it belongs to the player across the table, partly covered, dimly lit,
with glare. The pipeline generates many candidate framings of a single click
rather than assuming the card is where you clicked.

**Measure against realistic scenes, not clean scans.** A benchmark that feeds
the recogniser tidy card images will report 99% and tell you nothing. Ours
renders whole tables of cards under realistic conditions and clicks them the
way a player does. See [testing.md](testing.md).

## What "working" means

Concretely, on the current benchmark of realistic table scenes:

- **100%** of cards that do not overlap a neighbour are identified correctly
- **~1.6s median** identification time
- Both high-confidence paths (exact visual match, ORB art match) have been
  **100% precise** across runs — when the app is confident, it is right

The remaining failures are concentrated in cards that physically overlap
another card, which is uncommon in real play.

## Constraints that shape everything

- **No stateful application server.** Vercel serves the app and two small
  stateless endpoints: one exchanges a private Cloudflare TURN key for
  short-lived browser credentials, and one reports aggregate TURN usage.
  Supabase Realtime carries signaling and public chat. Media, captures, and
  private whispers travel over encrypted WebRTC: directly when possible, or
  through Cloudflare TURN when a VPN/NAT/firewall blocks the direct path.
  Opt-in wrong-card reports explicitly save a cropped capture plus diagnostics
  to private Supabase Storage for later curation. No live stream is stored.
- **Free to run.** The whole stack sits on free tiers.
- **Physics is the real limit.** A 20-card playmat on a 720p camera simply
  does not contain enough pixels per card. 1080p is borderline; 4K is
  comfortable. The pipeline is careful never to waste captured pixels, but it
  cannot invent them.

## Non-goals

- Not a digital Magic client. No rules enforcement, no game state, no stack.
  The cards are real and the players run the game.
- Not a deck tracker or collection manager.
- Not a replacement for Scryfall — it links out for full card details.
