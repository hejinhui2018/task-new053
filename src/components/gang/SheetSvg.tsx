import { useRef, useState } from 'react'
import type {
  Cut,
  MasterSheet,
  Order,
  PressLayout,
  UnitRect,
} from '../../lib/gangrun'

interface Props {
  layout: PressLayout
  master: MasterSheet
  orders: Order[]
  /** 手势结束：lock=null 表示解锁该单元；否则锁定到给定位置（仅正面可交互） */
  onInteract: (unitId: string, lock: { xMm: number; yMm: number; rotation: 0 | 90 | 180 | 270 } | null) => void
}

let patternSeq = 0

/** 单个母版面（正面或背面）的 SVG */
function Face({
  master,
  rects,
  cuts,
  side,
  orders,
  onInteract,
}: {
  master: MasterSheet
  rects: UnitRect[]
  cuts: Cut[]
  side: 'front' | 'back'
  orders: Order[]
  onInteract: Props['onInteract']
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const patternId = useRef(`gg${(patternSeq += 1)}`)
  const interactive = side === 'front'
  // 拖拽手势状态（ref 保证 pointerup 读到最终位置，不依赖渲染闭包）
  const drag = useRef<{
    id: string
    moved: boolean
    offsetX: number
    offsetY: number
    x: number
    y: number
    w: number
    h: number
    rotation: 0 | 90 | 180 | 270
  } | null>(null)
  const [draft, setDraft] = useState<Record<string, { x: number; y: number }>>({})

  const orderOf = (id: string) => orders.find((o) => o.id === id.split('#')[0])
  const sigOf = (id: string) => Number(id.split('#s')[1] ?? 0)

  const toMm = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: pt.x, y: pt.y }
  }

  const handleDown = (e: React.PointerEvent, r: UnitRect) => {
    if (!interactive) return
    e.preventDefault()
    const p = toMm(e.clientX, e.clientY)
    drag.current = {
      id: r.unitId,
      moved: false,
      offsetX: p.x - r.xMm,
      offsetY: p.y - r.yMm,
      x: r.xMm,
      y: r.yMm,
      w: r.widthMm,
      h: r.heightMm,
      rotation: r.rotation,
    }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const handleMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toMm(e.clientX, e.clientY)
    d.moved = true
    d.x = Math.round(Math.max(0, Math.min(master.widthMm - d.w, p.x - d.offsetX)))
    d.y = Math.round(Math.max(0, Math.min(master.heightMm - d.h, p.y - d.offsetY)))
    setDraft((prev) => ({ ...prev, [d.id]: { x: d.x, y: d.y } }))
  }
  const finishDrag = (r?: UnitRect) => {
    const d = drag.current
    drag.current = null
    if (!d || !r) return
    setDraft((prev) => {
      if (!(d.id in prev)) return prev
      const next = { ...prev }
      delete next[d.id]
      return next
    })
    if (d.moved) {
      onInteract(d.id, { xMm: d.x, yMm: d.y, rotation: d.rotation })
    } else {
      // 轻点 = 锁定/解锁切换
      onInteract(d.id, r.locked ? null : { xMm: r.xMm, yMm: r.yMm, rotation: r.rotation })
    }
  }

  const gripper = gripperGeom(master)
  // 背面视角下咬口/禁印区/裁切线镜像
  const mirror = (x: number, y: number) =>
    side === 'back' && master.pressMode === 'perfector'
      ? master.flip === 'long-edge'
        ? { x: master.widthMm - x, y }
        : { x, y: master.heightMm - y }
      : { x, y }

  return (
    <div className="gang-face">
      <div className="gang-face-title">
        {side === 'front' ? '正面（印版 A）' : '背面（印版 B · 镜像套准）'}
      </div>
      <svg
        ref={svgRef}
        className="gang-svg"
        viewBox={`0 0 ${master.widthMm} ${master.heightMm}`}
        onPointerMove={handleMove}
      >
        <defs>
          <pattern id={`${patternId.current}-v`} width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M3 0 V6" stroke="#00000022" strokeWidth="0.7" />
          </pattern>
          <pattern id={`${patternId.current}-h`} width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 3 H6" stroke="#00000022" strokeWidth="0.7" />
          </pattern>
        </defs>

        {/* 母版纸 */}
        <rect x="0" y="0" width={master.widthMm} height={master.heightMm} fill="#fbfcfe" stroke="#3a4252" strokeWidth="1.4" />

        {/* 咬口 */}
        {(() => {
          const g = side === 'back' && master.pressMode === 'perfector'
            ? mirrorGripper(master)
            : gripper
          return (
            <g>
              <rect x={g.x} y={g.y} width={g.w} height={g.h} fill="#d23b3b22" stroke="#d23b3b" strokeDasharray="5 3" strokeWidth="0.8" />
              <text x={g.x + g.w / 2} y={g.y + g.h / 2 + 3} textAnchor="middle" className="gang-note" fill="#d23b3b">咬口 {master.gripperMm}mm</text>
            </g>
          )
        })()}

        {/* 禁印区（随翻面镜像） */}
        {master.deadZones.map((dz) => {
          const p = mirror(dz.xMm, dz.yMm)
          return (
            <g key={dz.id}>
              <rect x={p.x} y={p.y} width={dz.widthMm} height={dz.heightMm} fill="#5b647222" stroke="#5b6472" strokeDasharray="4 3" strokeWidth="0.8" />
              <text x={p.x + dz.widthMm / 2} y={p.y + dz.heightMm / 2 + 3} textAnchor="middle" className="gang-note">禁印</text>
            </g>
          )
        })}

        {/* 裁切线（贯穿刀路，序号即下刀顺序） */}
        {cuts.map((c, i) => {
          const pos = side === 'back' && master.pressMode === 'perfector'
            ? c.orientation === 'v'
              ? master.widthMm - c.posMm
              : master.heightMm - c.posMm
            : c.posMm
          return (
            <g key={i} className="gang-cut">
              {c.orientation === 'v' ? (
                <line x1={pos} y1="0" x2={pos} y2={master.heightMm} stroke="#b97a12" strokeWidth="0.9" strokeDasharray="7 4" />
              ) : (
                <line x1="0" y1={pos} x2={master.widthMm} y2={pos} stroke="#b97a12" strokeWidth="0.9" strokeDasharray="7 4" />
              )}
              <circle cx={c.orientation === 'v' ? pos : 8} cy={c.orientation === 'h' ? pos : 8 + i * 11} r="5" fill="#b97a12" />
              <text x={c.orientation === 'v' ? pos : 8} y={c.orientation === 'h' ? pos + 2.5 : 11.5 + i * 11} textAnchor="middle" className="gang-cut-num">{i + 1}</text>
            </g>
          )
        })}

        {/* 生产单元 */}
        {rects.map((r) => {
          const o = orderOf(r.unitId)
          if (!o) return null
          const dx = draft[r.unitId]?.x ?? r.xMm
          const dy = draft[r.unitId]?.y ?? r.yMm
          // 纹线始终按订单原始纸纹绘制；g 的 rotate 变换会让图案随之旋转，
          // 因此 90°/270° 摆放时纹线自然转向，无需在此补偿。
          const grainPattern = o.grain === 'parallel' ? `${patternId.current}-v` : `${patternId.current}-h`
          return (
            <g
              key={r.unitId}
              transform={`translate(${dx} ${dy}) rotate(${r.rotation} ${r.widthMm / 2} ${r.heightMm / 2})`}
              className={`gang-unit ${interactive ? '' : 'no-drag'}`}
              onPointerDown={(e) => handleDown(e, r)}
              onPointerUp={() => finishDrag(r)}
            >
              <rect width={r.widthMm} height={r.heightMm} fill={o.color} opacity="0.2" stroke={o.color} strokeWidth={r.locked ? 2.6 : 1.4} rx="1.5" />
              <rect width={r.widthMm} height={r.heightMm} fill={`url(#${grainPattern})`} />
              <rect width={r.widthMm} height={r.heightMm} fill="none" stroke={o.color} strokeWidth={r.locked ? 2.6 : 1.4} rx="1.5" />
              <text x={r.widthMm / 2} y={r.heightMm / 2 - 4} textAnchor="middle" className="gang-unit-name" fill={o.color}>
                {o.name}
              </text>
              <text x={r.widthMm / 2} y={r.heightMm / 2 + 9} textAnchor="middle" className="gang-unit-sub">
                第 {sigOf(r.unitId) + 1} 帖 · {r.widthMm}×{r.heightMm}
              </text>
              {r.rotation !== 0 && (
                <text x={r.widthMm - 8} y={12} textAnchor="end" className="gang-note" fill="#b97a12">{r.rotation}°</text>
              )}
              {r.locked && (
                <text x="6" y="13" className="gang-lock">🔒</text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="gang-face-hint">
        {side === 'front' ? '点击色块锁定/解锁，锁定后可拖动；其余单元自动重新排布' : '背面位置由翻面镜像自动生成，不可单独移动'}
      </div>
    </div>
  )
}

function gripperGeom(master: MasterSheet) {
  const g = master.gripperMm
  switch (master.gripperEdge) {
    case 'top': return { x: 0, y: 0, w: master.widthMm, h: g }
    case 'bottom': return { x: 0, y: master.heightMm - g, w: master.widthMm, h: g }
    case 'left': return { x: 0, y: 0, w: g, h: master.heightMm }
    case 'right': return { x: master.widthMm - g, y: 0, w: g, h: master.heightMm }
  }
}

/** 背面视角下咬口几何（长边翻面左右镜像，短边翻面上下镜像） */
function mirrorGripper(master: MasterSheet) {
  const g = gripperGeom(master)
  if (master.flip === 'long-edge') {
    if (master.gripperEdge === 'left') return { x: master.widthMm - master.gripperMm, y: 0, w: master.gripperMm, h: master.heightMm }
    if (master.gripperEdge === 'right') return { x: 0, y: 0, w: master.gripperMm, h: master.heightMm }
  } else {
    if (master.gripperEdge === 'top') return { x: 0, y: master.heightMm - master.gripperMm, w: master.widthMm, h: master.gripperMm }
    if (master.gripperEdge === 'bottom') return { x: 0, y: 0, w: master.widthMm, h: master.gripperMm }
  }
  return g
}

export default function SheetSvg({ layout, master, orders, onInteract }: Props) {
  return (
    <div className="gang-sheet-wrap">
      <Face master={master} rects={layout.placed.front} cuts={layout.cuts} side="front" orders={orders} onInteract={onInteract} />
      <Face master={master} rects={layout.placed.back} cuts={layout.cuts} side="back" orders={orders} onInteract={onInteract} />
    </div>
  )
}
