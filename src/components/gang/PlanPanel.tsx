import type {
  GangOrder,
  PlanResult,
} from '../../lib/gang/types'
import type { BaselineSnapshot } from '../../lib/gang/workspace'

interface Props {
  plan: PlanResult
  orders: GangOrder[]
  selectedBoard: number
  onSelectBoard: (i: number) => void
  baseline: BaselineSnapshot | null
  onSaveBaseline: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClearLocks: () => void
  lockCount: number
}

export default function PlanPanel({
  plan,
  orders,
  selectedBoard,
  onSelectBoard,
  baseline,
  onSaveBaseline,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClearLocks,
  lockCount,
}: Props) {
  const t = plan.totals
  const wastePct = (t.wasteRate * 100).toFixed(1)

  return (
    <div className="panel gang-plan-panel">
      <h2>合版计划</h2>

      <div className="undo-row">
        <button className="btn tiny" disabled={!canUndo} onClick={onUndo}>↶ 撤销</button>
        <button className="btn tiny" disabled={!canRedo} onClick={onRedo}>↷ 重做</button>
        <button className="btn tiny" disabled={lockCount === 0} onClick={onClearLocks}>
          清除锁定（{lockCount}）
        </button>
      </div>

      <div className={`feasible-flag ${plan.feasible ? 'ok' : 'bad'}`}>
        {plan.feasible ? '✓ 计划可上机' : '✕ 计划存在错误，不能上机'}
      </div>

      {/* 总量指标 */}
      <div className="metric-grid">
        <Metric label="母版用纸" value={`${t.sheets}`} unit="张" />
        <Metric label="套版/换版" value={`${t.plates}`} unit={plan.strategy === 'min-plates' ? '块版·省版' : '块版'} />
        <Metric label="总超印" value={`${t.overs}`} unit="册" warn={t.overs > 0} />
        <Metric label="废纸率" value={`${wastePct}`} unit="%" warn={Number(wastePct) > 40} />
        <Metric label="纸钱" value={`${t.paperCost.toFixed(0)}`} unit="元" />
        <Metric label="换版费" value={`${t.plateCost}`} unit="元" />
      </div>
      <div className="total-cost">
        合计成本 <b>¥{t.totalCost.toFixed(2)}</b>
      </div>

      {/* 套版选择 */}
      <h3>套版（共 {plan.boards.length} 版）</h3>
      <div className="board-picker">
        {plan.boards.map((b) => (
          <button
            key={b.boardIndex}
            className={`board-chip ${selectedBoard === b.boardIndex ? 'active' : ''}`}
            onClick={() => onSelectBoard(b.boardIndex)}
            title={`第 ${b.boardIndex + 1} 套版 · 印 ${b.repeat} 次 · ${b.cells.length} 帖`}
          >
            第{b.boardIndex + 1}版
            <span className="chip-sub">印 {b.repeat} · {b.cells.length}帖</span>
          </button>
        ))}
      </div>

      {/* 当前版刀序 */}
      {plan.boards[selectedBoard] && (
        <div className="cut-seq">
          <h3>直线裁切刀序（第 {selectedBoard + 1} 版）</h3>
          {plan.boards[selectedBoard].cuts.length === 0 ? (
            <div className="muted">仅一个单元或同组共刀，无需分切。</div>
          ) : (
            <ol className="cut-list">
              {plan.boards[selectedBoard].cuts.map((c, i) => (
                <li key={i}>
                  第 {i + 1} 刀：{c.orient === 'v' ? '竖刀' : '横刀'} ·
                  {' '}{c.orient === 'v' ? `x=${Math.round(c.at)}` : `y=${Math.round(c.at)}`}mm
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* 订单印数满足 */}
      <h3>印数满足情况</h3>
      <div className="stat-list">
        {plan.stats.map((s) => {
          const o = orders.find((x) => x.id === s.orderId)
          if (!o) return null
          const pct = Math.min(100, Math.round((s.copies / s.run) * 100))
          return (
            <div key={s.orderId} className="stat-row">
              <div className="stat-head">
                <span className="order-dot" style={{ background: o.color }} />
                <span className="order-name">{o.name}</span>
                <span className={s.met ? 'gv-badge ok' : 'gv-badge bad'}>
                  {s.met ? '满足' : '不足'}
                </span>
                {s.overs > 0 && <span className="gv-badge warn">超 {s.overs}</span>}
              </div>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{ width: `${pct}%`, background: o.color }}
                />
              </div>
              <div className="stat-sub">
                计划 {s.copies} / 需求 {s.run} · 允许超印 {o.allowOvers} · 参与第
                {' '}{s.boards.map((b) => b + 1).join('、') || '—'} 版
              </div>
            </div>
          )
        })}
      </div>

      {/* 问题 */}
      {plan.issues.length > 0 && (
        <>
          <h3>检查结果</h3>
          <ul className="gang-issues">
            {plan.issues.map((i, k) => (
              <li key={k} className={i.level}>
                <span className={`issue-dot ${i.level === 'warning' ? 'warning' : 'error'}`} />
                {i.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 基线对比 */}
      <h3>方案对比</h3>
      <button className="btn" style={{ width: '100%' }} onClick={onSaveBaseline}>
        将当前计划存为比较基线
      </button>
      {baseline ? (
        <CompareTable baseline={baseline} plan={plan} />
      ) : (
        <div className="muted">尚无基线。调整锁定/策略后存一版基线，可对比用纸、超印与换版成本。</div>
      )}
    </div>
  )
}

function Metric({ label, value, unit, warn }: { label: string; value: string; unit: string; warn?: boolean }) {
  return (
    <div className={`metric ${warn ? 'warn' : ''}`}>
      <div className="m-value">{value}<span className="m-unit">{unit}</span></div>
      <div className="m-label">{label}</div>
    </div>
  )
}

function delta(cur: number, base: number): { text: string; cls: string } {
  const d = cur - base
  if (d === 0) return { text: '±0', cls: 'flat' }
  return {
    text: `${d > 0 ? '+' : ''}${Math.round(d * 100) / 100}`,
    cls: d > 0 ? 'up' : 'down',
  }
}

function CompareTable({ baseline, plan }: { baseline: BaselineSnapshot; plan: PlanResult }) {
  const t = plan.totals
  const rows: Array<{ label: string; base: string; cur: string; d: ReturnType<typeof delta> }> = [
    { label: '母版用纸（张）', base: `${baseline.totals.sheets}`, cur: `${t.sheets}`, d: delta(t.sheets, baseline.totals.sheets) },
    { label: '套版数', base: `${baseline.boardCount}`, cur: `${plan.boards.length}`, d: delta(plan.boards.length, baseline.boardCount) },
    { label: '总超印（册）', base: `${baseline.totals.overs}`, cur: `${t.overs}`, d: delta(t.overs, baseline.totals.overs) },
    { label: '换版费（元）', base: `${baseline.totals.plateCost}`, cur: `${t.plateCost}`, d: delta(t.plateCost, baseline.totals.plateCost) },
    { label: '纸钱（元）', base: baseline.totals.paperCost.toFixed(0), cur: t.paperCost.toFixed(0), d: delta(t.paperCost, baseline.totals.paperCost) },
    { label: '合计（元）', base: baseline.totals.totalCost.toFixed(2), cur: t.totalCost.toFixed(2), d: delta(t.totalCost, baseline.totals.totalCost) },
    { label: '废纸率', base: `${(baseline.totals.wasteRate * 100).toFixed(1)}%`, cur: `${(t.wasteRate * 100).toFixed(1)}%`, d: delta(t.wasteRate, baseline.totals.wasteRate) },
  ]
  return (
    <div className="compare">
      <div className="compare-meta">
        基线「{baseline.label}」 · {new Date(baseline.savedAt).toLocaleString()}
      </div>
      <table>
        <thead>
          <tr><th>指标</th><th>基线</th><th>当前</th><th>差值</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.base}</td>
              <td>{r.cur}</td>
              <td className={`d ${r.d.cls}`}>{r.d.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
