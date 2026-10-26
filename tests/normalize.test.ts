import { describe, expect, it } from "vitest";
import { normalizeArtist, normalizeTitle, songKey } from "@/lib/normalize";

describe("normalization", () => {
  it("strips remaster and featuring noise from titles", () => {
    expect(normalizeTitle("Creep - Remastered 2009")).toBe("creep");
    expect(normalizeTitle("Bohemian Rhapsody - 2011 Remaster")).toBe("bohemian rhapsody");
    expect(normalizeTitle("Song (feat. Someone)")).toBe("song");
    expect(normalizeTitle("Song [Remastered]")).toBe("song");
    expect(normalizeTitle("Another One - Radio Edit")).toBe("another one");
  });

  it("matches artists across spelling variants", () => {
    expect(normalizeArtist("The Beatles")).toBe(normalizeArtist("Beatles"));
    expect(normalizeArtist("Beyoncé")).toBe("beyonce");
    expect(normalizeArtist("Simon & Garfunkel")).toBe("simon and garfunkel");
    expect(songKey("Sigur Rós", "Hoppípolla")).toBe("sigur ros::hoppipolla");
  });
});
