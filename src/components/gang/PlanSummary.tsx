import type { GangPlan, Order } from '../../lib/gangrun'
import { comparePlans, planCost } from '../../lib/gangrun'
import type { BaselinePlan } from '../../lib/gang-storage'

interface Props {
  plan: GangPlan
  orders: Order[]
  baseline: BaselinePlan | null
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onSaveBaseline: () => void
  onClearBaseline: () => void
}

function money(n: number): string {
  return `¥${n.toFixed(1)}`
}

function Delta({ v, good, unit = '' }: { v: number; good?: boolean; unit?: string }) {
  if (v === 0) return <span className="gr-delta zero">±0</span>
  const positive = v > 0
  const cls = good === undefined ? '' : positive === good ? 'good' : 'bad'
  return <span className={`gr-delta ${cls}`}>{positive ? '+' : ''}{v}{unit}</span>
}

export default function PlanSummary({
  plan, orders, baseline, canUndo, canRedo, onUndo, onRedo, onSaveBaseline, onClearBaseline,
}: Props) {
  const cost = planCost(plan)
  const orderName = (id: string) => orders.find((o) => o.id === id)?.name ?? id
  const orderColor = (id: string) => orders.find((o) => o.id === id)?.color ?? '#999'
  const cmp = baseline ? comparePlans(baseline.plan, plan) : null

  return (
    <div className="panel gr-summary">
      <h2>合版计划</h2>

      <div className="gr-toolbar">
        <button className="btn" disabled={!canUndo} onClick={onUndo} title="撤销">↶ 撤销</button>
        <button className="btn" disabled={!canRedo} onClick={onRedo} title="重做">↷ 重做</button>
        <div className="spacer" />
        {baseline ? (
          <>
            <span className="gr-baseline-tag">基线：{baseline.label}</span>
            <button className="btn" onClick={onClearBaseline}>清除基线</button>
          </>
        ) : (
          <button className="btn primary" onClick={onSaveBaseline}>存为比较基线 A</button>
        )}
      </div>

      <div className="gr-metrics">
        <div className="gr-metric">
          <span className="num">{plan.metrics.sheetCount}</span>
          <span className="lbl">印版套数（换版）</span>
        </div>
        <div className="gr-metric">
          <span className="num">{plan.metrics.totalSheets}</span>
          <span className="lbl">耗用母版（张）</span>
        </div>
        <div className="gr-metric">
          <span className="num">{(plan.metrics.wasteRate * 100).toFixed(1)}%</span>
          <span className="lbl">废纸率</span>
        </div>
        <div className="gr-metric">
          <span className="num">{plan.metrics.totalOvershoot}</span>
          <span className="lbl">总超印（册）</span>
        </div>
        <div className="gr-metric">
          <span className="num">{money(cost.total)}</span>
          <span className="lbl">纸张+超印+换版</span>
        </div>
      </div>

      {/* 各套排布张数 */}
      {plan.layouts.length > 0 && (
        <div className="gr-runs">
          {plan.layouts.map((l) => (
            <span key={l.index} className="gr-run-pill" title={`纸张 ${l.paper} · ${l.grain === 'parallel' ? '顺纹' : '横纹'}`}>
              第 {l.index + 1} 套 × {l.runLength} 张 · {l.placed.front.length} 帖
            </span>
          ))}
        </div>
      )}

      {/* 印数满足 */}
      <div className="gr-fulfill">
        <b>印数满足情况</b>
        {plan.fulfillment.length === 0 && <div className="sub">暂无已验证订单</div>}
        {plan.fulfillment.map((f) => {
          const pct = f.needed === 0 ? 100 : Math.min(100, (f.copies / f.needed) * 100)
          return (
            <div key={f.orderId} className="gr-ff-row">
              <span className="gr-ff-dot" style={{ background: orderColor(f.orderId) }} />
              <span className="gr-ff-name">{orderName(f.orderId)}</span>
              <div className="gr-ff-bar">
                <div className="gr-ff-fill" style={{ width: `${pct}%`, background: orderColor(f.orderId) }} />
              </div>
              <span className="gr-ff-num">
                {f.copies}/{f.needed}
                {f.overshoot > 0 && <em className="over"> 超 {f.overshoot}</em>}
                {f.shortage > 0 && <em className="short"> 缺 {f.shortage}</em>}
              </span>
            </div>
          )
        })}
      </div>

      {/* 警告 */}
      {plan.warnings.length > 0 && (
        <div className="gr-warnings">
          {plan.warnings.map((w, i) => (
            <div key={i} className="gr-warn">⚠ {w}</div>
          ))}
        </div>
      )}

      {/* 基线比较 */}
      {cmp && baseline && (
        <div className="gr-compare">
          <b>计划比较（A = 基线 · B = 当前）</b>
          <table>
            <thead>
              <tr><th>指标</th><th>A 基线</th><th>B 当前</th><th>差额 B−A</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>母版张数</td><td>{cmp.a.totalSheets}</td><td>{cmp.b.totalSheets}</td>
                <td><Delta v={cmp.delta.sheets} good={false} unit=" 张" /></td>
              </tr>
              <tr>
                <td>超印（册）</td><td>{cmp.a.overshoot}</td><td>{cmp.b.overshoot}</td>
                <td><Delta v={cmp.delta.overshoot} good={false} unit="" /></td>
              </tr>
              <tr>
                <td>换版次数</td><td>{cmp.a.plateChanges}</td><td>{cmp.b.plateChanges}</td>
                <td><Delta v={cmp.delta.plateChanges} good={false} unit="" /></td>
              </tr>
              <tr>
                <td>总成本</td><td>{money(cmp.a.cost.total)}</td><td>{money(cmp.b.cost.total)}</td>
                <td><Delta v={Math.round(cmp.delta.total * 10) / 10} good={false} unit=" 元" /></td>
              </tr>
            </tbody>
          </table>
          <div className={`gr-verdict ${cmp.cheaper}`}>
            {cmp.cheaper === 'tie'
              ? '两套计划成本持平'
              : cmp.cheaper === 'a'
                ? `基线 A 更省，节省 ${money(cmp.b.cost.total - cmp.a.cost.total)}`
                : `当前 B 更省，节省 ${money(cmp.a.cost.total - cmp.b.cost.total)}`}
          </div>
        </div>
      )}
    </div>
  )
}
