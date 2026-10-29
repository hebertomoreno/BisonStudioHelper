import { useState, type ReactNode } from 'react'

interface Props<T extends { id: string }> {
  items: T[]
  // Omit to show the list without drag handles or move buttons.
  onReorder?: (ids: string[]) => void
  renderItem: (item: T, controls: ReactNode) => ReactNode
  className?: string
}

function moveTo(ids: string[], id: string, index: number): string[] {
  const without = ids.filter((x) => x !== id)
  without.splice(index, 0, id)
  return without
}

// A list that can be reordered by dragging, or with the up/down buttons from the keyboard.
export function ReorderList<T extends { id: string }>({ items, onReorder, renderItem, className }: Props<T>): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const ids = items.map((i) => i.id)

  return (
    <ol className={className ?? 'reorder-list'}>
      {items.map((item, index) => {
        const controls = onReorder ? (
          <span className="reorder-controls">
            <button
              className="icon-button"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onReorder(moveTo(ids, item.id, index - 1))}
            >
              ↑
            </button>
            <button
              className="icon-button"
              aria-label="Move down"
              disabled={index === items.length - 1}
              onClick={() => onReorder(moveTo(ids, item.id, index + 1))}
            >
              ↓
            </button>
          </span>
        ) : null

        return (
          <li
            key={item.id}
            className={[
              dragId === item.id ? 'dragging' : '',
              overIndex === index && dragId !== item.id ? 'drop-target' : ''
            ].join(' ')}
            draggable={Boolean(onReorder)}
            onDragStart={(e) => {
              setDragId(item.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              setOverIndex(index)
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverIndex(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && onReorder && dragId !== item.id) onReorder(moveTo(ids, dragId, index))
              setDragId(null)
              setOverIndex(null)
            }}
          >
            {renderItem(item, controls)}
          </li>
        )
      })}
    </ol>
  )
}
