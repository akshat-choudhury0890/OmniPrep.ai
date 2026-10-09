/**
 * Lo-fi playlist. Drop your MP3s into /public/audio with these names
 * (or edit the src paths). Missing files show an "unavailable" state.
 */
export interface Track {
  title: string;
  artist: string;
  src: string;
}

export const PLAYLIST: Track[] = [
  { title: "Track 01 — Midnight Notes", artist: "Lo-fi", src: "/audio/lofi-1.mp3" },
  { title: "Track 02 — Rainy Library", artist: "Lo-fi", src: "/audio/lofi-2.mp3" },
  { title: "Track 03 — Last Chapter", artist: "Lo-fi", src: "/audio/lofi-3.mp3" },
];
