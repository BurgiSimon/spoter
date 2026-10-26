#!/usr/bin/env node
// Writes spoter-demo-export.zip: a fake Spotify data export (extended streaming history +
// library) so you can try the import without waiting for Spotify's real one.
import { writeFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";

const songs = [
  ["Radiohead", "Weird Fishes/Arpeggi", 60],
  ["Radiohead", "Reckoner", 45],
  ["Radiohead", "Karma Police", 30],
  ["Slowdive", "Alison", 40],
  ["Slowdive", "When the Sun Hits", 50],
  ["Slowdive", "Sugar for the Pill", 25],
  ["Beach House", "Space Song", 70],
  ["Beach House", "Myth", 35],
  ["Cocteau Twins", "Heaven or Las Vegas", 30],
  ["My Bloody Valentine", "Only Shallow", 28],
  ["Mazzy Star", "Fade Into You", 42],
  ["Portishead", "Glory Box", 33],
  ["Massive Attack", "Teardrop", 38],
  ["The xx", "Intro", 26],
  ["Tame Impala", "Let It Happen", 55],
  ["Tame Impala", "The Less I Know The Better", 48],
  ["Arctic Monkeys", "Do I Wanna Know?", 22],
  ["Phoebe Bridgers", "Motion Sickness", 31],
  ["Bon Iver", "Holocene", 29],
  ["Sigur Rós", "Hoppípolla", 18],
  ["Interpol", "Evil", 15],
  ["The Cure", "Just Like Heaven", 27],
  ["Joy Division", "Disorder", 12],
  ["Mitski", "Nobody", 20],
  ["Alvvays", "Archie, Marry Me", 24],
];

const history = [];
let t = Date.now() - 400 * 86_400_000;
for (const [artist, title, plays] of songs) {
  for (let i = 0; i < plays; i++) {
    t += 3_600_000 * (1 + (i % 7));
    history.push({
      ts: new Date(t).toISOString(),
      ms_played: 180_000 + (i % 5) * 10_000,
      master_metadata_track_name: title,
      master_metadata_album_artist_name: artist,
      master_metadata_album_album_name: null,
      spotify_track_uri: null,
      skipped: false,
    });
  }
}
// Something this listener always skips, to show negative signals.
for (let i = 0; i < 8; i++) {
  history.push({
    ts: new Date(t + i * 60_000).toISOString(),
    ms_played: 6_000,
    master_metadata_track_name: "Baby Shark",
    master_metadata_album_artist_name: "Pinkfong",
    spotify_track_uri: null,
    skipped: true,
  });
}
const library = {
  tracks: songs.slice(0, 12).map(([artist, track]) => ({ artist, track, album: "", uri: "" })),
};

const out = process.argv[2] ?? "spoter-demo-export.zip";
writeFileSync(
  out,
  zipSync({
    "Spotify Extended Streaming History/Streaming_History_Audio_demo_0.json": strToU8(
      JSON.stringify(history),
    ),
    "Spotify Account Data/YourLibrary.json": strToU8(JSON.stringify(library)),
  }),
);
console.log(
  `Wrote ${out} (${history.length} plays, ${songs.length} songs). Upload it on the Import page.`,
);
