export type VoiceGroup = {
  label: string;
  voices: { id: string; label: string }[];
};

export const VOICE_GROUPS: VoiceGroup[] = [
  {
    label: "Recommended for interviews",
    voices: [
      { id: "dawn", label: "Dawn — professional, deliberate (US)" },
      { id: "josh", label: "Josh — conversational, professional (US)" },
      { id: "claire", label: "Claire — lively, conversational (US)" },
      { id: "summer", label: "Summer — empathetic, aesthetic (US)" },
      { id: "michael", label: "Michael — deep, calming (US)" },
      { id: "will", label: "Will — narrative (UK)" },
    ],
  },
  {
    label: "More English voices",
    voices: [
      { id: "andy", label: "Andy — soft, young (US)" },
      { id: "zoe", label: "Zoe — smooth, young (US)" },
      { id: "alexis", label: "Alexis — high-pitched, chatty (US)" },
      { id: "pete", label: "Pete — direct, fast-paced (US)" },
      { id: "brian", label: "Brian — chatty, expressive (US)" },
      { id: "diana", label: "Diana — older, calming (US)" },
      { id: "grace", label: "Grace — Southern, warm (US)" },
      { id: "kai", label: "Kai — slow, ASMR (US)" },
      { id: "nathan", label: "Nathan — deep, older (US)" },
      { id: "audrey", label: "Audrey — older, calming (US)" },
      { id: "dylan", label: "Dylan — theatrical, energetic (US)" },
      { id: "melissa", label: "Melissa — clear, instructive (UK)" },
    ],
  },
  {
    label: "Multilingual",
    voices: [
      { id: "gautam", label: "Gautam — Hindi/English" },
      { id: "luke", label: "Luke — Mandarin/English" },
      { id: "lily", label: "Lily — Mandarin/English" },
      { id: "alexei", label: "Alexei — Russian/English" },
      { id: "max", label: "Max — German/English" },
      { id: "anna", label: "Anna — German/English" },
      { id: "antoine", label: "Antoine — French/English" },
      { id: "jennie", label: "Jennie — Korean/English" },
      { id: "kevin", label: "Kevin — Korean/English" },
      { id: "kenji", label: "Kenji — Japanese/English" },
      { id: "yuki", label: "Yuki — Japanese/English" },
      { id: "nova", label: "Nova — Italian/English" },
      { id: "marco", label: "Marco — Italian/English" },
      { id: "sofia", label: "Sofia — Spanish/English" },
      { id: "santiago", label: "Santiago — Spanish/English" },
      { id: "leo", label: "Leo — Spanish (LatAm)/English" },
    ],
  },
];

export const DEFAULT_VOICE = "dawn";
