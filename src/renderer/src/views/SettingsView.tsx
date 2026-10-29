import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PathStatus } from '../../../shared/ipc'
import type { Root, Settings } from '../../../shared/schema'
import { NameList, PathList, StatusChip } from '../components/ListEditors'

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {hint && <p className="muted hint">{hint}</p>}
      {children}
    </section>
  )
}

function NumberField(props: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={Number.isFinite(props.value) ? props.value : ''}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
      />
    </label>
  )
}

interface RootCardProps {
  root: Root
  status: PathStatus | undefined
  onChange: (root: Root) => void
  onRemove: () => void
}

function RootCard({ root, status, onChange, onRemove }: RootCardProps): JSX.Element {
  async function choosePath(): Promise<void> {
    const picked = await window.finisher.pickFolder({ title: 'Choose song folder', defaultPath: root.path })
    if (picked) onChange({ ...root, path: picked })
  }
  const linked = Object.keys(root.folders)

  return (
    <div className="card">
      <div className="card-header">
        <label className="field grow">
          <span>Label</span>
          <input value={root.label} onChange={(e) => onChange({ ...root, label: e.target.value })} />
        </label>
        <button className="link-button danger" onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="path-row">
        <code className="path" title={root.path}>
          {root.path}
        </code>
        <StatusChip status={status === 'missing' ? undefined : status} />
        {status === 'missing' && <span className="chip chip-missing">Not connected</span>}
        <button onClick={choosePath}>Change…</button>
      </div>
      <div className="field-row">
        <NumberField
          label="Max depth"
          value={root.maxDepth}
          min={1}
          max={12}
          onChange={(maxDepth) => onChange({ ...root, maxDepth })}
        />
        <label className="field grow">
          <span>Folders path (optional)</span>
          <input
            value={root.foldersPath ?? ''}
            placeholder="e.g. Projects"
            onChange={(e) => onChange({ ...root, foldersPath: e.target.value.trim() || undefined })}
          />
        </label>
      </div>
      <div className="field">
        <span>Skip these folders</span>
        <NameList
          label="Folder name to skip"
          values={root.exclude}
          placeholder="Folder name"
          onChange={(exclude) => onChange({ ...root, exclude })}
        />
      </div>
      {linked.length > 0 && (
        <p className="muted hint">
          Folders linked to releases: {linked.join(', ')}. Edit links in Releases (coming in step 6a).
        </p>
      )}
    </div>
  )
}

export function SettingsView(): JSX.Element {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pathStatus, setPathStatus] = useState<Record<string, PathStatus>>({})

  useEffect(() => {
    window.finisher.getSettings().then((result) => {
      setSaved(result.settings)
      setDraft(result.settings)
      setWarnings(result.warnings)
    })
  }, [])

  const watchedPaths = useMemo(
    () =>
      draft ? [...draft.roots.map((r) => r.path), ...draft.inboxPaths, ...draft.allowedExternalRoots] : [],
    [draft]
  )
  const watchedKey = watchedPaths.join('\n')

  useEffect(() => {
    if (watchedPaths.length === 0) return
    window.finisher.getPathStatus(watchedPaths).then(setPathStatus)
    // Keyed on the joined list so typing in unrelated fields doesn't re-check every path.
  }, [watchedKey])

  if (!draft || !saved) {
    return (
      <section className="view">
        <p className="muted">Loading settings…</p>
      </section>
    )
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  function update<K extends keyof Settings>(key: K, value: Settings[K]): void {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setMessage(null)
  }

  function updateRoot(index: number, root: Root): void {
    update(
      'roots',
      draft!.roots.map((r, i) => (i === index ? root : r))
    )
  }

  async function addRoot(): Promise<void> {
    const picked = await window.finisher.pickFolder({ title: 'Add song folder' })
    if (!picked || draft!.roots.some((r) => r.path === picked)) return
    update('roots', [...draft!.roots, { path: picked, label: basename(picked), maxDepth: 6, exclude: [], folders: {} }])
  }

  async function save(): Promise<void> {
    setSaving(true)
    setErrors([])
    const result = await window.finisher.updateSettings(draft!)
    setSaving(false)
    if (result.ok) {
      setSaved(result.settings)
      setDraft(result.settings)
      setMessage('Saved')
    } else {
      setErrors(result.errors)
    }
  }

  return (
    <section className="view">
      <header className="view-header sticky">
        <h1>Settings</h1>
        <div className="actions">
          {message && !dirty && <span className="muted">{message}</span>}
          <button
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(saved)
              setErrors([])
            }}
          >
            Revert
          </button>
          <button className="primary" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {warnings.length > 0 && (
        <div className="notice warning" role="status">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div className="notice error" role="alert">
          <p>Not saved:</p>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Section
        title="Song folders"
        hint="Folders scanned for Ableton projects. A folder on a drive that isn't connected is kept and shown as Not connected."
      >
        {draft.roots.map((root, i) => (
          <RootCard
            key={i}
            root={root}
            status={pathStatus[root.path]}
            onChange={(r) => updateRoot(i, r)}
            onRemove={() => update(
              'roots',
              draft.roots.filter((_, j) => j !== i)
            )}
          />
        ))}
        <button onClick={addRoot}>Add song folder…</button>
      </Section>

      <Section title="Bounce inbox" hint="Catch-all bounce folders. Their files get matched to songs.">
        <PathList
          paths={draft.inboxPaths}
          status={pathStatus}
          onChange={(inboxPaths) => update('inboxPaths', inboxPaths)}
          pickTitle="Add inbox folder"
          emptyText="No inbox folders. The inbox is off."
        />
        <div className="field-row">
          <NumberField
            label="Match threshold (0–100)"
            value={draft.inbox.matchThreshold}
            min={0}
            max={100}
            onChange={(matchThreshold) => update('inbox', { ...draft.inbox, matchThreshold })}
          />
        </div>
      </Section>

      <Section
        title="Bounce folder names"
        hint="Folders inside a project that hold exports. Matching ignores case and spaces."
      >
        <NameList
          label="Bounce folder name"
          values={draft.bounceFolderNames}
          placeholder="e.g. Renders"
          onChange={(bounceFolderNames) => update('bounceFolderNames', bounceFolderNames)}
        />
      </Section>

      <Section title="Focus">
        <div className="field-row">
          <NumberField
            label="Songs allowed in Focus"
            value={draft.focusCap}
            min={1}
            max={10}
            onChange={(focusCap) => update('focusCap', focusCap)}
          />
        </div>
      </Section>

      <Section title="Last worked colors" hint="Neutral below amber, amber up to red, red after that.">
        <div className="field-row">
          <NumberField
            label="Amber after (days)"
            value={draft.staleness.amberDays}
            min={1}
            onChange={(amberDays) => update('staleness', { ...draft.staleness, amberDays })}
          />
          <NumberField
            label="Red after (days)"
            value={draft.staleness.redDays}
            min={1}
            onChange={(redDays) => update('staleness', { ...draft.staleness, redDays })}
          />
        </div>
      </Section>

      <Section title="Ableton Live">
        <label className="field">
          <span>Live app name</span>
          <input
            value={draft.abletonAppName}
            onChange={(e) => update('abletonAppName', e.target.value)}
          />
        </label>
        <div className="field">
          <span>Allowed external sample folders</span>
          <p className="muted hint">Samples in these folders don't count against Collect All and Save.</p>
          <PathList
            paths={draft.allowedExternalRoots}
            status={pathStatus}
            onChange={(allowedExternalRoots) => update('allowedExternalRoots', allowedExternalRoots)}
            pickTitle="Add allowed sample folder"
            emptyText="None."
          />
        </div>
      </Section>

      <Section title="Excitement scale">
        <div className="excitement-grid">
          {draft.excitementScale.map((level, i) => (
            <div className="excitement-row" key={level.value}>
              <span className="excitement-value">{level.value}</span>
              <input
                className="emoji-input"
                aria-label={`Emoji for ${level.value}`}
                value={level.emoji}
                onChange={(e) =>
                  update(
                    'excitementScale',
                    draft.excitementScale.map((l, j) => (j === i ? { ...l, emoji: e.target.value } : l))
                  )
                }
              />
              <input
                aria-label={`Label for ${level.value}`}
                value={level.label}
                onChange={(e) =>
                  update(
                    'excitementScale',
                    draft.excitementScale.map((l, j) => (j === i ? { ...l, label: e.target.value } : l))
                  )
                }
              />
            </div>
          ))}
        </div>
      </Section>
    </section>
  )
}
