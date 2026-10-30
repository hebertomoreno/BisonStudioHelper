import { useState } from 'react'
import { STATUSES, type Status } from '../../../shared/sidecar'
import type { LibrarySnapshot } from '../../../shared/songs'
import { EMPTY_FILTER, foldersOf, isEmptyFilter, parseFilter, type SongFilter } from '../lib/filters'

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

// Status, excitement, release, folder, location, bounce and "hide released" filters, plus named
// saved filters (SPEC 8a, 9). Shared by Main list, Board and Shelf.
export function FilterBar({
  snapshot,
  filter,
  onChange
}: {
  snapshot: LibrarySnapshot
  filter: SongFilter
  onChange: (filter: SongFilter) => void
}): JSX.Element {
  const [open, setOpen] = useState(!isEmptyFilter(filter))
  const [naming, setNaming] = useState<string | null>(null)
  const [appliedName, setAppliedName] = useState<string | null>(null)
  const set = <K extends keyof SongFilter>(key: K, value: SongFilter[K]): void => onChange({ ...filter, [key]: value })
  const folders = foldersOf(snapshot)
  const releases = [...snapshot.releases].sort(
    (a, b) => Number(a.released) - Number(b.released) || a.name.localeCompare(b.name)
  )
  const active = !isEmptyFilter(filter)

  function saveAs(name: string): void {
    const trimmed = name.trim()
    setNaming(null)
    if (!trimmed) return
    const others = snapshot.savedFilters.filter((f) => f.name !== trimmed)
    void window.finisher.setSavedFilters([...others, { name: trimmed, filter: { ...filter } }])
    setAppliedName(trimmed)
  }

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <button
          className={active ? 'filter-toggle active' : 'filter-toggle'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Filters{active ? ' •' : ''}
        </button>
        {snapshot.savedFilters.length > 0 && (
          <select
            aria-label="Saved filters"
            value=""
            onChange={(e) => {
              const saved = snapshot.savedFilters.find((f) => f.name === e.target.value)
              if (saved) {
                onChange(parseFilter(saved.filter))
                setAppliedName(saved.name)
                setOpen(true)
              }
            }}
          >
            <option value="">Saved filters…</option>
            {snapshot.savedFilters.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        {active && (
          <button
            className="link-button"
            onClick={() => {
              onChange(EMPTY_FILTER)
              setAppliedName(null)
            }}
          >
            Clear
          </button>
        )}
        {appliedName && snapshot.savedFilters.some((f) => f.name === appliedName) && (
          <button
            className="link-button danger"
            onClick={() => {
              void window.finisher.setSavedFilters(snapshot.savedFilters.filter((f) => f.name !== appliedName))
              setAppliedName(null)
            }}
          >
            Delete “{appliedName}”
          </button>
        )}
        {active &&
          (naming === null ? (
            <button className="link-button" onClick={() => setNaming('')}>
              Save filter…
            </button>
          ) : (
            <input
              className="filter-name"
              autoFocus
              aria-label="Name for this filter"
              placeholder="Name, then Enter"
              value={naming}
              maxLength={60}
              onChange={(e) => setNaming(e.target.value)}
              onBlur={() => setNaming(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveAs(naming)
                if (e.key === 'Escape') setNaming(null)
              }}
            />
          ))}
      </div>

      {open && (
        <div className="filter-panel">
          <fieldset className="chips">
            <legend>Status</legend>
            {STATUSES.map((s: Status) => (
              <label key={s} className={filter.status.includes(s) ? 'chip on' : 'chip'}>
                <input type="checkbox" checked={filter.status.includes(s)} onChange={() => set('status', toggle(filter.status, s))} />
                {s}
              </label>
            ))}
          </fieldset>

          <fieldset className="chips">
            <legend>Excitement</legend>
            {snapshot.excitementScale.map((level) => (
              <label
                key={level.value}
                title={level.label}
                className={filter.excitement.includes(level.value) ? 'chip on' : 'chip'}
              >
                <input
                  type="checkbox"
                  aria-label={level.label}
                  checked={filter.excitement.includes(level.value)}
                  onChange={() => set('excitement', toggle(filter.excitement, level.value))}
                />
                {level.emoji}
              </label>
            ))}
            <label className={filter.excitement.includes(0) ? 'chip on' : 'chip'}>
              <input
                type="checkbox"
                checked={filter.excitement.includes(0)}
                onChange={() => set('excitement', toggle(filter.excitement, 0))}
              />
              Unrated
            </label>
          </fieldset>

          <div className="filter-selects">
            <select aria-label="Release" value={filter.releaseId ?? ''} onChange={(e) => set('releaseId', e.target.value || null)}>
              <option value="">Any release</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.released ? ' (released)' : ''}
                </option>
              ))}
            </select>
            <select aria-label="Folder" value={filter.folder ?? ''} onChange={(e) => set('folder', e.target.value || null)}>
              <option value="">Any folder</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select aria-label="Location" value={filter.rootPath ?? ''} onChange={(e) => set('rootPath', e.target.value || null)}>
              <option value="">Any location</option>
              {snapshot.roots.map((r) => (
                <option key={r.path} value={r.path}>
                  {r.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Bounce"
              value={filter.bounce}
              onChange={(e) => set('bounce', e.target.value as SongFilter['bounce'])}
            >
              <option value="any">Bounced or not</option>
              <option value="has">Has a bounce</option>
              <option value="none">No bounce</option>
            </select>
            <label className="check-row">
              <input type="checkbox" checked={filter.hideReleased} onChange={(e) => set('hideReleased', e.target.checked)} />
              Hide released
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
