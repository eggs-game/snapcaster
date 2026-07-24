# Sound effect asset register

The chat sound picker plays only the local assets listed here. A chat packet
contains an allow-listed `soundId`, never an audio URL supplied by a player.
Playback is stopped after the configured duration (all are 2–3 seconds), even
when the source recording is longer. Longer recordings use a measured
`startAt` offset so playback begins on the actual sound rather than silence.

| ID | Clip | Category | Source / license | Playback |
| --- | --- | --- | --- | --- |
| `dinosaur-roar` | Dinosaur | Creature | [T-rex Calls, OpenGameArt](https://opengameart.org/content/t-rex-calls) — CC0 | 2.8 s from 41.45 s |
| `dinosaur-rasp` | Dragon | Creature | [Small Dino Raspy Calls, OpenGameArt](https://opengameart.org/content/small-dino-raspy-calls) — CC0 | 2.2 s |
| `deep-creature-roar` | Wurm | Creature | [CC0 Deep Monster Roar, OpenGameArt](https://opengameart.org/content/cc0-deep-monster-roar) — CC0 | 2.5 s from 0.1 s |
| `reptile-bellow` | Crocodile | Creature | [Tyrannosaurus Rex, SoundBible](https://soundbible.com/1782-Tyrannosaurus-Rex-.html) — public domain | 2.8 s |
| `hive-chitter` | Sliver | Creature | [80 CC0 creature SFX #2, OpenGameArt](https://opengameart.org/content/80-cc0-creture-sfx-2) — CC0 | Up to 2.2 s |
| `alien-shriek` | Eldrazi | Creature | [80 CC0 creature SFX #2, OpenGameArt](https://opengameart.org/content/80-cc0-creture-sfx-2) — CC0 | Up to 2.6 s |
| `demon-roar` | Demon | Creature | [80 CC0 creature SFX #2, OpenGameArt](https://opengameart.org/content/80-cc0-creture-sfx-2) — CC0 | Up to 2.8 s |
| `beast-howl` | Werewolf | Creature | [80 CC0 creature SFX, OpenGameArt](https://opengameart.org/content/80-cc0-creature-sfx) — CC0 | Up to 2.6 s |
| `odd-creature-chirp` | Beeble | Creature | [80 CC0 creature SFX, OpenGameArt](https://opengameart.org/content/80-cc0-creature-sfx) — CC0 | Up to 2.2 s |
| `spectral-moan` | Spirit | Creature | [80 CC0 creature SFX #2, OpenGameArt](https://opengameart.org/content/80-cc0-creture-sfx-2) — CC0 | Up to 2.5 s |
| `ooze-squelch` | Ooze | Creature | [40 CC0 water/splash/slime SFX, OpenGameArt](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) — CC0 | Up to 2.2 s |
| `aquatic-bubbles` | Kraken | Creature | [40 CC0 water/splash/slime SFX, OpenGameArt](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) — CC0 | Up to 2.4 s |
| `treefolk-creak` | Treefolk | Creature | [100 CC0 metal and wood SFX, OpenGameArt](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) — CC0 | Up to 2.2 s |
| `construct-spring` | Construct | Creature | [100 CC0 metal and wood SFX, OpenGameArt](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) — CC0 | Up to 2.4 s |
| `robot-chirp` | Myr | Creature | [50 CC0 Sci-Fi SFX, OpenGameArt](https://opengameart.org/content/50-cc0-sci-fi-sfx) — CC0 | Up to 2.2 s |
| `mechanical-drone` | Thopter | Creature | [50 CC0 Sci-Fi SFX, OpenGameArt](https://opengameart.org/content/50-cc0-sci-fi-sfx) — CC0 | 2.8 s from 0.1 s |
| `cosmic-pulse` | Avatar | Creature | [50 CC0 Sci-Fi SFX, OpenGameArt](https://opengameart.org/content/50-cc0-sci-fi-sfx) — CC0 | Up to 2.6 s |
| `bear-growl` | Bear | Creature | [Bear Angry Growl, Freesound](https://freesound.org/people/celldroid/sounds/763026/) — CC0 | 2.8 s from 1.85 s |
| `horse-neigh` | Horse | Creature | [horse neigh shortened, Freesound](https://freesound.org/people/shadoWisp/sounds/269571/) — CC0 | Full one-shot, capped at 1.8 s |
| `elephant-call` | Elephant | Creature | [Elephant sound, Freesound](https://freesound.org/people/ikbenraar/sounds/819668/) — CC0 | 2.8 s from 4.4 s |
| `whale-call` | Leviathan | Creature | [Baleines, Freesound](https://freesound.org/people/davidou/sounds/88449/) — CC0 | 2.8 s from 0.4 s |
| `baby-cry` | Baby cry | Emote | [Crying newborn baby, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Crying_newborn_baby.ogg) — CC0 | 2.8 s from 8.05 s |
| `annoyed-sigh` | Annoyed sigh | Emote | [Sigh_1_Female, Freesound](https://freesound.org/s/318084/) — CC0 | 2.5 s from 0.45 s |
| `cartoon-laugh` | Cartoon laugh | Emote | [Cartoon Laugh, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Cartoon_Laugh.ogg) — CC0 | 2.6 s from 6.35 s |
| `scared-scream` | Scared scream | Emote | [Demonic Woman Scream, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nick121087_-_Demonic_Woman_Scream_(cc0)_(freesound).mp3) — CC0 | 2.2 s |
| `angry-grunt` | Angry grunt | Emote | [Angry Grunt, Freesound](https://freesound.org/people/Rocotilos/sounds/341489/) — CC0 | Full one-shot, capped at 1.0 s |
| `boo` | Boo! | Emote | [boo.wav, Freesound](https://freesound.org/people/dr_skitz/sounds/353925/) — CC0 | 2.8 s |
| `applause` | Applause | Emote | [Small applause, Freesound](https://freesound.org/people/Breviceps/sounds/462362/) — CC0 | 2.8 s |
| `short-fart` | Fart | Emote | [Short Fart, Freesound](https://freesound.org/people/M0nsterHD/sounds/814854/) — CC0 | Full one-shot, capped at 1.4 s |
| `crickets` | Awkward crickets | Emote | [crickets, Freesound](https://freesound.org/people/FreethinkerAnon/sounds/129678/) — CC0 | 2.8 s |
| `evil-laugh` | Evil laugh | Emote | [Evil Laugh, Freesound](https://freesound.org/people/adiantheman/sounds/829881/) — CC0 | 2.8 s |
| `wrong-buzzer` | Wrong buzzer | Emote | [Right/Wrong Buzzer, Freesound](https://freesound.org/people/jamhamsterrofl/sounds/697400/) — CC0 | 2.8 s |

The initial library intentionally stays curated: an effect is added only when
its source, license, and fit are clear. Creature labels use familiar Magic
creature types while the source column records what the underlying sound
actually is.
