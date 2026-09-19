import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  expandUnits,
  planGangRun,
  validatePlan,
  type DeadZone,
  type MasterSheet,
  type Order,
} from '../../lib/gangrun'
import {
  clearGangState,
  gangReducer,
  loadGangState,
  newGangState,
  saveGangState,
  type BaselinePlan,
  type GangSnapshot,
} from '../../lib/gang-storage'
import OrderPanel from './OrderPanel'
import MasterPanel from './MasterPanel'
import PlanSummary from './PlanSummary'
import SheetSvg from './SheetSvg'

const NEW_COLORS = ['#8e5bb0', '#d18a1f', '#4a9da0', '#c25d7a', '#5d7ac2']

export default function GangWorkspace() {
  const [state, dispatch] = useReducer(gangReducer, null, () => loadGangState() ?? newGangState())
  const [layoutIdx, setLayoutIdx] = useState(0)
  const dzCounter = useRef(0)

  const { orders, master, locks, baseline } = state

  // 确定性计划：编辑状态的纯函数
  const plan = useMemo(
    () => planGangRun({ orders, master, options: { locks } }),
    [orders, master, locks],
  )
  const validation = useMemo(() => validatePlan(plan, master), [plan, master])

  // 持久化
  useEffect(() => {
    saveGangState(state)
  }, [state])

  // 布局序号夹紧
  const safeIdx = plan.layouts.length === 0 ? 0 : Math.min(layoutIdx, plan.layouts.length - 1)
  useEffect(() => {
    if (safeIdx !== layoutIdx) setLayoutIdx(safeIdx)
  }, [safeIdx, layoutIdx])

  // 撤销/重做快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        dispatch({ type: 'undo' })
      } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const commit = (patch: Partial<GangSnapshot>) => dispatch({ type: 'commit', patch })

  // ---- 订单编辑 ----
  const addOrder = () => {
    const id = `ord_${Date.now().toString(36)}`
    const order: Order = {
      id,
      name: `新订单 ${orders.length + 1}`,
      color: NEW_COLORS[orders.length % NEW_COLORS.length],
      widthMm: 140,
      heightMm: 210,
      signatures: 1,
      quantity: 100,
      paper: '157g铜版纸',
      grain: 'parallel',
      maxOvershoot: 50,
      dueDate: '2026-10-30',
      status: 'draft',
    }
    commit({ orders: [...orders, order] })
  }
  const updateOrder = (id: string, patch: Partial<Order>) =>
    commit({ orders: orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
  const deleteOrder = (id: string) =>
    commit({
      orders: orders.filter((o) => o.id !== id),
      locks: locks.filter((l) => l.unitId.split('#')[0] !== id),
    })

  // ---- 母版编辑 ----
  const updateMaster = (patch: Partial<MasterSheet>) =>
    commit({ master: { ...master, ...patch } })
  const addDeadZone = () => {
    dzCounter.current += 1
    const dz: DeadZone = { id: `dz_${dzCounter.current}_${Date.now().toString(36)}`, xMm: 40, yMm: 40, widthMm: 80, heightMm: 60 }
    commit({ master: { ...master, deadZones: [...master.deadZones, dz] } })
  }
  const updateDeadZone = (id: string, patch: Partial<DeadZone>) =>
    commit({
      master: {
        ...master,
        deadZones: master.deadZones.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      },
    })
  const deleteDeadZone = (id: string) =>
    commit({ master: { ...master, deadZones: master.deadZones.filter((d) => d.id !== id) } })

  // ---- 锁定 ----
  type LockPos = { xMm: number; yMm: number; rotation: 0 | 90 | 180 | 270 }
  const handleInteract = (unitId: string, lock: LockPos | null) => {
    // 锁定只对首套排布生效；非首套不处理
    if (safeIdx !== 0) return
    if (!lock) {
      commit({ locks: locks.filter((l) => l.unitId !== unitId) })
      return
    }
    const rest = locks.filter((l) => l.unitId !== unitId)
    commit({ locks: [...rest, { unitId, ...lock }] })
  }

  // ---- 基线 ----
  const saveBaseline = () => {
    const baselinePlan: BaselinePlan = {
      label: `基线 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      savedAt: new Date().toISOString(),
      plan,
    }
    dispatch({ type: 'setBaseline', baseline: baselinePlan })
  }
  const clearBaseline = () => dispatch({ type: 'setBaseline', baseline: null })

  const resetSamples = () => {
    if (!window.confirm('恢复三个内置订单样例与默认母版？当前合版编辑会被清除。')) return
    clearGangState()
    dispatch({ type: 'replace', state: { orders: newGangState().orders, master: newGangState().master, locks: [] } })
    setLayoutIdx(0)
  }

  const layout = plan.layouts[safeIdx]
  const verifiedCount = orders.filter((o) => o.status === 'verified').length
  const unitCount = expandUnits(orders.filter((o) => o.status === 'verified')).length

  return (
    <div className="gang-layout">
      <div className="gang-col gang-col-left">
        <OrderPanel orders={orders} onAdd={addOrder} onDelete={deleteOrder} onUpdate={updateOrder} />
        <MasterPanel
          master={master}
          onChange={updateMaster}
          onAddDeadZone={addDeadZone}
          onDeleteDeadZone={deleteDeadZone}
          onUpdateDeadZone={updateDeadZone}
        />
        <button className="btn danger" style={{ width: '100%', marginTop: 8 }} onClick={resetSamples}>
          恢复内置样例
        </button>
      </div>

      <div className="gang-col gang-col-center">
        <div className="panel">
          <h2>母版正反面 · 排布与裁切</h2>
          <div className="hint">
            已验证订单 <b>{verifiedCount}</b> 个 · 生产单元（书帖）<b>{unitCount}</b> 个 ·
            母版 <b>{master.name}</b>（{master.widthMm}×{master.heightMm}mm）·
            {master.flip === 'long-edge' ? '长边翻转' : '短边翻转'}
            {!validation.ok && <span style={{ color: 'var(--red)', marginLeft: 8 }}>● 排布校验未通过</span>}
          </div>

          {plan.layouts.length === 0 ? (
            <div className="gr-empty">
              暂无可排布内容：请新建并「标记已验证」订单，或检查成品尺寸是否超过母版可印区。
            </div>
          ) : (
            <>
              <div className="gr-layout-tabs">
                {plan.layouts.map((l) => (
                  <button
                    key={l.index}
                    className={l.index === safeIdx ? 'active' : ''}
                    onClick={() => setLayoutIdx(l.index)}
                  >
                    第 {l.index + 1} 套 ×{l.runLength} 张
                  </button>
                ))}
              </div>
              {layout && (
                <>
                  <div className="gr-layout-meta">
                    纸张 {layout.paper} · {layout.grain === 'parallel' ? '顺纹（平行进纸）' : '横纹'} ·
                    正面 {layout.placed.front.length} 帖 · {layout.cuts.length} 条贯穿裁切线
                  </div>
                  <SheetSvg
                    layout={layout}
                    master={master}
                    orders={orders}
                    onInteract={handleInteract}
                  />
                </>
              )}
            </>
          )}

          {!validation.ok && (
            <div className="gr-errors">
              {validation.errors.map((e, i) => <div key={i} className="gr-warn">✗ {e}</div>)}
            </div>
          )}

          <div className="gr-legend">
            <span><i className="lg-sw" style={{ background: '#d23b3b33', border: '1px dashed #d23b3b' }} />咬口</span>
            <span><i className="lg-sw" style={{ background: '#5b647222', border: '1px dashed #5b6472' }} />禁印区</span>
            <span><i className="lg-line" style={{ borderTop: '2px dashed #b97a12' }} />直线裁切（编号=下刀顺序）</span>
            <span><i className="lg-sw" style={{ background: 'repeating-linear-gradient(90deg,#00000010 0 2px,transparent 2px 6px)' }} />纸纹方向</span>
            <span>🔒 人工锁定</span>
          </div>
        </div>
      </div>

      <div className="gang-col gang-col-right">
        <PlanSummary
          plan={plan}
          orders={orders}
          baseline={baseline}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onSaveBaseline={saveBaseline}
          onClearBaseline={clearBaseline}
        />
      </div>
    </div>
  )
}
