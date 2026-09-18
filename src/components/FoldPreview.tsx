import { useState } from 'react'
import type { BookIssue, FlipMode, FoldLocation, Sheet } from '../types'
import { MIN_BLEED_MM } from '../lib/imposition'

interface Props {
  sheets: Sheet[]
  foldOrder: FoldLocation[]
  issues: BookIssue[]
  flip: FlipMode
  spread: number
  onSpreadChange: (leftReading: number) => void
  foldSheet: number
  onFoldSheetChange: (k: number) => void
}

/**
 * 成书翻页模型（spread 为“翻开位置”，0..N/2）：
 * 0 = 封面单页；中间 = [2v, 2v+1] 跨页；N/2 = 封底单页。
 */
function spreadPages(view: number, total: number): [number, number | null, boolean] {
  if (view === 0) return [1, null, true]
  if (view === total / 2) return [total, null, true]
  return [2 * view, 2 * view + 1, false]
}

function BookCell({ loc, solo }: { loc: FoldLocation | undefined; solo?: boolean }) {
  if (!loc) {
    return <div className={`book-page empty ${solo ? 'solo' : ''}`}>（无页面）</div>
  }
  const { page, readingOrientation } = loc
  const inverted = readingOrientation === 180
  const lowBleed = !page.blank && page.bleedMm < MIN_BLEED_MM
  return (
    <div
      className={[
        'book-page',
        solo ? 'solo' : '',
        inverted ? 'inverted' : '',
        lowBleed ? 'bleed-bad' : '',
        page.blank ? 'empty' : '',
      ].join(' ')}
      style={page.blank ? undefined : { background: page.color }}
    >
      <div className="bp-warns">
        {inverted && <span className="badge warning">倒置 180°</span>}
        {lowBleed && <span className="badge error">出血不足 {page.bleedMm}mm</span>}
        {page.blank && <span className="badge info">自动补白</span>}
      </div>
      <div className="bp-num">{page.readingIndex}</div>
      <div className="bp-title">{page.title}</div>
      <div className="bp-sub">
        {page.blank ? '空白页' : `源稿 P${page.sourcePage}`} · 第 {loc.sheetIndex + 1} 张纸{loc.side === 'front' ? '正面' : '背面'}
      </div>
      {inverted && <span className="bp-mark rot">读者将看到倒页</span>}
    </div>
  )
}

export default function FoldPreview({
  sheets,
  foldOrder,
  issues,
  flip,
  spread,
  onSpreadChange,
  foldSheet,
  onFoldSheetChange,
}: Props) {
  const total = foldOrder.length
  const [turned, setTurned] = useState(false)
  const [folded, setFolded] = useState(false)

  const [leftRi, rightRi, isCoverOrBack] = spreadPages(spread, total)
  const left = foldOrder.find((f) => f.readingIndex === leftRi)
  const right = rightRi ? foldOrder.find((f) => f.readingIndex === rightRi) : undefined
  const canPrev = spread > 0
  const canNext = spread < total / 2

  const jumpToReading = (r: number) => {
    if (r === 1) onSpreadChange(0)
    else if (r === total) onSpreadChange(total / 2)
    else onSpreadChange(Math.floor(r / 2))
  }

  const sheet = sheets[foldSheet]
  const sheetLeafOrder = foldOrder
    .filter((f) => f.sheetIndex === foldSheet)
    .sort((a, b) => a.readingIndex - b.readingIndex)

  const counts = {
    error: issues.filter((i) => i.level === 'error').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    info: issues.filter((i) => i.level === 'info').length,
  }

  return (
    <div className="panel">
      <h2>折叠预演（成书效果）</h2>
      <div className="hint">
        模拟全部印张套叠折叠后的真实翻页。红色/琥珀色标记直接暴露倒置、出血不足等问题。
      </div>

      <div className="fold-stage">
        {total === 0 ? (
          <div className="book-page empty solo">暂无页面，请在左侧增加或重置手册</div>
        ) : (
          <div className="spread">
            <BookCell loc={left} solo={isCoverOrBack} />
            {!isCoverOrBack && <BookCell loc={right} />}
          </div>
        )}
      </div>

      <div className="fold-nav">
        <button
          className="btn"
          disabled={!canPrev}
          onClick={() => onSpreadChange(Math.max(0, spread - 1))}
        >
          ◀ 上一页
        </button>
        <span className="pos">
          {isCoverOrBack
            ? leftRi === 1 ? '封面' : '封底'
            : `第 ${leftRi} – ${rightRi} 页`}
          {' '}/ 共 {total} 页
        </span>
        <button
          className="btn"
          disabled={!canNext}
          onClick={() => onSpreadChange(Math.min(total / 2, spread + 1))}
        >
          下一页 ▶
        </button>
      </div>

      {/* 单张纸折叠演示 */}
      {total > 0 && (
      <div className="sheet-fold-demo">
        <h2>逐张折叠</h2>
        <div className="sheet-picker">
          {sheets.map((s) => (
            <button
              key={s.sheetIndex}
              className={s.sheetIndex === foldSheet ? 'active' : ''}
              onClick={() => {
                onFoldSheetChange(s.sheetIndex)
                setTurned(false)
                setFolded(false)
              }}
            >
              第 {s.sheetIndex + 1} 张
            </button>
          ))}
        </div>

        <div
          className={[
            'flat-sheet',
            turned ? (flip === 'long' ? 'flipped-long' : 'flipped-short') : '',
            flip === 'short' ? 'flip-short' : '',
            folded ? 'folded' : '',
          ].join(' ')}
        >
          <FlatFace side={sheet.front} face="front" />
          <FlatFace side={sheet.back} face="back" />
        </div>

        <div className="fold-actions">
          <button
            className="btn"
            onClick={() => {
              setTurned((v) => !v)
              setFolded(false)
            }}
          >
            {turned ? '翻回正面' : `翻转看背面（${flip === 'long' ? '长边左右翻' : '短边上下翻'}）`}
          </button>
          <button className="btn primary" onClick={() => setFolded((v) => !v)}>
            {folded ? '展开' : '沿装订边对折'}
          </button>
        </div>

        <div className="fold-result">
          这张纸上的 4 个书页，折叠成册后读到的顺序为：
          <b> {sheetLeafOrder.map((f) => f.page.readingIndex).join(' → ')}</b>
          <br />
          背面摆放：{flip === 'long'
            ? '长边翻转，背面正立'
            : '短边翻转，背面整版旋转 180°（上下翻页后自动正立）'}
          {sheetLeafOrder.some((f) => f.readingOrientation === 180) && (
            <>
              <br />
              <span style={{ color: 'var(--amber)' }}>
                ⚠ 含倒置页：阅读位置{' '}
                {sheetLeafOrder.filter((f) => f.readingOrientation === 180)
                  .map((f) => f.page.readingIndex)
                  .join('、')}
              </span>
            </>
          )}
        </div>
      </div>
      )}

      {/* 问题清单 */}
      <div className="issue-list">
        <h2>
          检查结果
          <span className="summary-pills">
            {counts.error > 0 && <span className="pill error">{counts.error} 错误</span>}
            {counts.warning > 0 && <span className="pill warning">{counts.warning} 警告</span>}
            {counts.info > 0 && <span className="pill">{counts.info} 提示</span>}
            {issues.length === 0 && <span className="pill">全部通过</span>}
          </span>
        </h2>
        {issues.map((issue, i) => (
          <div
            key={i}
            className="issue-item"
            onClick={() => issue.readingIndex && jumpToReading(issue.readingIndex)}
            title="点击跳到该页"
          >
            <span className={`issue-dot ${issue.level}`} />
            <span>
              {issue.message}
              {issue.readingIndex && <span className="loc">（跳转到第 {issue.readingIndex} 页）</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FlatFace({
  side,
  face,
}: {
  side: Sheet['front']
  face: 'front' | 'back'
}) {
  return (
    <div className={`flat-face ${face}`}>
      {side.slots.map((slot) => (
        <div key={slot.pos} className="flat-half" style={{ background: slot.page.blank ? undefined : slot.page.color }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              transform: slot.rotation === 180 ? 'rotate(180deg)' : 'none',
            }}
          >
            <span className="n">{slot.page.readingIndex}</span>
            <span className="t">
              {slot.page.title}
              {slot.rotation === 180 ? ' · 180°' : ''}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
