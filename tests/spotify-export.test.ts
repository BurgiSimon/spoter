import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseSpotifyExport } from "@/lib/import/spotify-export";

const extended = [
  {
    ts: "2024-03-01T10:03:30Z",
    ms_played: 210000,
    master_metadata_track_name: "Creep",
    master_metadata_album_artist_name: "Radiohead",
    master_metadata_album_album_name: "Pablo Honey",
    spotify_track_uri: "spotify:track:70LcF31zb1H0PyJoS1Sx1r",
    skipped: false,
    ip_addr: "203.0.113.4",
  },
  {
    ts: "2024-03-01T10:04:00Z",
    ms_played: 9000,
    master_metadata_track_name: "Creep",
    master_metadata_album_artist_name: "Radiohead",
    spotify_track_uri: "spotify:track:70LcF31zb1H0PyJoS1Sx1r",
    skipped: true,
  },
  {
    ts: "2024-03-01T11:00:00Z",
    ms_played: 1000000,
    master_metadata_track_name: null,
    episode_name: "A podcast",
  },
];

const accountData = [
  { endTime: "2023-12-24 18:00", artistName: "Radiohead", trackName: "Creep", msPlayed: 200000 },
  { endTime: "2023-12-24 18:05", artistName: "Slowdive", trackName: "Alison", msPlayed: 240000 },
];

const library = {
  tracks: [
    {
      artist: "Slowdive",
      album: "Souvlaki",
      track: "Alison",
      uri: "spotify:track:1N5f8d4oZ8Ff4Yh0OBLw3v",
    },
  ],
  bannedTracks: [
    { artist: "Nickelback", track: "Photograph", uri: "spotify:track:0XyZ1XyZ1XyZ1XyZ1XyZ1X" },
  ],
  albums: [],
};

const playlists = {
  playlists: [
    {
      name: "Rainy days",
      items: [
        {
          track: {
            trackName: "Alison",
            artistName: "Slowdive",
            albumName: "Souvlaki",
            trackUri: "spotify:track:1N5f8d4oZ8Ff4Yh0OBLw3v",
          },
        },
        { track: null, episode: { episodeName: "x" } },
      ],
    },
  ],
};

describe("Spotify export parser", () => {
  it("parses a zip with every supported file and dedupes tracks", () => {
    const zip = zipSync({
      "Spotify Extended Streaming History/Streaming_History_Audio_2024.json": strToU8(
        JSON.stringify(extended),
      ),
      "Spotify Account Data/StreamingHistory_music_0.json": strToU8(JSON.stringify(accountData)),
      "Spotify Account Data/YourLibrary.json": strToU8(JSON.stringify(library)),
      "Spotify Account Data/Playlist1.json": strToU8(JSON.stringify(playlists)),
      "Spotify Account Data/Userdata.json": strToU8(JSON.stringify({ email: "x@example.com" })),
    });
    const parsed = parseSpotifyExport([{ name: "my_spotify_data.zip", bytes: zip }]);

    expect(parsed.stats.files).toBe(4);
    // Creep (by id and by name), Alison, Photograph
    expect(parsed.tracks).toHaveLength(3);
    const creep = parsed.tracks.findIndex((t) => t.title === "Creep");
    expect(parsed.tracks[creep]!.id).toBe("70LcF31zb1H0PyJoS1Sx1r");
    expect(parsed.plays.filter((p) => p[0] === creep)).toHaveLength(3);
    // Short play is a skip; the podcast is ignored.
    expect(parsed.plays.filter((p) => p[3] === 1)).toHaveLength(1);
    expect(parsed.stats.skippedNonMusic).toBe(1);
    expect(parsed.library).toHaveLength(1);
    expect(parsed.banned).toHaveLength(1);
    expect(parsed.playlists[0]!.items).toHaveLength(1);
    // Never leaks fields we don't need.
    expect(JSON.stringify(parsed)).not.toContain("203.0.113.4");
    expect(JSON.stringify(parsed)).not.toContain("example.com");
  });

  it("uses the start of playback as the timestamp", () => {
    const parsed = parseSpotifyExport([
      {
        name: "Streaming_History_Audio_2024.json",
        bytes: strToU8(JSON.stringify(extended.slice(0, 1))),
      },
    ]);
    expect(parsed.plays[0]![1]).toBe(Date.parse("2024-03-01T10:00:00Z") / 1000);
  });
});
