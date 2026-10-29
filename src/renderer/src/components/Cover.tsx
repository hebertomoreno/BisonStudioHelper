import { useState } from 'react'
import type { ReleaseSummary, SongSummary } from '../../../shared/songs'
import { PlayButton, usePlayer } from './Player'

// Same name, same colors: a stand-in cover until the release has art.
function placeholderStyle(seed: string): React.CSSProperties {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  const hue = Math.abs(hash) % 360
  return {
    background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${(hue + 50) % 360} 50% 22%))`
  }
}

function initials(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [name]
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

export function errorText(err: unknown): string {
  return String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// Release art as a CD case on a shelf (SPEC 7a, 8b). A song with a bounce has a disc behind the
// case; the disc slides out and spins while it plays.
export function Cover({ song, releases }: { song: SongSummary; releases: ReleaseSummary[] }): JSX.Element {
  const player = usePlayer()
  const release = song.releases[0] ?? null
  const [error, setError] = useState<string | null>(null)
  const seed = release?.name ?? song.title
  const art = release?.artUrl ?? null

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    }
  }

  // Unreleased first, so current projects are at the top of the list.
  const choices = [...releases].sort((a, b) => Number(a.released) - Number(b.released) || a.name.localeCompare(b.name))

  return (
    <div className="cover-column">
      <div
        className={`cover-stage ${player.isPlaying(song.id) ? 'is-playing' : ''} ${player.isPreviewing(song.id) ? 'is-previewing' : ''}`}
      >
        {song.preview && (
          <div className="disc-slot" aria-hidden="true">
            <div className="disc">
              <div className="disc-label" style={art ? undefined : placeholderStyle(seed)}>
                {art && <img src={art} alt="" draggable={false} />}
              </div>
            </div>
          </div>
        )}
        <div className="cover" style={art ? undefined : placeholderStyle(seed)}>
          {art ? (
            <img src={art} alt={`${release!.name} cover`} draggable={false} />
          ) : (
            <span className="cover-initials" aria-hidden="true">
              {initials(seed)}
            </span>
          )}
          <span className="cover-gloss" aria-hidden="true" />
          {release && (
            <button className="cover-edit" onClick={() => void run(() => window.finisher.pickReleaseArt(release.id))}>
              {art ? 'Change cover' : 'Add cover'}
            </button>
          )}
          <PlayButton song={song} className="cover-play" />
        </div>
      </div>
      {!release && (
        <select
          className="cover-release-picker"
          aria-label={`Add ${song.title} to a release`}
          value=""
          onChange={(e) => {
            const releaseId = e.target.value
            if (releaseId) void run(() => window.finisher.addSongToRelease(song.id, releaseId))
          }}
        >
          <option value="">Add to release…</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.released ? ' (released)' : ''}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p className="cover-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
