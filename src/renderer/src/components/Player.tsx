import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SongSummary } from '../../../shared/songs'

interface Track {
  songId: string
  title: string
  bounceName: string
  url: string
}

interface PlayerState {
  track: Track | null
  playing: boolean
  position: number
  duration: number
  error: string | null
  // Plays the song's preview, or pauses it if it is the one playing.
  toggle(song: SongSummary): void
  pause(): void
  resume(): void
  seek(seconds: number): void
  isPlaying(songId: string): boolean
  // Hover preview: after a short rest on the play button, plays from the middle of the song on a
  // separate element, pausing the main player until the pointer leaves (no autoplay otherwise).
  startHoverPreview(song: SongSummary): void
  stopHoverPreview(resumeMain?: boolean): void
  isPreviewing(songId: string): boolean
}

const HOVER_DELAY_MS = 350
const FADE_MS = 250

// Ramps volume from its current value to `to`, then calls `done`.
function fade(el: HTMLAudioElement, to: number, done?: () => void): void {
  const from = el.volume
  const start = performance.now()
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / FADE_MS)
    el.volume = from + (to - from) * t
    if (t < 1) requestAnimationFrame(step)
    else done?.()
  }
  requestAnimationFrame(step)
}

const PlayerContext = createContext<PlayerState | null>(null)

export function usePlayer(): PlayerState {
  const player = useContext(PlayerContext)
  if (!player) throw new Error('usePlayer needs a PlayerProvider')
  return player
}

// One <audio> element for the whole app: starting a preview stops the current one (SPEC 7a).
export function PlayerProvider({ children }: { children: ReactNode }): JSX.Element {
  const audio = useRef<HTMLAudioElement>(null)
  const [track, setTrack] = useState<Track | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const previewAudio = useRef<HTMLAudioElement>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const pausedMainForPreview = useRef(false)

  useEffect(() => {
    if (!track || !audio.current) return
    setError(null)
    audio.current.src = track.url
    audio.current.play().catch(() => setError("Couldn't play this bounce"))
  }, [track])

  const player: PlayerState = {
    track,
    playing,
    position,
    duration,
    error,
    toggle(song) {
      const url = song.preview?.url
      if (!url || !audio.current) return
      if (track?.url === url) {
        if (audio.current.paused) void audio.current.play()
        else audio.current.pause()
        return
      }
      setPosition(0)
      setDuration(0)
      setTrack({ songId: song.id, title: song.title, bounceName: song.preview!.name, url })
    },
    pause() {
      audio.current?.pause()
    },
    resume() {
      void audio.current?.play()
    },
    seek(seconds) {
      if (audio.current) audio.current.currentTime = seconds
    },
    isPlaying(songId) {
      return playing && track?.songId === songId
    },
    startHoverPreview(song) {
      const url = song.preview?.url
      if (!url || (playing && track?.songId === song.id)) return
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = null
        const el = previewAudio.current
        if (!el || !audio.current) return
        pausedMainForPreview.current = !audio.current.paused
        audio.current.pause()
        el.volume = 0
        el.src = url
        el.onloadedmetadata = () => {
          if (Number.isFinite(el.duration)) el.currentTime = el.duration / 2
          el.play()
            .then(() => fade(el, 1))
            .catch(() => setPreviewId(null))
        }
        setPreviewId(song.id)
      }, HOVER_DELAY_MS)
    },
    stopHoverPreview(resumeMain = true) {
      if (hoverTimer.current !== null) {
        window.clearTimeout(hoverTimer.current)
        hoverTimer.current = null
      }
      const el = previewAudio.current
      if (!el || previewId === null) return
      setPreviewId(null)
      el.onloadedmetadata = null
      fade(el, 0, () => {
        el.pause()
        el.removeAttribute('src')
        el.load()
      })
      if (resumeMain && pausedMainForPreview.current) void audio.current?.play()
      pausedMainForPreview.current = false
    },
    isPreviewing(songId) {
      return previewId === songId
    }
  }

  return (
    <PlayerContext.Provider value={player}>
      {children}
      <audio
        ref={audio}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => {
          setPlaying(false)
          setError("Couldn't play this bounce. The file may have moved; try Rescan.")
        }}
      />
      <audio ref={previewAudio} preload="metadata" onError={() => setPreviewId(null)} />
    </PlayerContext.Provider>
  )
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function PlayButton({ song, className }: { song: SongSummary; className?: string }): JSX.Element | null {
  const player = usePlayer()
  if (!song.preview) return null
  if (!song.preview.url) {
    return (
      <span className="muted can-not-preview" title={`${song.preview.name} is only exported as AIFF`}>
        Can't preview AIFF
      </span>
    )
  }
  const playing = player.isPlaying(song.id)
  return (
    <button
      className={`play-button ${playing ? 'is-playing' : ''} ${className ?? ''}`}
      aria-label={playing ? `Pause ${song.title}` : `Play ${song.title}`}
      title={`${playing ? 'Pause' : 'Play'} “${song.preview.name}”`}
      onMouseEnter={() => player.startHoverPreview(song)}
      onMouseLeave={() => player.stopHoverPreview()}
      onClick={(e) => {
        e.stopPropagation()
        // A click plays the bounce from the beginning in the main player.
        player.stopHoverPreview(false)
        player.toggle(song)
      }}
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  )
}

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor" />
    </svg>
  )
}

// Bottom-of-window player: song, bounce, seek bar, elapsed / total (SPEC 7a).
export function PlayerBar(): JSX.Element | null {
  const player = usePlayer()
  const { track } = player
  if (!track) return null
  return (
    <div className="player-bar" role="region" aria-label="Player">
      <button
        className="play-button"
        aria-label={player.playing ? 'Pause' : 'Play'}
        onClick={() => (player.playing ? player.pause() : player.resume())}
      >
        {player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="player-track">
        <span className="player-title">{track.title}</span>
        <span className="muted">{player.error ?? track.bounceName}</span>
      </div>
      <span className="player-time">{formatTime(player.position)}</span>
      <input
        type="range"
        className="player-seek"
        aria-label="Seek"
        min={0}
        max={player.duration || 0}
        step={0.1}
        value={Math.min(player.position, player.duration || 0)}
        onChange={(e) => player.seek(Number(e.target.value))}
      />
      <span className="player-time">{formatTime(player.duration)}</span>
    </div>
  )
}
