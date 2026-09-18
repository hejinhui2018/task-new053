import { useRef, useState } from 'react'
import type { BookPage } from '../types'
import { MIN_BLEED_MM } from '../lib/imposition'

interface Props {
  pages: BookPage[]
  badgesForId: (id: string) => Array<{ level: 'error' | 'warning' | 'info'; text: string }>
  onMove: (draggedId: string, targetIndex: number) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<BookPage>) => void
}

export default function PageList({
  pages,
  badgesForId,
  onMove,
  onAdd,
  onDelete,
  onUpdate,
}: Props) {
  const dragId = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ index: number; where: 'above' | 'below' } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const where = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
    setDropTarget({ index, where })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (dragId.current && dropTarget) {
      const insertAt = dropTarget.where === 'above' ? dropTarget.index : dropTarget.index + 1
      onMove(dragId.current, insertAt)
    }
    dragId.current = null
    setDropTarget(null)
  }

  return (
    <div className="panel">
      <h2>页面顺序（阅读顺序）</h2>
      <div className="hint">
        拖动卡片调整客户稿件顺序；不足 4 的倍数时会在<b>封底之前</b>自动补白。
      </div>

      {pages.map((p, index) => {
        const badges = badgesForId(p.id)
        const isEditing = editingId === p.id
        const dropCls =
          dropTarget?.index === index && dragId.current !== p.id
            ? dropTarget.where === 'above'
              ? 'drop-above'
              : 'drop-below'
            : ''
        return (
          <div
            key={p.id}
            className={`page-card ${dragId.current === p.id ? 'dragging' : ''} ${dropCls}`}
            draggable={!isEditing}
            onDragStart={() => {
              dragId.current = p.id
            }}
            onDragEnd={() => {
              dragId.current = null
              setDropTarget(null)
            }}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
          >
            <span className="drag-handle" title="拖动排序">⠿</span>
            <div className="page-thumb" style={{ background: p.color }}>
              {p.sourcePage}
            </div>
            <div className="page-meta">
              {isEditing ? (
                <>
                  <input
                    autoFocus
                    value={p.title}
                    onChange={(e) => onUpdate(p.id, { title: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && setEditingId(null)}
                    placeholder="栏目标题"
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input
                      type="number"
                      style={{ width: 70 }}
                      value={p.sourcePage}
                      onChange={(e) =>
                        onUpdate(p.id, { sourcePage: Number(e.target.value) })
                      }
                      title="源稿页码"
                    />
                    <input
                      type="number"
                      style={{ width: 78 }}
                      value={p.bleedMm}
                      onChange={(e) =>
                        onUpdate(p.id, { bleedMm: Number(e.target.value) })
                      }
                      title={`出血 mm（建议 ≥ ${MIN_BLEED_MM}）`}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="title" onDoubleClick={() => setEditingId(p.id)}>
                    {index + 1}. {p.title}
                  </div>
                  <div className="sub">
                    源稿 P{p.sourcePage} · 出血 {p.bleedMm}mm
                    {p.upsideDown ? ' · 倒置' : ''}
                  </div>
                  {badges.length > 0 && (
                    <div className="badges">
                      {badges.map((b, i) => (
                        <span key={i} className={`badge ${b.level}`}>{b.text}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="page-actions">
              <button
                className="icon-btn"
                title={p.upsideDown ? '取消倒置标记' : '标记来稿倒置'}
                onClick={() => onUpdate(p.id, { upsideDown: !p.upsideDown })}
              >
                {p.upsideDown ? '🙃' : '↑'}
              </button>
              <button
                className="icon-btn"
                title="编辑"
                onClick={() => setEditingId(isEditing ? null : p.id)}
              >
                {isEditing ? '✓' : '✎'}
              </button>
              <button
                className="icon-btn red"
                title="删除页面"
                onClick={() => {
                  onDelete(p.id)
                  if (isEditing) setEditingId(null)
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}

      <button className="btn primary" style={{ width: '100%', marginTop: 8 }} onClick={onAdd}>
        ＋ 增加页面
      </button>
    </div>
  )
}
