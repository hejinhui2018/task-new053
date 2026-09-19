import { useEffect, useMemo, useState } from 'react'
import OrderPanel from './OrderPanel'
import MasterBoard from './MasterBoard'
import PlanPanel from './PlanPanel'
import { planGang } from '../../lib/gang/plan'
import { MASTER_PRESETS } from '../../lib/gang/catalog'
import {
  commit,
  defaultWorkspace,
  redo,
  snapshotBaseline,
  undo,
  type BaselineSnapshot,
  type GangWorkspace,
  type History,
  gangId,
} from '../../lib/gang/workspace'
import {
  clearGangState,
  loadGangState,
  saveGangState,
} from '../../lib/storage'
import type { LockedCell } from '../../lib/gang/types'

interface PersistShape {
  workspace: GangWorkspace
  history: History
  baseline: BaselineSnapshot | null
}

export default function GangPlanner() {
  const initial = useMemo<PersistShape>(() => {
    const saved = loadGangState()
    if (saved) return { workspace: saved.workspace, history: saved.history, baseline: saved.baseline }
    return { workspace: defaultWorkspace(), history: { past: [], future: [] }, baseline: null }
  }, [])

  const [ws, setWs] = useState<GangWorkspace>(initial.workspace)
  const [history, setHistory] = useState<History>(initial.history)
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(initial.baseline)
  const [selectedBoard, setSelectedBoard] = useState(0)
  const [pendingUnitSelect, setPendingUnitSelect] = useState<string | null>(null)

  const master = useMemo(
    () => MASTER_PRESETS.find((m) => m.id === ws.masterId) ?? MASTER_PRESETS[0],
    [ws.masterId],
  )

  const plan = useMemo(
    () =>
      planGang({
        orders: ws.orders,
        master,
        press: ws.press,
        forbidden: ws.forbidden,
        locks: ws.locks,
        strategy: ws.strategy,
      }),
    [ws.orders, ws, master, ws.press, ws.forbidden, ws.locks, ws.strategy],
  )

  // 拖拽结束后，选中被锁单元最终落位的套版（重算可能改了版序号）
  useEffect(() => {
    if (!pendingUnitSelect) return
    const found = plan.boards.find((b) => b.cells.some((c) => c.unitId === pendingUnitSelect && c.locked))
    if (found) setSelectedBoard(found.boardIndex)
    setPendingUnitSelect(null)
  }, [pendingUnitSelect, plan])

  // 切换配置后夹紧选中的套版
  const safeBoard = plan.boards.length === 0 ? 0 : Math.min(selectedBoard, plan.boards.length - 1)
  useEffect(() => {
    if (safeBoard !== selectedBoard) setSelectedBoard(safeBoard)
  }, [safeBoard, selectedBoard])

  // 本地持久化
  useEffect(() => {
    saveGangState({ version: 1, workspace: ws, history, baseline })
  }, [ws, history, baseline])

  /** 应用一次可撤销修改 */
  const applyChange = (patch: Partial<GangWorkspace>) => {
    setHistory((h) => commit(h, ws))
    setWs((cur) => ({ ...cur, ...patch }))
  }

  /** 拖拽过程中的临时更新：不入历史，直到手势开始时已入栈 */
  const applyLocks = (locks: LockedCell[], transient = false) => {
    if (transient) {
      setWs((cur) => ({ ...cur, locks }))
    } else {
      applyChange({ locks })
    }
  }

  const beginDrag = () => {
    setHistory((h) => commit(h, ws))
  }

  const doUndo = () => {
    const r = undo(history, ws)
    if (r) {
      setHistory(r.history)
      setWs(r.ws)
    }
  }
  const doRedo = () => {
    const r = redo(history, ws)
    if (r) {
      setHistory(r.history)
      setWs(r.ws)
    }
  }

  const addOrder = () => {
    const palette = ['#7c4dff', '#00897b', '#ef6c00', '#c2185b', '#455a64', '#558b2f']
    applyChange({
      orders: [
        ...ws.orders,
        {
          id: gangId('ord'),
          name: `新订单 ${ws.orders.length + 1}`,
          color: palette[ws.orders.length % palette.length],
          trimW: 140,
          trimH: 210,
          signatures: 2,
          run: 100,
          paper: master.grade,
          grain: 'long',
          allowOvers: 10,
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
          allowRotate: true,
          verified: true,
        },
      ],
    })
  }

  const saveBaseline = () => {
    setBaseline(snapshotBaseline(plan, `基线 ${new Date().toLocaleString()}`, Date.now()))
  }

  const resetAll = () => {
    if (!window.confirm('恢复为内置三订单示例并清空锁定、历史与基线？')) return
    clearGangState()
    setWs(defaultWorkspace())
    setHistory({ past: [], future: [] })
    setBaseline(null)
  }

  const shownBoard = plan.boards.find((b) => b.boardIndex === safeBoard) ?? plan.boards[0]

  return (
    <div className="gang-layout">
      <div className="gang-toolbar">
        <span className="hint">
          多个小批量骑马钉订单合在同一母版印刷；拖动书帖可人工锁定，其余单元自动重排。
        </span>
        <div className="spacer" />
        <button className="btn danger tiny" onClick={resetAll}>重置示例</button>
      </div>

      <div className="gang-grid">
        <OrderPanel
          orders={ws.orders}
          master={master}
          press={ws.press}
          forbidden={ws.forbidden}
          strategy={ws.strategy}
          onChange={applyChange}
          onAddOrder={addOrder}
        />

        <div className="panel gang-board-panel">
          <h2>母版正反面{shownBoard ? ` · 第 ${shownBoard.boardIndex + 1} 套版 · 印 ${shownBoard.repeat} 次` : ''}</h2>
          <div className="hint">
            左侧为正面、右侧为翻面后背面的真实镜像位置（短边上下翻为整版 180°）。
            拖动正面书帖即锁定人工位置，系统保持其余单元无重叠、合纸纹、可直刀分离。
          </div>
          {shownBoard ? (
            <MasterBoard
              master={master}
              mode={ws.press.mode}
              grip={ws.press.grip}
              forbidden={ws.forbidden}
              board={shownBoard}
              locks={ws.locks}
              onLockChange={applyLocks}
              onDragBegin={beginDrag}
              onDragEnd={(cell) => setPendingUnitSelect(cell.unitId)}
            />
          ) : (
            <div className="empty-board">当前条件下没有可展示的套版，请检查订单与母版设置。</div>
          )}
        </div>

        <PlanPanel
          plan={plan}
          orders={ws.orders}
          selectedBoard={safeBoard}
          onSelectBoard={setSelectedBoard}
          baseline={baseline}
          onSaveBaseline={saveBaseline}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={doUndo}
          onRedo={doRedo}
          onClearLocks={() => applyChange({ locks: [] })}
          lockCount={ws.locks.length}
        />
      </div>
    </div>
  )
}
