// Shared chat effects should sit well below voices and other game audio. The
// source clips are mastered loudly, so a low fixed gain keeps sender playback,
// receiver playback, and picker previews from overpowering conversation.
const SOUND_EFFECT_LEVEL = 0.1;

// The room broadcast carries only these stable IDs, never a remote audio URL.
// That keeps playback predictable and means every browser uses the same vetted
// local asset. `durationMs` is deliberately capped below three seconds.
export const SOUND_EFFECTS = Object.freeze([
  {
    id: "dinosaur-roar",
    label: "Dinosaur",
    category: "creatures",
    tags: ["dinosaur", "t-rex", "reptile", "roar", "dragon"],
    src: "/sounds/dinosaur-roar.mp3",
    startAt: 41.45,
    durationMs: 2800,
  },
  {
    id: "dinosaur-rasp",
    label: "Dragon",
    category: "creatures",
    tags: ["dragon", "dinosaur", "reptile", "hiss", "rasp"],
    src: "/sounds/dinosaur-rasp.mp3",
    startAt: 0,
    durationMs: 2200,
  },
  {
    id: "deep-creature-roar",
    label: "Wurm",
    category: "creatures",
    tags: ["beast", "wurm", "demon", "hydra", "roar"],
    src: "/sounds/deep-creature-roar.wav",
    startAt: 0.1,
    durationMs: 2500,
  },
  {
    id: "reptile-bellow",
    label: "Crocodile",
    category: "creatures",
    tags: ["dinosaur", "reptile", "beast", "bellow"],
    src: "/sounds/reptile-bellow.mp3",
    startAt: 0,
    durationMs: 2800,
  },
  {
    id: "hive-chitter",
    label: "Sliver",
    category: "creatures",
    tags: ["sliver", "tyranid", "insect", "mantis", "scorpion", "phyrexian", "chitter", "hive"],
    src: "/sounds/hive-chitter.ogg",
    startAt: 0,
    durationMs: 2200,
  },
  {
    id: "alien-shriek",
    label: "Eldrazi",
    category: "creatures",
    tags: ["eldrazi", "horror", "alien", "shapeshifter", "fractal", "c'tan", "shriek"],
    src: "/sounds/alien-shriek.ogg",
    startAt: 0,
    durationMs: 2600,
  },
  {
    id: "demon-roar",
    label: "Demon",
    category: "creatures",
    tags: ["demon", "hellion", "wurm", "hydra", "dragon", "avatar", "god", "roar"],
    src: "/sounds/demon-roar.ogg",
    startAt: 0,
    durationMs: 2800,
  },
  {
    id: "beast-howl",
    label: "Werewolf",
    category: "creatures",
    tags: ["wolf", "werewolf", "dog", "jackal", "coyote", "hyena", "nightmare", "beast", "howl"],
    src: "/sounds/beast-howl.ogg",
    startAt: 0,
    durationMs: 2600,
  },
  {
    id: "odd-creature-chirp",
    label: "Beeble",
    category: "creatures",
    tags: ["beeble", "brushwagg", "phelddagrif", "imp", "goblin", "faerie", "mouse", "rat", "squirrel", "otter", "raccoon", "hamster", "chirp"],
    src: "/sounds/odd-creature-chirp.ogg",
    startAt: 0,
    durationMs: 2200,
  },
  {
    id: "spectral-moan",
    label: "Spirit",
    category: "creatures",
    tags: ["spirit", "specter", "wraith", "zombie", "vampire", "nightmare", "ghost", "moan"],
    src: "/sounds/spectral-moan.ogg",
    startAt: 0,
    durationMs: 2500,
  },
  {
    id: "ooze-squelch",
    label: "Ooze",
    category: "creatures",
    tags: ["ooze", "fungus", "germ", "inkling", "slime", "squelch"],
    src: "/sounds/ooze-squelch.ogg",
    startAt: 0,
    durationMs: 2200,
  },
  {
    id: "aquatic-bubbles",
    label: "Kraken",
    category: "creatures",
    tags: ["kraken", "leviathan", "whale", "shark", "frog", "salamander", "turtle", "aquatic", "bubbles"],
    src: "/sounds/aquatic-bubbles.ogg",
    startAt: 0,
    durationMs: 2400,
  },
  {
    id: "treefolk-creak",
    label: "Treefolk",
    category: "creatures",
    tags: ["plant", "treefolk", "scarecrow", "fungus", "wood", "creak"],
    src: "/sounds/treefolk-creak.ogg",
    startAt: 0,
    durationMs: 2200,
  },
  {
    id: "construct-spring",
    label: "Construct",
    category: "creatures",
    tags: ["construct", "golem", "myr", "servo", "skeleton", "metal", "spring"],
    src: "/sounds/construct-spring.ogg",
    startAt: 0,
    durationMs: 2400,
  },
  {
    id: "robot-chirp",
    label: "Myr",
    category: "creatures",
    tags: ["robot", "dalek", "cyberman", "necron", "myr", "servo", "thopter", "astartes", "chirp"],
    src: "/sounds/robot-chirp.ogg",
    startAt: 0,
    durationMs: 2200,
  },
  {
    id: "mechanical-drone",
    label: "Thopter",
    category: "creatures",
    tags: ["drone", "blinkmoth", "phyrexian", "synth", "thopter", "construct", "machine", "buzz"],
    src: "/sounds/mechanical-drone.ogg",
    startAt: 0.1,
    durationMs: 2800,
  },
  {
    id: "cosmic-pulse",
    label: "Avatar",
    category: "creatures",
    tags: ["c'tan", "eye", "orb", "reflection", "fractal", "glimmer", "avatar", "god", "djinn", "elemental", "cosmic"],
    src: "/sounds/cosmic-pulse.ogg",
    startAt: 0,
    durationMs: 2600,
  },
  {
    id: "bear-growl",
    label: "Bear",
    category: "creatures",
    tags: ["bear", "beast", "cat", "lion", "boar", "bison", "aurochs", "ox", "growl"],
    src: "/sounds/bear-growl.mp3",
    startAt: 1.85,
    durationMs: 2800,
  },
  {
    id: "horse-neigh",
    label: "Horse",
    category: "creatures",
    tags: ["horse", "pegasus", "unicorn", "nightmare", "neigh"],
    src: "/sounds/horse-neigh.mp3",
    startAt: 0,
    durationMs: 1800,
  },
  {
    id: "elephant-call",
    label: "Elephant",
    category: "creatures",
    tags: ["elephant", "beast", "mastodon", "trumpet"],
    src: "/sounds/elephant-call.mp3",
    startAt: 4.4,
    durationMs: 2800,
  },
  {
    id: "whale-call",
    label: "Leviathan",
    category: "creatures",
    tags: ["whale", "leviathan", "kraken", "aquatic", "ocean", "call"],
    src: "/sounds/whale-call.mp3",
    startAt: 0.4,
    durationMs: 2800,
  },
  {
    id: "baby-cry",
    label: "Baby cry",
    category: "emotes",
    tags: ["baby", "cry", "sad", "funny"],
    src: "/sounds/baby-cry.ogg",
    startAt: 8.05,
    durationMs: 2800,
  },
  {
    id: "annoyed-sigh",
    label: "Annoyed sigh",
    category: "emotes",
    tags: ["sigh", "annoyed", "tired", "frustrated"],
    src: "/sounds/annoyed-sigh.mp3",
    startAt: 0.45,
    durationMs: 2500,
  },
  {
    id: "cartoon-laugh",
    label: "Cartoon laugh",
    category: "emotes",
    tags: ["laugh", "happy", "funny", "joke"],
    src: "/sounds/cartoon-laugh.ogg",
    startAt: 6.35,
    durationMs: 2600,
  },
  {
    id: "angry-grunt",
    label: "Angry grunt",
    category: "emotes",
    tags: ["angry", "grunt", "annoyed", "mad", "frustrated"],
    src: "/sounds/angry-grunt.mp3",
    startAt: 0,
    durationMs: 1000,
  },
  {
    id: "boo",
    label: "Boo!",
    category: "emotes",
    tags: ["boo", "crowd", "disapprove", "bad", "audience"],
    src: "/sounds/boo.mp3",
    startAt: 0,
    durationMs: 2800,
  },
  {
    id: "applause",
    label: "Applause",
    category: "emotes",
    tags: ["applause", "clap", "cheer", "good", "congrats", "win"],
    src: "/sounds/applause.mp3",
    startAt: 0,
    durationMs: 2800,
  },
  {
    id: "short-fart",
    label: "Fart",
    category: "emotes",
    tags: ["fart", "funny", "gross", "fail"],
    src: "/sounds/short-fart.mp3",
    startAt: 0,
    durationMs: 1400,
  },
  {
    id: "crickets",
    label: "Awkward crickets",
    category: "emotes",
    tags: ["crickets", "awkward", "silence", "bad joke", "quiet"],
    src: "/sounds/crickets.mp3",
    startAt: 0,
    durationMs: 2800,
  },
  {
    id: "evil-laugh",
    label: "Evil laugh",
    category: "emotes",
    tags: ["evil", "laugh", "villain", "scheme", "victory"],
    src: "/sounds/evil-laugh.mp3",
    startAt: 0,
    durationMs: 2800,
  },
]);

const SOUND_EFFECTS_BY_ID = new Map(SOUND_EFFECTS.map((sound) => [sound.id, sound]));
const SOUND_BUFFER_CACHE = new Map();
let sharedAudioContext = null;

export function getSoundEffect(soundId) {
  return SOUND_EFFECTS_BY_ID.get(String(soundId || "")) || null;
}

export function searchSoundEffects(query = "", category = "all") {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return SOUND_EFFECTS.filter((sound) => {
    if (category !== "all" && sound.category !== category) return false;
    if (!words.length) return true;
    const haystack = `${sound.label} ${sound.tags.join(" ")}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

function getAudioContext() {
  if (sharedAudioContext && sharedAudioContext.state !== "closed") return sharedAudioContext;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  sharedAudioContext = new AudioContextClass();
  return sharedAudioContext;
}

function loadSoundBuffer(context, src) {
  if (!SOUND_BUFFER_CACHE.has(src)) {
    SOUND_BUFFER_CACHE.set(src, fetch(src).then(async (response) => {
      if (!response.ok) throw new Error(`Sound file could not be loaded (${response.status}).`);
      return context.decodeAudioData(await response.arrayBuffer());
    }).catch((error) => {
      SOUND_BUFFER_CACHE.delete(src);
      throw error;
    }));
  }
  return SOUND_BUFFER_CACHE.get(src);
}

export function playSoundEffect(soundOrId, volume = 0.5, onError) {
  const sound = typeof soundOrId === "string" ? getSoundEffect(soundOrId) : soundOrId;
  const context = getAudioContext();
  if (!sound?.src || !context) {
    onError?.(new Error("This browser does not support sound-effect playback."));
    return () => {};
  }

  let source = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { source?.stop(); } catch { /* already ended */ }
  };

  // Resume immediately while the preview button still owns the click's user
  // activation. Fetching/decoding can safely finish afterward on this running
  // context, and remote messages can reuse it once a listener has interacted.
  const resume = context.state === "suspended" ? context.resume() : Promise.resolve();
  void (async () => {
    await resume;
    const buffer = await loadSoundBuffer(context, sound.src);
    if (stopped) return;
    const gain = context.createGain();
    gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0)) * SOUND_EFFECT_LEVEL;
    source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);
    const startAt = Math.min(
      Math.max(0, Number(sound.startAt) || 0),
      Math.max(0, buffer.duration - 0.05),
    );
    const duration = Math.min(sound.durationMs / 1000, buffer.duration - startAt);
    source.start(0, startAt, duration);
    source.onended = () => { stopped = true; };
  })().catch((error) => {
    onError?.(error);
    stop();
  });
  return stop;
}

// A short, intentionally quiet two-tone notification. Keeping this synthesized
// avoids a network request and makes notifications available as soon as a room
// connects. It is separate from shared sound effects, which are played at the
// room's normal sound-effect level.
export function playChatNotification(onError) {
  const context = getAudioContext();
  if (!context) {
    onError?.(new Error("This browser does not support notification playback."));
    return;
  }

  const resume = context.state === "suspended" ? context.resume() : Promise.resolve();
  void resume.then(() => {
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    gain.connect(context.destination);

    [[659, 0], [880, 0.075]].forEach(([frequency, offset]) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      oscillator.connect(gain);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.11);
    });
  }).catch((error) => onError?.(error));
}

// A gentle, welcoming two-second arpeggio reserved for the moment the active
// turn moves to the local player. It deliberately differs from the short chat
// chime without feeling like an alert.
export function playTurnNotification(onError) {
  const context = getAudioContext();
  if (!context) {
    onError?.(new Error("This browser does not support notification playback."));
    return;
  }

  const resume = context.state === "suspended" ? context.resume() : Promise.resolve();
  void resume.then(() => {
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.value = 0.72;
    master.connect(context.destination);

    [
      [523.25, 0, 0.68, 0.075],
      [659.25, 0.18, 0.76, 0.07],
      [783.99, 0.38, 0.88, 0.065],
      [1046.5, 0.6, 1.3, 0.09],
    ].forEach(([frequency, offset, duration, level]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(level, now + offset + 0.045);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + duration);
    });
  }).catch((error) => onError?.(error));
}
