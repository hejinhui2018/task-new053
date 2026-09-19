import { useState } from 'react'
import type {
  ForbiddenZone,
  GangOrder,
  GripEdge,
  BackMode,
  MasterSheet,
  PaperGrade,
  PlanStrategy,
  PressConfig,
} from '../../lib/gang/types'
import { MASTER_PRESETS, PAPER_GRADES } from '../../lib/gang/catalog'

interface Props {
  orders: GangOrder[]
  master: MasterSheet
  press: PressConfig
  forbidden: ForbiddenZone[]
  strategy: PlanStrategy
  onChange: (next: {
    orders?: GangOrder[]
    masterId?: string
    press?: PressConfig
    forbidden?: ForbiddenZone[]
    strategy?: PlanStrategy
  }) => void
  onAddOrder: () => void
}

const GRIP_EDGES: Array<{ value: GripEdge; label: string }> = [
  { value: 'top', label: '上边（叼口）' },
  { value: 'bottom', label: '下边' },
  { value: 'left', label: '左边' },
  { value: 'right', label: '右边' },
]

const MODES: Array<{ value: BackMode; label: string; hint: string }> = [
  { value: 'work-and-turn', label: '自翻·左右翻', hint: '背面横向镜像，咬口边不变' },
  { value: 'work-and-tumble', label: '自翻·上下翻', hint: '背面整版旋转 180°' },
  { value: 'work-and-back', label: '正反版', hint: '正反两套版，换版费 ×2' },
]

export default function OrderPanel({
  orders,
  master,
  press,
  forbidden,
  strategy,
  onChange,
  onAddOrder,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null)

  const patchOrder = (id: string, patch: Partial<GangOrder>) => {
    onChange({ orders: orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
  }

  const patchFz = (id: string, patch: Partial<ForbiddenZone>) => {
    onChange({
      forbidden: forbidden.map((f) =>
        f.id === id ? { ...f, ...patch, rect: { ...f.rect, ...(patch.rect ?? {}) } } : f,
      ),
    })
  }

  return (
    <div className="panel gang-order-panel">
      <h2>合版订单</h2>
      <div className="hint">
        每个订单是一本骑马钉画册；只有<b>已验证</b>书帖可进入合版，纸张必须与母版一致。
      </div>

      {orders.map((o) => {
        const open = editing === o.id
        return (
          <div key={o.id} className="order-card" style={{ borderLeftColor: o.color }}>
            <div className="order-head">
              <span className="order-dot" style={{ background: o.color }} />
              <span className="order-name" title={o.name}>{o.name}</span>
              <span className={`gv-badge ${o.verified ? 'ok' : 'bad'}`}>
                {o.verified ? '已验证' : '未验证'}
              </span>
              <button className="icon-btn" title="编辑" onClick={() => setEditing(open ? null : o.id)}>
                {open ? '✓' : '✎'}
              </button>
              <button
                className="icon-btn red"
                title="删除订单"
                onClick={() => onChange({ orders: orders.filter((x) => x.id !== o.id) })}
              >
                ✕
              </button>
            </div>
            <div className="order-sub">
              {o.trimW}×{o.trimH}mm · {o.signatures} 帖 · 印 {o.run} 册 ·{' '}
              {PAPER_GRADES[o.paper].label} · {o.grain === 'long' ? '顺纹' : '横纹'}
            </div>

            {open && (
              <div className="order-form">
                <label>名称
                  <input value={o.name} onChange={(e) => patchOrder(o.id, { name: e.target.value })} />
                </label>
                <div className="form-row">
                  <label>成品宽
                    <input type="number" value={o.trimW} onChange={(e) => patchOrder(o.id, { trimW: num(e) })} />
                  </label>
                  <label>成品高
                    <input type="number" value={o.trimH} onChange={(e) => patchOrder(o.id, { trimH: num(e) })} />
                  </label>
                </div>
                <div className="form-row">
                  <label>书帖数
                    <input type="number" value={o.signatures} onChange={(e) => patchOrder(o.id, { signatures: Math.max(1, num(e)) })} />
                  </label>
                  <label>印数
                    <input type="number" value={o.run} onChange={(e) => patchOrder(o.id, { run: Math.max(1, num(e)) })} />
                  </label>
                </div>
                <div className="form-row">
                  <label>允许超印
                    <input type="number" value={o.allowOvers} onChange={(e) => patchOrder(o.id, { allowOvers: Math.max(0, num(e)) })} />
                  </label>
                  <label>交期
                    <input type="date" value={o.dueDate} onChange={(e) => patchOrder(o.id, { dueDate: e.target.value })} />
                  </label>
                </div>
                <div className="form-row">
                  <label>纸张
                    <select
                      value={o.paper}
                      onChange={(e) => patchOrder(o.id, { paper: e.target.value as PaperGrade })}
                    >
                      {Object.entries(PAPER_GRADES).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>纸纹
                    <select value={o.grain} onChange={(e) => patchOrder(o.id, { grain: e.target.value as GangOrder['grain'] })}>
                      <option value="long">顺纹（平行长边）</option>
                      <option value="short">横纹（垂直长边）</option>
                    </select>
                  </label>
                </div>
                <div className="form-row check-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={o.allowRotate}
                      onChange={(e) => patchOrder(o.id, { allowRotate: e.target.checked })}
                    />
                    允许旋转 90°
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={o.verified}
                      onChange={(e) => patchOrder(o.id, { verified: e.target.checked })}
                    />
                    书帖已验证
                  </label>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <button className="btn primary" style={{ width: '100%', marginTop: 8 }} onClick={onAddOrder}>
        ＋ 新建订单
      </button>

      <div className="gang-config">
        <h3>母版纸与上机</h3>
        <label>母版
          <select
            value={master.id}
            onChange={(e) => onChange({ masterId: e.target.value })}
          >
            {MASTER_PRESETS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.widthMm}×{m.heightMm}，{m.grain === 'long' ? '顺纹' : '横纹'}）
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>咬口位置
            <select
              value={press.grip.edge}
              onChange={(e) =>
                onChange({ press: { ...press, grip: { ...press.grip, edge: e.target.value as GripEdge } } })
              }
            >
              {GRIP_EDGES.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </label>
          <label>咬口 mm
            <input
              type="number"
              value={press.grip.widthMm}
              onChange={(e) =>
                onChange({ press: { ...press, grip: { ...press.grip, widthMm: Math.max(0, num(e)) } } })
              }
            />
          </label>
        </div>

        <h3>印刷方式（背面落位）</h3>
        <div className="mode-list">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={`mode-btn ${press.mode === m.value ? 'active' : ''}`}
              onClick={() => onChange({ press: { ...press, mode: m.value } })}
              title={m.hint}
            >
              <b>{m.label}</b>
              <span>{m.hint}</span>
            </button>
          ))}
        </div>

        <h3>优化策略</h3>
        <div className="flip-toggle" role="group">
          <button
            className={strategy === 'min-overs' ? 'active' : ''}
            onClick={() => onChange({ strategy: 'min-overs' })}
          >
            最少超印
          </button>
          <button
            className={strategy === 'min-plates' ? 'active' : ''}
            onClick={() => onChange({ strategy: 'min-plates' })}
          >
            最少换版
          </button>
        </div>

        <h3>禁印区</h3>
        {forbidden.map((f) => (
          <div key={f.id} className="fz-row">
            <div className="fz-head">
              <input
                className="fz-name"
                value={f.name}
                onChange={(e) => patchFz(f.id, { name: e.target.value })}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={f.mirrorToBack}
                  onChange={(e) => patchFz(f.id, { mirrorToBack: e.target.checked })}
                />
                跟随翻面
              </label>
              <button
                className="icon-btn red"
                onClick={() => onChange({ forbidden: forbidden.filter((x) => x.id !== f.id) })}
              >
                ✕
              </button>
            </div>
            <div className="form-row">
              <label>x<input type="number" value={f.rect.x} onChange={(e) => patchFz(f.id, { rect: { ...f.rect, x: num(e) } })} /></label>
              <label>y<input type="number" value={f.rect.y} onChange={(e) => patchFz(f.id, { rect: { ...f.rect, y: num(e) } })} /></label>
              <label>宽<input type="number" value={f.rect.w} onChange={(e) => patchFz(f.id, { rect: { ...f.rect, w: num(e) } })} /></label>
              <label>高<input type="number" value={f.rect.h} onChange={(e) => patchFz(f.id, { rect: { ...f.rect, h: num(e) } })} /></label>
            </div>
          </div>
        ))}
        <button
          className="btn"
          style={{ width: '100%', marginTop: 6 }}
          onClick={() =>
            onChange({
              forbidden: [
                ...forbidden,
                {
                  id: `fz_${Date.now().toString(36)}`,
                  name: '禁印区',
                  rect: { x: 40, y: 40, w: 120, h: 30 },
                  mirrorToBack: true,
                },
              ],
            })
          }
        >
          ＋ 添加禁印区
        </button>
      </div>
    </div>
  )
}

function num(e: React.ChangeEvent<HTMLInputElement>): number {
  return Number(e.target.value)
}
