import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { PLAYLIST } from "@/lib/playlist";

function fmt(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function PixelRadio({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 16 12" className="pixelated h-10 w-14 shrink-0" aria-hidden shapeRendering="crispEdges">
      <rect x="11" y="0" width="1" height="3" className="fill-lavender" />
      <rect x="0" y="3" width="16" height="9" className="fill-accent" />
      <rect x="1" y="4" width="14" height="7" className="fill-surface" />
      <rect x="2" y="5" width="5" height="5" className="fill-secondary" />
      <rect x="3" y="6" width="3" height="3" className={playing ? "fill-primary" : "fill-muted"} />
      <rect x="9" y="5" width="5" height="2" className="fill-primary" />
      <rect x="9" y="8" width="1" height="2" className="fill-lavender" />
      <rect x="11" y="8" width="1" height="2" className="fill-lavender" />
      <rect x="13" y="8" width="1" height="2" className="fill-lavender" />
    </svg>
  );
}

export function LofiPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wantPlay = useRef(false);
  const track = PLAYLIST[index]!;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    setError(null);
    setTime(0);
    setDuration(0);
    a.load();
    if (wantPlay.current) {
      a.play().catch(() => {
        /* handled by onError / autoplay block */
      });
    }
  }, [index]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      wantPlay.current = false;
      a.pause();
      return;
    }
    wantPlay.current = true;
    try {
      await a.play();
      setError(null);
    } catch (e) {
      wantPlay.current = false;
      if ((e as DOMException)?.name === "NotAllowedError") setError("Tap play to start audio");
      else setError("Track unavailable");
    }
  };

  const go = (dir: 1 | -1) => setIndex((i) => (i + dir + PLAYLIST.length) % PLAYLIST.length);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-accent bg-surface/95 backdrop-blur">
      <audio
        ref={audioRef}
        src={track.src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => go(1)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => {
          setPlaying(false);
          wantPlay.current = false;
          setError("Track unavailable — add audio file");
        }}
      />
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-3 px-3 sm:px-5">
        <PixelRadio playing={playing} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-pixel text-[0.6rem] text-lavender">
            {playing && <span className="mr-2 text-accent animate-blink">♪</span>}
            {track.title}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            {error ? (
              <span className="font-mono-retro text-base text-warning" role="status">{error}</span>
            ) : (
              <>
                <span className="font-mono-retro text-base text-muted-foreground">{fmt(time)}</span>
                <input
                  type="range"
                  aria-label="Seek"
                  min={0}
                  max={duration || 0}
                  step={1}
                  value={time}
                  disabled={!duration}
                  onChange={(e) => {
                    if (audioRef.current) audioRef.current.currentTime = Number(e.target.value);
                  }}
                  className="h-1 flex-1 max-w-xs cursor-pointer accent-primary"
                />
                <span className="font-mono-retro text-base text-muted-foreground">{fmt(duration)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous track">
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            className="btn-pixel btn-cyan !px-3 !py-2"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button className="icon-btn" onClick={() => go(1)} aria-label="Next track">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
