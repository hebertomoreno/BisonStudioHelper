import { useState } from 'react'
import type { PathStatus } from '../../../shared/ipc'

const STATUS_LABEL: Record<PathStatus, string> = {
  ok: 'Found',
  missing: 'Not found',
  'not-a-folder': 'Not a folder'
}

export function StatusChip({ status }: { status: PathStatus | undefined }): JSX.Element | null {
  if (!status) return null
  return <span className={`chip chip-${status}`}>{STATUS_LABEL[status]}</span>
}

interface PathListProps {
  paths: string[]
  status: Record<string, PathStatus>
  onChange: (paths: string[]) => void
  pickTitle: string
  emptyText: string
}

export function PathList({ paths, status, onChange, pickTitle, emptyText }: PathListProps): JSX.Element {
  async function add(): Promise<void> {
    const picked = await window.finisher.pickFolder({ title: pickTitle })
    if (picked && !paths.includes(picked)) onChange([...paths, picked])
  }

  return (
    <div className="path-list">
      {paths.length === 0 && <p className="muted">{emptyText}</p>}
      {paths.map((p) => (
        <div className="path-row" key={p}>
          <code className="path" title={p}>
            {p}
          </code>
          <StatusChip status={status[p]} />
          <button className="link-button" onClick={() => onChange(paths.filter((x) => x !== p))}>
            Remove
          </button>
        </div>
      ))}
      <button onClick={add}>Add folder…</button>
    </div>
  )
}

interface NameListProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
  label: string
}

export function NameList({ values, onChange, placeholder, label }: NameListProps): JSX.Element {
  const [text, setText] = useState('')

  function add(): void {
    const value = text.trim()
    if (value && !values.includes(value)) onChange([...values, value])
    setText('')
  }

  return (
    <div className="name-list">
      <div className="chips">
        {values.map((v) => (
          <span className="chip chip-removable" key={v}>
            {v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="inline-form">
        <input
          aria-label={label}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button onClick={add} disabled={!text.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}
