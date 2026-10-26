export interface SpotifyImage {
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface SpotifyArtistRef {
  id: string | null;
  name: string;
}

export interface SpotifyArtist extends SpotifyArtistRef {
  genres?: string[];
  images?: SpotifyImage[];
}

export interface SpotifyTrack {
  id: string | null;
  name: string;
  uri: string;
  duration_ms: number;
  explicit: boolean;
  is_local?: boolean;
  type?: string;
  external_ids?: { isrc?: string };
  artists: SpotifyArtistRef[];
  album: { name: string; images: SpotifyImage[]; release_date?: string };
}

export interface Paging<T> {
  items: T[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
}

export interface CursorPaging<T> {
  items: T[];
  next: string | null;
  cursors?: { after?: string | null };
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: { id: string };
  collaborative: boolean;
  snapshot_id?: string;
  items?: { total: number };
}

export interface SpotifyMe {
  id: string;
  display_name: string | null;
  images?: SpotifyImage[];
}
