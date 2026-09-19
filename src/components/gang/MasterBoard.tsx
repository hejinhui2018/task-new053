import { useRef, useState } from 'react'
import type {
  BackMode,
  BoardPlan,
  ForbiddenZone,
  GripZone,
  LockedCell,
  MasterSheet,
  PlacedCell,
  Rect,
} from '../../lib/gang/types'
import { gripRect, gripRectBack, mirrorToBack } from '../../lib/gang/geometry'

interface Props {
  master: MasterSheet
  mode: BackMode
  grip: GripZone
  forbidden: ForbiddenZone[]
  board: BoardPlan
  onLockChange: (locks: LockedCell[], transient?: boolean) => void
  /** 拖拽手势开始时调用一次（撤销历史只记一个快照） */
  onDragBegin: () => void
  /** 拖拽结束：回报被拖单元，便于父组件切换到它最终所在套版 */
  onDragEnd: (cell: PlacedCell) => void
  locks: LockedCell[]
}

type DragState = {
  cell: PlacedCell
  startClientX: number
  startClientY: number
  origX: number
  origY: number
  svg: SVGSVGElement
  began: boolean
}

export default function MasterBoard({
  master,
  mode,
  grip,
  forbidden,
  board,
  onLockChange,
  onDragBegin,
  onDragEnd,
  locks,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hover, setHover] = useState<{ side: 'front' | 'back'; cell: PlacedCell } | null>(null)

  const W = master.widthMm
  const H = master.heightMm

  const toggleLock = (cell: PlacedCell) => {
    const existing = locks.find(
      (l) => l.boardIndex === board.boardIndex && l.orderId === cell.orderId && l.signature === cell.signature,
    )
    if (existing) {
      onLockChange(locks.filter((l) => l !== existing))
    } else {
      onLockChange([
        ...locks,
        {
          boardIndex: board.boardIndex,
          orderId: cell.orderId,
          signature: cell.signature,
          x: Math.round(cell.x),
          y: Math.round(cell.y),
          rotated: cell.rotated,
        },
      ])
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const ctm = drag.svg.getScreenCTM()
    if (!ctm) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    const dx = p.x - drag.startClientX
    const dy = p.y - drag.startClientY
    if (!drag.began) {
      onDragBegin()
      setDrag({ ...drag, began: true })
    }
    const nx = clamp(Math.round(drag.origX + dx), 0, W - drag.cell.w)
    const ny = clamp(Math.round(drag.origY + dy), 0, H - drag.cell.h)
    const lock: LockedCell = {
      boardIndex: board.boardIndex,
      orderId: drag.cell.orderId,
      signature: drag.cell.signature,
      x: nx,
      y: ny,
      rotated: drag.cell.rotated,
    }
    const rest = locks.filter(
      (l) =>
        !(l.boardIndex === board.boardIndex &&
          l.orderId === lock.orderId &&
          l.signature === lock.signature),
    )
    onLockChange([...rest, lock], true)
  }

  const endDrag = () => {
    const cell = drag?.cell
    setDrag(null)
    if (cell) onDragEnd(cell)
  }

  const startDrag = (e: React.PointerEvent, cell: PlacedCell) => {
    if (!svgRef.current) return
    const ctm = svgRef.current.getScreenCTM()
    if (!ctm) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({
      cell,
      startClientX: p.x,
      startClientY: p.y,
      origX: cell.x,
      origY: cell.y,
      svg: svgRef.current,
      began: false,
    })
  }

  const renderFace = (side: 'front' | 'back') => {
    const gripR = side === 'front' ? gripRect(master, grip) : gripRectBack(master, grip, mode)
    const fzRects = forbidden.map((f) => ({
      id: f.id,
      name: f.name,
      rect: side === 'front' || !f.mirrorToBack ? f.rect : mirrorToBack(f.rect, master, mode),
    }))

    return (
      <div className="board-face-wrap">
        <div className="board-face-label">
          {side === 'front' ? '正面（直视印刷面）' : '背面（翻面镜像后）'}
        </div>
        <svg
          ref={side === 'front' ? svgRef : undefined}
          className="board-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <defs>
            <pattern id={`msHatch-${side}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" fill="rgba(185,122,18,.10)" />
              <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(185,122,18,.55)" strokeWidth="2" />
            </pattern>
          </defs>
          {/* 母版底纸 */}
          <rect x={0} y={0} width={W} height={H} className="ms-paper" />

          {/* 纸纹（母版纤维方向）：顺纹沿长边画水平线，横纹画竖直线 */}
          <GrainPattern width={W} height={H} horizontal={master.grain === 'long'} />

          {/* 咬口 */}
          <ShadedRect r={gripR} className="ms-grip" label={`咬口 ${grip.widthMm}mm`} />

          {/* 禁印区 */}
          {fzRects.map((f) => (
            <ShadedRect key={f.id} r={f.rect} className="ms-forbidden" label={f.name} hatch fillUrl={`url(#msHatch-${side})`} />
          ))}

          {/* 裁切线（guillotine 刀序） */}
          {board.cuts.map((c, i) => (
            <g key={i} className="ms-cut">
              {c.orient === 'v' ? (
                <line x1={c.at} y1={c.from} x2={c.at} y2={c.to} />
              ) : (
                <line x1={c.from} y1={c.at} x2={c.to} y2={c.at} />
              )}
            </g>
          ))}

          {/* 单元 */}
          {board.cells.map((cell) => {
            const r: Rect = side === 'front'
              ? { x: cell.x, y: cell.y, w: cell.w, h: cell.h }
              : mirrorToBack({ x: cell.x, y: cell.y, w: cell.w, h: cell.h }, master, mode)
            const active = hover?.side === side && hover?.cell.unitId === cell.unitId
            return (
              <g
                key={`${cell.unitId}-${side}`}
                className={`ms-cell ${cell.locked ? 'locked' : ''} ${active ? 'hover' : ''}`}
                transform={
                  // 背面内容随翻面旋转：上下翻/正反版视觉上用文字朝向体现
                  side === 'back' && mode === 'work-and-tumble'
                    ? `rotate(180 ${r.x + r.w / 2} ${r.y + r.h / 2})`
                    : undefined
                }
                onPointerDown={(e) => side === 'front' && startDrag(e, cell)}
                onMouseEnter={() => setHover({ side, cell })}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill={cell.color}
                  fillOpacity={0.18}
                  stroke={cell.color}
                  strokeWidth={cell.locked ? 3 : 1.5}
                />
                {/* 装订折线（书帖中缝） */}
                <line
                  x1={cell.rotated ? r.x : r.x + r.w / 2}
                  y1={cell.rotated ? r.y + r.h / 2 : r.y}
                  x2={cell.rotated ? r.x + r.w : r.x + r.w / 2}
                  y2={cell.rotated ? r.y + r.h / 2 : r.y + r.h}
                  className="ms-fold"
                />
                {/* 文字随内容朝向：因纸纹旋转 90° 的书帖，版面文字也侧转 */}
                <g transform={cell.rotated ? `rotate(90 ${r.x + r.w / 2} ${r.y + r.h / 2})` : undefined}>
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2 - 6}
                    textAnchor="middle"
                    className="ms-cell-title"
                  >
                    {cell.orderName.length > 8 ? cell.orderName.slice(0, 8) + '…' : cell.orderName}
                  </text>
                  <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 14} textAnchor="middle" className="ms-cell-sub">
                    第 {cell.signature + 1} 帖{cell.rotated ? ' · 90°' : ''}
                  </text>
                </g>
                {cell.locked && (
                  <text x={r.x + 8} y={r.y + 20} className="ms-lock-icon">🔒</text>
                )}
                {side === 'front' && (
                  <g
                    className="ms-lock-btn"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleLock(cell)
                    }}
                  >
                    <circle cx={r.x + r.w - 13} cy={r.y + 13} r={10} />
                    <text x={r.x + r.w - 13} y={r.y + 17} textAnchor="middle" className="ms-lock-glyph">
                      {cell.locked ? '🔒' : '🔓'}
                    </text>
                    <title>{cell.locked ? '解锁，交回自动排版' : '锁定当前位置'}</title>
                  </g>
                )}
              </g>
            )
          })}

          {/* 母版边框 */}
          <rect x={0} y={0} width={W} height={H} className="ms-border" />
        </svg>

        {/* 悬浮信息 + 锁定按钮（仅正面可操作） */}
        {hover && hover.side === side && (
          <div className="ms-tooltip">
            <span className="order-dot" style={{ background: hover.cell.color }} />
            {hover.cell.orderName} · 第 {hover.cell.signature + 1} 帖 ·
            {' '}{Math.round(hover.cell.w)}×{Math.round(hover.cell.h)}mm
            {hover.cell.rotated ? ' · 旋转90°' : ''}
            {side === 'front' && <span className="muted">· 拖动物块可锁定位置</span>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="board-stack">
      {renderFace('front')}
      {renderFace('back')}
      <div className="board-legend">
        <span><i className="lg-grip-swatch" />咬口</span>
        <span><i className="lg-fz-swatch" />禁印区</span>
        <span><i className="lg-cut-swatch" />直线刀路（{board.cuts.length} 刀）</span>
        <span><i className="lg-fold-swatch" />书帖折线/纸纹</span>
        <span>母版纸纹：{master.grain === 'long' ? '顺纹（平行长边）' : '横纹'}</span>
      </div>
    </div>
  )
}

function ShadedRect({
  r,
  className,
  label,
  hatch,
  fillUrl,
}: {
  r: Rect
  className: string
  label?: string
  hatch?: boolean
  fillUrl?: string
}) {
  return (
    <g>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        className={className}
        fill={hatch ? fillUrl : undefined}
      />
      {label && r.w > 40 && r.h > 10 && (
        <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 3} textAnchor="middle" className="ms-zone-label">
          {label}
        </text>
      )}
    </g>
  )
}

function GrainPattern({ width, height, horizontal }: { width: number; height: number; horizontal: boolean }) {
  const lines = []
  if (horizontal) {
    for (let y = 14; y < height; y += 18) {
      lines.push(<line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} className="ms-grain" />)
    }
  } else {
    for (let x = 14; x < width; x += 18) {
      lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} className="ms-grain" />)
    }
  }
  return <g className="ms-grain-layer">{lines}</g>
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
