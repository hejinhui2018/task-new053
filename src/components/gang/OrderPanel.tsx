import type { Grain, Order, OrderStatus } from '../../lib/gangrun'

interface Props {
  orders: Order[]
  onAdd: () => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<Order>) => void
}

const PAPERS = ['157g铜版纸', '200g哑粉纸', '250g白卡', '128g胶版纸']
const COLORS = ['#e85d4d', '#2f8f5b', '#3a6ea5', '#8e5bb0', '#d18a1f', '#4a9da0']

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="gr-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export default function OrderPanel({ orders, onAdd, onDelete, onUpdate }: Props) {
  return (
    <div className="panel gr-order-panel">
      <h2>合版订单</h2>
      <div className="hint">
        配置成品尺寸、书帖数、印数、纸张/纸纹、允许超印与交期。只有
        <b> 已验证 </b>订单（稿件与页码校验通过）才进入合版；不同纸张不共版。
      </div>

      {orders.map((o) => {
        const disabled = o.status === 'draft'
        return (
          <div
            key={o.id}
            className={`gr-order-card ${disabled ? 'draft' : ''}`}
            style={{ borderLeftColor: o.color }}
          >
            <div className="gr-order-head">
              <input
                className="gr-name"
                value={o.name}
                onChange={(e) => onUpdate(o.id, { name: e.target.value })}
              />
              <span className={`gr-status ${o.status}`}>
                {o.status === 'verified' ? '✓ 已验证' : '草稿'}
              </span>
              <button className="icon-btn red" title="删除订单" onClick={() => onDelete(o.id)}>✕</button>
            </div>

            <div className="gr-grid">
              <Field label="成品宽 mm">
                <input type="number" min={1} value={o.widthMm}
                  onChange={(e) => onUpdate(o.id, { widthMm: Math.max(1, Number(e.target.value)) })} />
              </Field>
              <Field label="成品高 mm">
                <input type="number" min={1} value={o.heightMm}
                  onChange={(e) => onUpdate(o.id, { heightMm: Math.max(1, Number(e.target.value)) })} />
              </Field>
              <Field label="书帖数">
                <input type="number" min={1} value={o.signatures}
                  onChange={(e) => onUpdate(o.id, { signatures: Math.max(1, Number(e.target.value)) })} />
              </Field>
              <Field label="印数（册）">
                <input type="number" min={0} step={50} value={o.quantity}
                  onChange={(e) => onUpdate(o.id, { quantity: Math.max(0, Number(e.target.value)) })} />
              </Field>
              <Field label="允许超印">
                <input type="number" min={0} step={10} value={o.maxOvershoot}
                  onChange={(e) => onUpdate(o.id, { maxOvershoot: Math.max(0, Number(e.target.value)) })} />
              </Field>
              <Field label="交期">
                <input type="date" value={o.dueDate}
                  onChange={(e) => onUpdate(o.id, { dueDate: e.target.value })} />
              </Field>
              <Field label="纸张">
                <select value={o.paper} onChange={(e) => onUpdate(o.id, { paper: e.target.value })}>
                  {PAPERS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="纸纹">
                <select
                  value={o.grain}
                  onChange={(e) => onUpdate(o.id, { grain: e.target.value as Grain })}
                >
                  <option value="parallel">顺纹（平行进纸）</option>
                  <option value="perpendicular">横纹（垂直进纸）</option>
                </select>
              </Field>
            </div>

            <div className="gr-order-foot">
              <div className="gr-swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`gr-swatch ${o.color === c ? 'on' : ''}`}
                    style={{ background: c }}
                    title="身份颜色"
                    onClick={() => onUpdate(o.id, { color: c })}
                  />
                ))}
              </div>
              <div className="spacer" />
              <span className="gr-expand">
                展开 {o.widthMm * 2}×{o.heightMm}mm · {o.signatures} 帖 · {o.signatures * 4} 页
              </span>
              <button
                className={`btn ${o.status === 'verified' ? '' : 'primary'}`}
                onClick={() =>
                  onUpdate(o.id, { status: (o.status === 'verified' ? 'draft' : 'verified') as OrderStatus })
                }
              >
                {o.status === 'verified' ? '撤回验证' : '标记已验证'}
              </button>
            </div>
            {disabled && <div className="gr-draft-mask">草稿订单不参与合版</div>}
          </div>
        )
      })}

      <button className="btn primary" style={{ width: '100%', marginTop: 8 }} onClick={onAdd}>
        ＋ 新建订单
      </button>
    </div>
  )
}
