/** 合版工作区：可编辑状态、撤销/重做历史、比较基线 */
import type {
  ForbiddenZone,
  GangOrder,
  LockedCell,
  PlanResult,
  PlanStrategy,
  PressConfig,
} from './types'
import { MASTER_PRESETS, createSampleForbidden, createSampleOrders } from './catalog'

export interface GangWorkspace {
  orders: GangOrder[]
  /** 选中的母版预设 id */
  masterId: string
  press: PressConfig
  forbidden: ForbiddenZone[]
  locks: LockedCell[]
  strategy: PlanStrategy
}

/** 比较基线（只保存对比所需的快照） */
export interface BaselineSnapshot {
  savedAt: number
  label: string
  boardCount: number
  totals: PlanResult['totals']
  stats: Array<Pick<PlanResult['stats'][number], 'orderId' | 'copies' | 'overs' | 'met'>>
}

export interface History {
  past: GangWorkspace[]
  future: GangWorkspace[]
}

const HISTORY_LIMIT = 60

export function defaultWorkspace(): GangWorkspace {
  return {
    orders: createSampleOrders(),
    masterId: MASTER_PRESETS[0].id,
    press: {
      mode: 'work-and-turn',
      flip: 'long',
      grip: { edge: 'top', widthMm: 12 },
    },
    forbidden: createSampleForbidden(),
    locks: [],
    strategy: 'min-overs',
  }
}

/** 在应用一次修改前调用：把当前状态压入过去栈 */
export function commit(history: History, current: GangWorkspace): History {
  return {
    past: [...history.past, clone(current)].slice(-HISTORY_LIMIT),
    future: [],
  }
}

export function undo(history: History, current: GangWorkspace): { history: History; ws: GangWorkspace } | null {
  if (history.past.length === 0) return null
  const prev = history.past[history.past.length - 1]
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [clone(current), ...history.future].slice(0, HISTORY_LIMIT),
    },
    ws: prev,
  }
}

export function redo(history: History, current: GangWorkspace): { history: History; ws: GangWorkspace } | null {
  if (history.future.length === 0) return null
  const next = history.future[0]
  return {
    history: {
      past: [...history.past, clone(current)].slice(-HISTORY_LIMIT),
      future: history.future.slice(1),
    },
    ws: next,
  }
}

export function snapshotBaseline(plan: PlanResult, label: string, savedAt: number): BaselineSnapshot {
  return {
    savedAt,
    label,
    boardCount: plan.boards.length,
    totals: plan.totals,
    stats: plan.stats.map((s) => ({
      orderId: s.orderId,
      copies: s.copies,
      overs: s.overs,
      met: s.met,
    })),
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

let idSeq = 0
/** 浏览器环境也安全的 id（不依赖 crypto） */
export function gangId(prefix: string): string {
  idSeq += 1
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${idSeq}`
  return `${prefix}_${rand}`
}
