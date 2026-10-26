"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface AudioState {
  current: string | null;
  playing: boolean;
  /** 0..1 of the 30 s preview. */
  progress: number;
  /** False until the browser lets us start audio without a fresh gesture. */
  unlocked: boolean;
  failed: string | null;
  play: (trackId: string) => void;
  toggle: (trackId: string) => void;
  stop: () => void;
}

const AudioContext = createContext<AudioState | null>(null);

/** One shared <audio> element for the whole app, so only one preview plays at a time. */
export function AudioProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    try {
      const v = Number(localStorage.getItem("spoter:volume"));
      audio.volume = Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8;
    } catch {
      audio.volume = 0.8;
    }
    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    ref.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      ref.current = null;
    };
  }, []);

  const play = useCallback(
    (trackId: string) => {
      const audio = ref.current;
      if (!audio) return;
      setFailed(null);
      if (current !== trackId) {
        audio.src = `/api/preview/${trackId}`;
        setCurrent(trackId);
        setProgress(0);
      }
      audio.play().then(
        () => setUnlocked(true),
        (err: unknown) => {
          if (err instanceof DOMException && err.name === "NotAllowedError") setUnlocked(false);
          else if (!(err instanceof DOMException && err.name === "AbortError")) setFailed(trackId);
        },
      );
    },
    [current],
  );

  const stop = useCallback(() => {
    ref.current?.pause();
  }, []);

  const toggle = useCallback(
    (trackId: string) => {
      if (current === trackId && playing) stop();
      else play(trackId);
    },
    [current, playing, play, stop],
  );

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    const onError = () => current && setFailed(current);
    audio.addEventListener("error", onError);
    return () => audio.removeEventListener("error", onError);
  }, [current]);

  const value = useMemo(
    () => ({ current, playing, progress, unlocked, failed, play, toggle, stop }),
    [current, playing, progress, unlocked, failed, play, toggle, stop],
  );
  return <AudioContext value={value}>{children}</AudioContext>;
}

export function useAudio(): AudioState {
  const ctx = use(AudioContext);
  if (!ctx) throw new Error("useAudio must be used inside <AudioProvider>");
  return ctx;
}
