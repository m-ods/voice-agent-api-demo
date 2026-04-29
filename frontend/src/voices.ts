export type VoiceGroup = {
  label: string;
  voices: { id: string; label: string }[];
};

export const VOICE_GROUPS: VoiceGroup[] = [
  {
    label: "Recommended for interviews",
    voices: [
      { id: "ivy", label: "Ivy — professional, deliberate (US)" },
      { id: "james", label: "James — conversational, professional (US)" },
      { id: "emma", label: "Emma — lively, young (US)" },
      { id: "autumn", label: "Autumn — empathetic, conversational (US)" },
      { id: "david", label: "David — deep, calming (US)" },
      { id: "oliver", label: "Oliver — narrative (UK)" },
    ],
  },
  {
    label: "More English voices",
    voices: [
      { id: "tyler", label: "Tyler — theatrical, energetic (US)" },
      { id: "sam", label: "Sam — soft, young (US)" },
      { id: "mia", label: "Mia — smooth, young (US)" },
      { id: "bella", label: "Bella — high-pitched, chatty (US)" },
      { id: "jack", label: "Jack — direct, fast-paced (US)" },
      { id: "kyle", label: "Kyle — chatty, expressive (US)" },
      { id: "helen", label: "Helen — older, calming (US)" },
      { id: "martha", label: "Martha — Southern, warm (US)" },
      { id: "river", label: "River — slow, ASMR (US)" },
      { id: "victor", label: "Victor — deep, older (US)" },
      { id: "eleanor", label: "Eleanor — older, calming (US)" },
      { id: "sophie", label: "Sophie — clear, instructive (UK)" },
    ],
  },
  {
    label: "Multilingual",
    voices: [
      { id: "arjun", label: "Arjun — Hindi/English" },
      { id: "ethan", label: "Ethan — Mandarin/English" },
      { id: "mei", label: "Mei — Mandarin/English" },
      { id: "dmitri", label: "Dmitri — Russian/English" },
      { id: "lukas", label: "Lukas — German/English" },
      { id: "lena", label: "Lena — German/English" },
      { id: "pierre", label: "Pierre — French/English" },
      { id: "mina", label: "Mina — Korean/English" },
      { id: "joon", label: "Joon — Korean/English" },
      { id: "ren", label: "Ren — Japanese/English" },
      { id: "hana", label: "Hana — Japanese/English" },
      { id: "giulia", label: "Giulia — Italian/English" },
      { id: "luca", label: "Luca — Italian/English" },
      { id: "lucia", label: "Lucia — Spanish/English" },
      { id: "mateo", label: "Mateo — Spanish/English" },
      { id: "diego", label: "Diego — Spanish (LatAm)/English" },
    ],
  },
];

export const DEFAULT_VOICE = "ivy";

const VOICE_IDS = new Set(VOICE_GROUPS.flatMap((g) => g.voices.map((v) => v.id)));

// Voice IDs change occasionally on the server — fall back to the default if the
// stored choice is no longer valid so we don't fail the session.
export function resolveVoice(id: string | null | undefined): string {
  return id && VOICE_IDS.has(id) ? id : DEFAULT_VOICE;
}
