const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const CODE_LENGTH = 6;
export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

// A room code is the only access key to a game. Six characters from a CSPRNG
// provide roughly 887 million uniformly distributed, unpredictable values.
export function makeCode() {
  const out = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(out);
  const limit = Math.floor(0x100000000 / CODE_CHARS.length) * CODE_CHARS.length;
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    let value = out[i];
    while (value >= limit) {
      const extra = new Uint32Array(1);
      crypto.getRandomValues(extra);
      value = extra[0];
    }
    code += CODE_CHARS[value % CODE_CHARS.length];
  }
  return code;
}
