/**
 * 多订单合版工作区：内置样例、localStorage 持久化、撤销/重做 reducer。
 *
 * 计划本身是 orders/master/locks 的确定性函数，刷新后重新计算即可，
 * 无需持久化；需要保存的是编辑状态、人工锁定与【比较基线】快照。
 */
import type { GangPlan, LockedPlacement, MasterSheet, Order } from './gangrun'

const STORAGE_KEY = 'imposition-studio:gang:v1'
const HISTORY_LIMIT = 50

// ---------------------------------------------------------------------------
// 默认母版与三个订单样例
// ---------------------------------------------------------------------------

/** 大度对开母版（横向），上咬口 12mm */
export function defaultMaster(): MasterSheet {
  return {
    name: '大度对开 860×590',
    widthMm: 860,
    heightMm: 590,
    gripperEdge: 'top',
    gripperMm: 12,
    deadZones: [],
    pressMode: 'perfector',
    flip: 'long-edge',
    allowRotation: false,
    runStep: 50,
  }
}

/**
 * 三个不同尺寸与印数、同纸同纹的骑马钉订单：
 * 大订单 500 册带两个小订单合版（480 → 超印 20；460 → 超印 40），
 * 一次展示合版、数量倍数、允许超印与正反面镜像。6 个生产单元可在
 * 一张大度对开母版上以 guillotine 直线刀路分离。
 */
export function sampleOrders(): Order[] {
  return [
    {
      id: 'sample-city',
      name: '城市文旅画册',
      color: '#e85d4d',
      widthMm: 210,
      heightMm: 285,
      signatures: 1,
      quantity: 500,
      paper: '157g铜版纸',
      grain: 'parallel',
      maxOvershoot: 0,
      dueDate: '2026-10-08',
      status: 'verified',
    },
    {
      id: 'sample-brand',
      name: '品牌产品手册',
      color: '#2f8f5b',
      widthMm: 130,
      heightMm: 200,
      signatures: 2,
      quantity: 480,
      paper: '157g铜版纸',
      grain: 'parallel',
      maxOvershoot: 40,
      dueDate: '2026-10-15',
      status: 'verified',
    },
    {
      id: 'sample-expo',
      name: '展会明信片册',
      color: '#3a6ea5',
      widthMm: 100,
      heightMm: 140,
      signatures: 1,
      quantity: 460,
      paper: '157g铜版纸',
      grain: 'parallel',
      maxOvershoot: 50,
      dueDate: '2026-10-20',
      status: 'verified',
    },
  ]
}

// ---------------------------------------------------------------------------
// 持久化状态与撤销/重做
// ---------------------------------------------------------------------------

export interface GangSnapshot {
  orders: Order[]
  master: MasterSheet
  locks: LockedPlacement[]
}

export interface BaselinePlan {
  label: string
  savedAt: string
  plan: GangPlan
}

export interface GangState extends GangSnapshot {
  version: 1
  past: GangSnapshot[]
  future: GangSnapshot[]
  /** 计划比较基线（A）；当前计划为 B */
  baseline: BaselinePlan | null
}

export type GangAction =
  | { type: 'commit'; patch: Partial<GangSnapshot>; label?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'setBaseline'; baseline: BaselinePlan | null }
  | { type: 'replace'; state: GangSnapshot }

export function newGangState(snapshot?: GangSnapshot): GangState {
  const base = snapshot ?? { orders: sampleOrders(), master: defaultMaster(), locks: [] }
  return { version: 1, past: [], future: [], baseline: null, ...base }
}

/** 纯函数 reducer：commit 推入历史栈，undo/redo 交换快照 */
export function gangReducer(state: GangState, action: GangAction): GangState {
  const takeSnapshot = (): GangSnapshot => ({
    orders: state.orders,
    master: state.master,
    locks: state.locks,
  })

  switch (action.type) {
    case 'commit': {
      const next: GangSnapshot = {
        orders: action.patch.orders ?? state.orders,
        master: action.patch.master ?? state.master,
        locks: action.patch.locks ?? state.locks,
      }
      // 无实际变化时不入栈
      if (
        JSON.stringify(next) === JSON.stringify(takeSnapshot())
      ) {
        return state
      }
      const past = [...state.past, takeSnapshot()].slice(-HISTORY_LIMIT)
      return { ...state, ...next, past, future: [] }
    }
    case 'undo': {
      if (state.past.length === 0) return state
      const prev = state.past[state.past.length - 1]
      return {
        ...state,
        ...prev,
        past: state.past.slice(0, -1),
        future: [takeSnapshot(), ...state.future].slice(0, HISTORY_LIMIT),
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const [next, ...rest] = state.future
      return {
        ...state,
        ...next,
        past: [...state.past, takeSnapshot()].slice(-HISTORY_LIMIT),
        future: rest,
      }
    }
    case 'setBaseline':
      return { ...state, baseline: action.baseline }
    case 'replace':
      return newGangState(action.state)
  }
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

export function loadGangState(): GangState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GangState
    if (parsed.version !== 1) return null
    if (!Array.isArray(parsed.orders) || !parsed.master || !Array.isArray(parsed.locks)) return null
    return {
      version: 1,
      orders: parsed.orders,
      master: parsed.master,
      locks: parsed.locks,
      past: Array.isArray(parsed.past) ? parsed.past : [],
      future: Array.isArray(parsed.future) ? parsed.future : [],
      baseline: parsed.baseline ?? null,
    }
  } catch {
    return null
  }
}

export function saveGangState(state: GangState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存储失败（隐私模式/配额）不影响使用
  }
}

export function clearGangState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
