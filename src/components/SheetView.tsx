import type { Sheet, SheetSide } from '../types'
import { MIN_BLEED_MM } from '../lib/imposition'

interface Props {
  sheets: Sheet[]
}

/** 单个槽位：出血区 + 裁切线 + 摆放旋转后的页面 */
function Slot({ side, slot }: { side: SheetSide; slot: SheetSide['slots'][number] }) {
  const { page, rotation, pos } = slot
  const lowBleed = !page.blank && page.bleedMm < MIN_BLEED_MM
  const inverted = page.upsideDown
  return (
    <div className="press-slot" title={`${pos === 'left' ? '左' : '右'}槽 · 版面旋转 ${rotation}°`}>
      <div className="bleed-area" />
      <span className={`bleed-tag ${pos === 'left' ? 'l' : 'r'}`}>出血 {page.blank ? '—' : `${page.bleedMm}mm`}</span>
      <div className="trim-box" />
      {/* 四角裁切标记 */}
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <CropMark key={c} corner={c} />
      ))}
      <div className={`page-face ${rotation === 180 ? 'rotated' : ''} ${page.blank ? 'blank-face' : ''}`}
        style={page.blank ? undefined : { background: page.color }}>
        <div className="pnum">{page.readingIndex}</div>
        <div className="ptitle">{page.title}</div>
        <div className="psrc">{page.blank ? '自动补白' : `源稿 P${page.sourcePage}`}</div>
      </div>
      <span className={`orient-arrow ${rotation === 180 ? 'down' : ''}`}>
        {rotation === 180 ? '↓ 180°' : '↑ 正立'}
      </span>
      {lowBleed && <div className="low-bleed-flag" title={`出血不足 ${MIN_BLEED_MM}mm`} />}
      {inverted && (
        <span className="bp-mark rot" style={{ zIndex: 7 }}>来稿倒置</span>
      )}
      {/* 装订侧提示：正面右槽、背面左槽的内侧边贴折线 */}
      <span
        className="bleed-tag"
        style={{
          bottom: 2,
          top: 'auto',
          [pos === 'left' ? 'right' : 'left']: 4,
          color: '#3a4252',
        } as React.CSSProperties}
      >
        {side.side === 'front'
          ? pos === 'right' ? '◀ 装订侧' : '开口侧'
          : pos === 'left' ? '▶ 装订侧' : '开口侧'}
      </span>
    </div>
  )
}

function CropMark({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const map = {
    tl: { left: 7, top: 7 },
    tr: { right: 7, top: 7 },
    bl: { left: 7, bottom: 7 },
    br: { right: 7, bottom: 7 },
  } as const satisfies Record<string, React.CSSProperties>
  return (
    <>
      <span className="crop h" style={map[corner]} />
      <span className="crop v" style={map[corner]} />
    </>
  )
}

export default function SheetView({ sheets }: Props) {
  return (
    <div className="panel">
      <h2>印张拼版（直视印刷面）</h2>
      <div className="hint">
        每张纸对折套叠成骑马钉，正面与背面上下排列；中央虚线为<b>装订边/折线</b>，
        实线框为<b>裁切线</b>，外侧橙色虚线为<b>出血区</b>。切换翻面方式后，背面的排列与旋转会实时重排。
      </div>

      {sheets.map((s) => (
        <div key={s.sheetIndex} className={`sheet-card ${s.sheetIndex === 0 ? 'outer' : ''}`}>
          <div className="sheet-title">
            第 {s.sheetIndex + 1} 张纸
            {s.sheetIndex === 0 && <span className="tag">最外层 · 封面/封底</span>}
            {s.sheetIndex === sheets.length - 1 && <span className="tag">最内层</span>}
            <span className="pill">书页 {s.front.slots[1].page.readingIndex}、
              {s.back.slots[0].page.readingIndex}、{s.back.slots[1].page.readingIndex}、
              {s.front.slots[0].page.readingIndex}</span>
          </div>

          <div className="sheet-row">
            <div className="side-label">正面</div>
            <div className="sheet-press">
              <Slot side={s.front} slot={s.front.slots[0]} />
              <Slot side={s.front} slot={s.front.slots[1]} />
              <div className="bind-edge" />
            </div>
          </div>

          <div className="sheet-row">
            <div className="side-label">
              背面
              {s.back.slots[0].rotation === 180 && <div className="rot-note">短边翻面 · 旋转180°</div>}
            </div>
            <div className="sheet-press">
              <Slot side={s.back} slot={s.back.slots[0]} />
              <Slot side={s.back} slot={s.back.slots[1]} />
              <div className="bind-edge" />
            </div>
          </div>
        </div>
      ))}

      <div className="legend">
        <span className="lg-bleed">出血区（≥{MIN_BLEED_MM}mm）</span>
        <span className="lg-trim">裁切线</span>
        <span className="lg-bind">装订边/折线</span>
      </div>
    </div>
  )
}
