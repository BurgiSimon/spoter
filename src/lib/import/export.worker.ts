/// <reference lib="webworker" />
import { gzipSync, strToU8 } from "fflate";
import { parseSpotifyExport, type InputFile } from "./spotify-export";

/** Parses and gzips a Spotify export off the main thread. */
self.onmessage = (event: MessageEvent<{ files: InputFile[] }>) => {
  try {
    const parsed = parseSpotifyExport(event.data.files);
    const { stats, ...payload } = parsed;
    const gz = gzipSync(strToU8(JSON.stringify(payload)), { level: 6 });
    (self as unknown as Worker).postMessage({ ok: true, stats, gz }, [gz.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
