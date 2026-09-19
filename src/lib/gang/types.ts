/** 多订单合版（gang run）领域模型 */
import type { FlipMode } from '../../types'

/** 纸纹（丝缕）方向：相对成品【长边】，long=顺纹（纤维平行长边），short=横纹 */
export type Grain = 'long' | 'short'

/** 纸张品种（克重/涂料） */
export type PaperGrade =
  | 'coated-157'
  | 'coated-200'
  | 'uncoated-120'
  | 'uncoated-250'

/** 背面落位方式（决定正面矩形如何映射到背面） */
export type BackMode =
  | 'work-and-turn' // 自翻版·长边左右翻：背面横向镜像
  | 'work-and-tumble' // 自翻版·短边上下翻：背面纵向镜像
  | 'work-and-back' // 正反版：两套印版分别晒制，背面同位

/** 优化策略 */
export type PlanStrategy = 'min-overs' | 'min-plates'

export interface SizeMm {
  w: number
  h: number
}

/** 以正面左上角为原点、单位 mm 的轴对齐矩形（x 向右，y 向下） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 一个合版订单（一本小批量骑马钉画册） */
export interface GangOrder {
  id: string
  name: string
  /** 身份色（母版上按订单着色） */
  color: string
  /** 成品单页宽（书口方向，mm）；展开宽 = 2 * trimW */
  trimW: number
  /** 成品高（mm） */
  trimH: number
  /** 书帖数（骑马钉整帖；每帖 4 页 = 1 张对折纸） */
  signatures: number
  /** 印数（成品册数） */
  run: number
  paper: PaperGrade
  /** 纸纹方向，相对成品长边 */
  grain: Grain
  /** 允许超印上限（册） */
  allowOvers: number
  /** 交期（ISO 日期），仅用于排产排序与提示 */
  dueDate: string
  /** 是否允许在母版上旋转 90° */
  allowRotate: boolean
  /** 书帖是否已通过单书拼版验证；只有已验证订单可进入合版 */
  verified: boolean
}

/** 母版纸（上机大纸） */
export interface MasterSheet {
  id: string
  name: string
  widthMm: number
  heightMm: number
  grade: PaperGrade
  /** 母版纸纹方向（相对母版长边） */
  grain: Grain
}

export type GripEdge = 'top' | 'bottom' | 'left' | 'right'

/** 咬口（叼口）：母版某条边上不可印刷的条带 */
export interface GripZone {
  edge: GripEdge
  /** 从边向内的宽度 mm */
  widthMm: number
}

/** 自定义禁印区（正面坐标） */
export interface ForbiddenZone {
  id: string
  name: string
  rect: Rect
  /** 翻面后是否跟随镜像到背面（自翻版时物理区域会翻到对侧边） */
  mirrorToBack: boolean
}

export interface PressConfig {
  /** 背面落位方式 */
  mode: BackMode
  /** 书页内容翻面方向（沿用单书拼版几何） */
  flip: FlipMode
  grip: GripZone
}

/** 人工锁定：把某订单某一书帖在某套版上的摆放固定下来 */
export interface LockedCell {
  boardIndex: number
  orderId: string
  signature: number
  x: number
  y: number
  /** 是否旋转 90°（与该订单在该套版上的其余书帖保持一致） */
  rotated: boolean
}

/** 套版上一个已摆放的生产单元（= 正反绑定的一个书帖） */
export interface PlacedCell {
  /** 单元类型 id：`${orderId}#s${signature}` */
  unitId: string
  orderId: string
  orderName: string
  color: string
  signature: number
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
  locked: boolean
}

/** 一刀贯穿当前料块的直线刀路 */
export interface Cut {
  orient: 'v' | 'h'
  /** v 刀的 x / h 刀的 y */
  at: number
  /** 刀路起点（v 刀为 y 区间，h 刀为 x 区间） */
  from: number
  to: number
}

export interface BoardPlan {
  boardIndex: number
  /** 该套版上机印多少张（相同版面重复印次） */
  repeat: number
  cells: PlacedCell[]
  cuts: Cut[]
  usedArea: number
}

export type PlanIssueCode =
  | 'order-unverified'
  | 'paper-mismatch'
  | 'does-not-fit'
  | 'grain-impossible'
  | 'collision'
  | 'grip-overlap'
  | 'forbidden-overlap'
  | 'back-overlap'
  | 'not-guillotine'
  | 'quantity-short'
  | 'overs-exceeded'
  | 'lock-dropped'

export interface PlanIssue {
  level: 'error' | 'warning'
  code: PlanIssueCode
  message: string
  orderId?: string
  boardIndex?: number
}

export interface OrderStat {
  orderId: string
  run: number
  /** 计划实际产出册数 */
  copies: number
  overs: number
  met: boolean
  /** 该订单出现在哪些套版上 */
  boards: number[]
}

export interface PlanTotals {
  /** 总用纸数 = Σ 套版 repeat */
  sheets: number
  /** 套版（换版）数 */
  plates: number
  /** 总超印册数 */
  overs: number
  /** 废纸率 0..1（按印张面积加权） */
  wasteRate: number
  paperCost: number
  plateCost: number
  totalCost: number
}

export interface PlanResult {
  strategy: PlanStrategy
  boards: BoardPlan[]
  stats: OrderStat[]
  totals: PlanTotals
  issues: PlanIssue[]
  feasible: boolean
  /** 确定性标记：同一输入必须产出同一结果 */
  generatedAt: number
}
