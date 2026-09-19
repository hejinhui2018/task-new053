/**
 * 多订单合版（gang run）核心算法
 *
 * 印厂把几本小批量骑马钉画册合在同一张母版纸上正反面印刷。
 * 每个【已验证书帖】是一个正反绑定的生产单元：正面摆在 (x,y)，
 * 背面位置由翻面方式（长边翻转 / 短边翻转）镜像确定，因此只摆一面，
 * 另一面自动确定。
 *
 * 排布必须同时满足：
 *  1. 无重叠：正面集合、背面集合分别做矩形碰撞检测；
 *  2. 纸纹一致：同纹向订单才共版（allowRotation 时可把少数派旋转 90°）；
 *  3. 咬口（gripper，进纸夹持边）与禁印区（dead zones）内不得摆放，
 *     背面视角下这些物理区域也要随翻面镜像；
 *  4. 数量倍数：同一合版组共享印次 runLength（= 最大需求按印刷步进取整），
 *     小订单因此产生超印，但分组时受各自 maxOvershoot 约束；
 *  5. guillotine 可分离：所有产品必须能用贯穿直线刀路逐刀切出，
 *     不允许 pinwheel 式不可分离嵌套换取虚假高利用率。
 *
 * 优化器是确定性的 guillotine 自由矩形装箱：相同输入永远得到相同计划；
 * 锁定的人工放置作为固定障碍，其余单元绕开它们重新排布。
 */

// ---------------------------------------------------------------------------
// 领域模型
// ---------------------------------------------------------------------------

/** 纸纹方向（相对母版进纸方向） */
export type Grain = 'parallel' | 'perpendicular'

/** 翻面方式：沿长边左右翻 / 沿短边上下翻（背面镜像轴不同） */
export type PressFlip = 'long-edge' | 'short-edge'

/** 印刷方式：双面印刷 / 单面印刷（单面时背面即正面，不镜像） */
export type PressMode = 'perfector' | 'single'

/** 咬口所在边（进纸夹持边，该条带不可印） */
export type GripperEdge = 'top' | 'bottom' | 'left' | 'right'

/** 订单状态：只有已验证（稿件/页码校验通过）的订单才能进入合版 */
export type OrderStatus = 'verified' | 'draft'

export interface Order {
  id: string
  name: string
  color: string
  /** 成品尺寸（宽 × 高，毫米）；书帖展开宽 = 2 × widthMm */
  widthMm: number
  heightMm: number
  /** 书帖数量（骑马钉册的印张数） */
  signatures: number
  /** 印数（册） */
  quantity: number
  paper: string
  grain: Grain
  /** 允许超印上限（册）；合版共享印次多出的部分不能超过它 */
  maxOvershoot: number
  /** 交期（ISO 日期字符串，用于排产标识） */
  dueDate: string
  status: OrderStatus
}

/** 母版纸上的矩形禁印区（机损、光斑、预留标位等），坐标按正面视角 */
export interface DeadZone {
  id: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

export interface MasterSheet {
  name: string
  widthMm: number
  heightMm: number
  gripperEdge: GripperEdge
  /** 咬口宽度（毫米） */
  gripperMm: number
  deadZones: DeadZone[]
  pressMode: PressMode
  flip: PressFlip
  /** 是否允许旋转 90°（旋转会改变相对纸纹，默认否） */
  allowRotation: boolean
  /** 印数步进（册）：组内共享印次向上取整到该倍数 */
  runStep: number
}

/**
 * 生产单元：一本订单的一个书帖 = 正反绑定的一对矩形。
 * sigIndex 0 = 最外层书帖。copies = 该订单的需求册数。
 */
export interface ProductionUnit {
  id: string
  orderId: string
  sigIndex: number
  /** 书帖展开尺寸（2×成品宽 × 成品高） */
  widthMm: number
  heightMm: number
  grain: Grain
  copies: number
}

export interface UnitRect {
  unitId: string
  orderId: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** 版面摆放旋转（0/90/180/270）；180 不改纹向，90/270 改变 */
  rotation: 0 | 90 | 180 | 270
  /** 是否为人工锁定 */
  locked?: boolean
}

/** 一条贯穿式裁切刀路（guillotine cut） */
export interface Cut {
  /** 水平刀：沿 x 方向贯穿、y 固定；垂直刀反之 */
  orientation: 'h' | 'v'
  posMm: number
}

export interface PlacedUnits {
  front: UnitRect[]
  back: UnitRect[]
}

export interface OrderFulfillment {
  orderId: string
  needed: number
  copies: number
  overshoot: number
  shortage: number
}

export interface PressLayout {
  /** 组内第几套母版（一套 = 正反面一对印版） */
  index: number
  paper: string
  grain: Grain
  placed: PlacedUnits
  cuts: Cut[]
  /** 该套排布要印的母版张数（共享印次） */
  runLength: number
}

export interface PlanMetrics {
  /** 母版套数（不同排布的印版套数 = 换版次数） */
  sheetCount: number
  /** 实际耗用母版纸总张数 */
  totalSheets: number
  usedArea: number
  masterArea: number
  /** 废纸率 0..1（咬口/禁印区/空白都计入废纸） */
  wasteRate: number
  totalOvershoot: number
}

export interface GangPlan {
  layouts: PressLayout[]
  fulfillment: OrderFulfillment[]
  metrics: PlanMetrics
  /** 所有套都摆不下的单元（印数不足） */
  unplaced: ProductionUnit[]
  warnings: string[]
}

export interface LockedPlacement {
  unitId: string
  xMm: number
  yMm: number
  rotation: 0 | 90 | 180 | 270
}

export interface PlanOptions {
  /** 每个合版组最多使用的母版套数，默认 8 */
  maxSheetsPerGroup?: number
  /** 人工锁定的正面摆放，优化器绕开（只作用于首套排布） */
  locks?: LockedPlacement[]
}

export interface CostWeights {
  /** 每张母版纸成本（元） */
  perSheet: number
  /** 每册超印的纸张+印工成本（元） */
  perOvershoot: number
  /** 每套印版的换版/校机成本（元） */
  perPlateChange: number
}

export interface PlanCost {
  paperCost: number
  overshootCost: number
  plateChangeCost: number
  total: number
}

// ---------------------------------------------------------------------------
// 几何基础
// ---------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const EPS = 1e-6

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
  )
}

export function rectArea(r: Rect): number {
  return r.w * r.h
}

/** 旋转 90°/270° 时占用宽高互换 */
export function occupiedSize(width: number, height: number, rotation: number): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: height, h: width } : { w: width, h: height }
}

// ---------------------------------------------------------------------------
// 正反镜像（双面映射）
// ---------------------------------------------------------------------------

const flipRot: Record<PressFlip, Record<0 | 90 | 180 | 270, 0 | 90 | 180 | 270>> = {
  // 任一轴镜像：0↔180、90↔270
  'long-edge': { 0: 180, 90: 270, 180: 0, 270: 90 },
  'short-edge': { 0: 180, 90: 270, 180: 0, 270: 90 },
}

/** 点/矩形在正面↔背面视角间镜像（自反） */
function mirrorX(x: number, master: MasterSheet): number {
  return master.widthMm - x
}
function mirrorY(y: number, master: MasterSheet): number {
  return master.heightMm - y
}

/**
 * 正面矩形 → 背面矩形（直视背面视角）。
 * - 长边翻转：绕竖直轴左右翻，x 镜像（x' = W - x - w）；
 * - 短边翻转：绕水平轴上下翻，y 镜像。
 * 单面印刷直接原样返回。
 */
export function mirrorToBack(r: UnitRect, master: MasterSheet): UnitRect {
  if (master.pressMode === 'single') return { ...r }
  const rotation = flipRot[master.flip][r.rotation]
  if (master.flip === 'long-edge') {
    return { ...r, xMm: mirrorX(r.xMm + r.widthMm, master), rotation }
  }
  return { ...r, yMm: mirrorY(r.yMm + r.heightMm, master), rotation }
}

/** 背面 → 正面（镜像自反性，测试用） */
export function mirrorToFront(r: UnitRect, master: MasterSheet): UnitRect {
  return mirrorToBack(r, master)
}

/** 一个正面视角矩形在指定面的几何（背面要镜像） */
export function rectOnSide(r: Rect, side: 'front' | 'back', master: MasterSheet): Rect {
  if (side === 'front' || master.pressMode === 'single') return { ...r }
  const fake: UnitRect = {
    unitId: '', orderId: '', xMm: r.x, yMm: r.y, widthMm: r.w, heightMm: r.h, rotation: 0,
  }
  const m = mirrorToBack(fake, master)
  return { x: m.xMm, y: m.yMm, w: m.widthMm, h: m.heightMm }
}

// ---------------------------------------------------------------------------
// 咬口 / 禁印区
// ---------------------------------------------------------------------------

export function gripperRect(master: MasterSheet): Rect {
  const g = master.gripperMm
  switch (master.gripperEdge) {
    case 'top':
      return { x: 0, y: 0, w: master.widthMm, h: g }
    case 'bottom':
      return { x: 0, y: master.heightMm - g, w: master.widthMm, h: g }
    case 'left':
      return { x: 0, y: 0, w: g, h: master.heightMm }
    case 'right':
      return { x: master.widthMm - g, y: 0, w: g, h: master.heightMm }
  }
}

/** 扣除咬口后的正面可印区 */
export function printableRect(master: MasterSheet): Rect {
  const g = master.gripperMm
  switch (master.gripperEdge) {
    case 'top':
      return { x: 0, y: g, w: master.widthMm, h: master.heightMm - g }
    case 'bottom':
      return { x: 0, y: 0, w: master.widthMm, h: master.heightMm - g }
    case 'left':
      return { x: g, y: 0, w: master.widthMm - g, h: master.heightMm }
    case 'right':
      return { x: 0, y: 0, w: master.widthMm - g, h: master.heightMm }
  }
}

function deadRects(master: MasterSheet): Rect[] {
  return master.deadZones.map((d) => ({ x: d.xMm, y: d.yMm, w: d.widthMm, h: d.heightMm }))
}

/** 某一面（视角）下的全部不可用矩形：咬口 + 该面视角的禁印区 */
export function forbiddenRects(master: MasterSheet, side: 'front' | 'back'): Rect[] {
  const gripper = rectOnSide(gripperRect(master), side, master)
  const dead = deadRects(master).map((d) => rectOnSide(d, side, master))
  return [gripper, ...dead]
}

/** 矩形在指定面是否：不出界、不侵咬口/禁印区 */
export function rectFitsSide(r: Rect, master: MasterSheet, side: 'front' | 'back'): boolean {
  const area: Rect = { x: 0, y: 0, w: master.widthMm, h: master.heightMm }
  if (!rectContains(area, r)) return false
  return !forbiddenRects(master, side).some((f) => rectsOverlap(r, f))
}

// ---------------------------------------------------------------------------
// 纸纹 / 旋转
// ---------------------------------------------------------------------------

/** 摆放后的实际纹向：90°/270° 把纹向转 90°，0°/180° 不变 */
export function effectiveGrain(grain: Grain, rotation: number): Grain {
  if (rotation === 90 || rotation === 270) {
    return grain === 'parallel' ? 'perpendicular' : 'parallel'
  }
  return grain
}

/** 单元以指定旋转摆入主纹向为 dominantGrain 的组是否合法 */
export function rotationAllowed(
  unit: ProductionUnit,
  rotation: 0 | 90 | 180 | 270,
  master: MasterSheet,
  dominantGrain: Grain,
): boolean {
  if (rotation !== 0 && rotation !== 180 && !master.allowRotation) return false
  return effectiveGrain(unit.grain, rotation) === dominantGrain
}

// ---------------------------------------------------------------------------
// 生产单元展开与合版分组（数量倍数 / 超印）
// ---------------------------------------------------------------------------

export function unitId(orderId: string, sigIndex: number): string {
  return `${orderId}#s${sigIndex}`
}

/** 已验证订单 → 书帖生产单元（展开宽 = 2 × 成品宽） */
export function expandUnits(orders: Order[]): ProductionUnit[] {
  const units: ProductionUnit[] = []
  for (const o of orders) {
    if (o.status !== 'verified') continue
    const sigs = Math.max(1, o.signatures)
    for (let s = 0; s < sigs; s += 1) {
      units.push({
        id: unitId(o.id, s),
        orderId: o.id,
        sigIndex: s,
        widthMm: o.widthMm * 2,
        heightMm: o.heightMm,
        grain: o.grain,
        copies: o.quantity,
      })
    }
  }
  return units
}

export function indexUnits(orders: Order[]): Map<string, ProductionUnit> {
  const map = new Map<string, ProductionUnit>()
  for (const u of expandUnits(orders)) map.set(u.id, u)
  return map
}

interface GangGroup {
  paper: string
  grain: Grain
  orders: Order[]
  /** 组内共享印次（最大需求按步进取整） */
  runLength: number
}

function roundUpStep(n: number, step: number): number {
  if (step <= 1) return n
  return Math.ceil(n / step) * step
}

/**
 * 合版分组：
 *  - 不同纸张绝不共版；
 *  - 不同纸纹不共版（纹向不一致会导致折页/装订问题）；
 *  - 同纸同纹订单按印数降序贪心成组：大订单带小订单合版，小订单得到
 *    runLength - quantity 册超印，但必须 ≤ 其 maxOvershoot；放不下就另开一组。
 * 组共享一套印次 → 这正是"数量倍数"与"允许超印"的生产含义。
 */
export function buildGroups(orders: Order[], master: MasterSheet): GangGroup[] {
  const verified = orders.filter((o) => o.status === 'verified' && o.signatures > 0)
  // 允许旋转 90° 时，异纸纹订单可旋转后并入同纸组（纹向在装箱时校正）；
  // 否则纸纹不同必须分版。
  const buckets = new Map<string, Order[]>()
  for (const o of verified) {
    const key = master.allowRotation ? o.paper : `${o.paper}|${o.grain}`
    const arr = buckets.get(key) ?? []
    arr.push(o)
    buckets.set(key, arr)
  }

  const groups: GangGroup[] = []
  for (const [key, bucket] of buckets) {
    // 该组主纹向 = 多数派（并列时 parallel 优先，保持确定性）
    const par = bucket.filter((o) => o.grain === 'parallel').length
    const grain: Grain = par >= bucket.length - par ? 'parallel' : 'perpendicular'
    const paper = master.allowRotation ? key : key.split('|')[0]
    const sorted = [...bucket].sort((a, b) => b.quantity - a.quantity || (a.id < b.id ? -1 : 1))
    const clusters: Order[][] = []
    for (const o of sorted) {
      let placed = false
      // 确定性：按组内最大需求降序（已建立顺序）尝试加入
      for (const cluster of clusters) {
        const runLength = roundUpStep(cluster[0].quantity, master.runStep)
        if (runLength - o.quantity <= o.maxOvershoot) {
          cluster.push(o)
          placed = true
          break
        }
      }
      if (!placed) clusters.push([o])
    }
    for (const cluster of clusters) {
      groups.push({
        paper,
        grain,
        orders: cluster.sort((a, b) => a.id.localeCompare(b.id)),
        runLength: roundUpStep(cluster[0].quantity, master.runStep),
      })
    }
  }
  groups.sort((a, b) => a.paper.localeCompare(b.paper) || a.grain.localeCompare(b.grain))
  return groups
}

// ---------------------------------------------------------------------------
// guillotine 裁切可分离性
// ---------------------------------------------------------------------------

/**
 * 构造式判定：一组轴对齐矩形能否用贯穿式直刀（guillotine）完全切分。
 * 递归找一条把集合分成两个非空子集的贯穿刀路。pinwheel（风车）式嵌套
 * 不存在这样的刀路 → 返回 null。返回值是可顺序执行的刀路序列。
 */
export function guillotineCuts(rects: Rect[]): Cut[] | null {
  if (rects.length === 0) return []
  if (rects.length === 1) return []

  const cuts: Cut[] = []
  const solve = (group: Rect[]): boolean => {
    if (group.length <= 1) return true

    const xEdges = [...new Set(group.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b)
    for (const x of xEdges) {
      const left = group.filter((r) => r.x + r.w <= x + EPS)
      const right = group.filter((r) => r.x >= x - EPS)
      if (left.length + right.length === group.length && left.length > 0 && right.length > 0) {
        cuts.push({ orientation: 'v', posMm: x })
        return solve(left) && solve(right)
      }
    }
    const yEdges = [...new Set(group.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b)
    for (const y of yEdges) {
      const below = group.filter((r) => r.y + r.h <= y + EPS)
      const above = group.filter((r) => r.y >= y - EPS)
      if (below.length + above.length === group.length && below.length > 0 && above.length > 0) {
        cuts.push({ orientation: 'h', posMm: y })
        return solve(below) && solve(above)
      }
    }
    return false
  }

  return solve(rects) ? cuts : null
}

/**
 * 经典 pinwheel（风车）布局：四矩形围绕中心，任何贯穿刀都会切到某矩形，
 * 不可 guillotine 分离。用于测试与文档。
 */
export function pinwheelRects(size = 100): Rect[] {
  const s = size
  return [
    { x: 0, y: 0, w: s * 0.6, h: s * 0.4 },
    { x: s * 0.6, y: 0, w: s * 0.4, h: s * 0.6 },
    { x: s * 0.4, y: s * 0.6, w: s * 0.6, h: s * 0.4 },
    { x: 0, y: s * 0.4, w: s * 0.4, h: s * 0.6 },
    { x: s * 0.4, y: s * 0.4, w: s * 0.2, h: s * 0.2 },
  ]
}

// ---------------------------------------------------------------------------
// 确定性 guillotine 自由矩形装箱
// ---------------------------------------------------------------------------

/** 从 free 中挖去 blocker，返回最多 4 块余料（左/右整条 + 中上/中下） */
function subtractRect(free: Rect, b: Rect): Rect[] {
  if (!rectsOverlap(free, b)) return [free]
  const ix = Math.max(free.x, b.x)
  const iy = Math.max(free.y, b.y)
  const ix2 = Math.min(free.x + free.w, b.x + b.w)
  const iy2 = Math.min(free.y + free.h, b.y + b.h)
  const pieces: Rect[] = []
  // 左整条、右整条（guillotine 顺序：先两侧竖切）
  if (ix - free.x > EPS) pieces.push({ x: free.x, y: free.y, w: ix - free.x, h: free.h })
  if (free.x + free.w - ix2 > EPS) pieces.push({ x: ix2, y: free.y, w: free.x + free.w - ix2, h: free.h })
  // 中间带上、下两块
  if (iy - free.y > EPS) pieces.push({ x: ix, y: free.y, w: ix2 - ix, h: iy - free.y })
  if (free.y + free.h - iy2 > EPS) pieces.push({ x: ix, y: iy2, w: ix2 - ix, h: free.y + free.h - iy2 })
  return pieces.filter((p) => p.w > EPS && p.h > EPS)
}

function subtractAll(frees: Rect[], blocker: Rect): Rect[] {
  return frees.flatMap((f) => subtractRect(f, blocker))
}

interface Candidate {
  free: Rect
  rotation: 0 | 90 | 180 | 270
  w: number
  h: number
}

/** 在所有自由矩形中找确定性最佳落点（残留面积最小，再 y/x/rotation 决胜） */
function findBestCandidate(
  frees: Rect[],
  unit: ProductionUnit,
  master: MasterSheet,
  grain: Grain,
  isBlocked: (r: Rect) => boolean,
): Candidate | null {
  let best: (Candidate & { score: number }) | null = null
  const rotations: Array<0 | 90 | 180 | 270> = [0, 180, 90, 270]
  // 自由矩形按 (y,x,w,h) 排序，保证遍历顺序确定
  const ordered = [...frees].sort((a, b) => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h)
  for (const free of ordered) {
    for (const rotation of rotations) {
      if (!rotationAllowed(unit, rotation, master, grain)) continue
      const { w, h } = occupiedSize(unit.widthMm, unit.heightMm, rotation)
      if (w > free.w + EPS || h > free.h + EPS) continue
      const r: Rect = { x: free.x, y: free.y, w, h }
      if (isBlocked(r)) continue
      const score = (free.w * free.h - w * h) * 1e9 + free.y * 1e6 + free.x * 1e3 + rotation
      if (!best || score < best.score) best = { free, rotation, w, h, score }
    }
  }
  return best
}

/** 放入 (x,y,w,h) 后把所属自由矩形 guillotine 切成右余料 + 上余料 */
function consumeFree(frees: Rect[], chosen: Rect): Rect[] {
  const idx = frees.findIndex(
    (f) =>
      Math.abs(f.x - chosen.x) < EPS &&
      Math.abs(f.y - chosen.y) < EPS &&
      f.w >= chosen.w - EPS &&
      f.h >= chosen.h - EPS,
  )
  const node = idx >= 0 ? frees[idx] : (() => {
    // 兜底：找包含它的自由矩形
    const f = frees.find((f) => rectContains(f, chosen))
    return f ?? chosen
  })()
  const rest = frees.filter((f) => f !== node)
  const rightW = node.w - chosen.w
  const topH = node.h - chosen.h
  if (rightW > EPS) rest.push({ x: node.x + chosen.w, y: node.y, w: rightW, h: node.h })
  if (topH > EPS) rest.push({ x: node.x, y: node.y + chosen.h, w: chosen.w, h: topH })
  return rest
}

export interface PackResult {
  front: UnitRect[]
  unplaced: ProductionUnit[]
}

/**
 * 单套母版装箱。locks 为人工锁定正面位置（固定障碍）；其余单元绕开排布。
 * 自由矩形切分本身就是 guillotine 分解，因此结果天然可直线分离。
 */
export function packSheet(
  units: ProductionUnit[],
  master: MasterSheet,
  grain: Grain,
  locks: LockedPlacement[] = [],
): PackResult {
  let frees: Rect[] = [printableRect(master)]
  // 正面禁印区先挖掉
  for (const dz of deadRects(master)) frees = subtractAll(frees, dz)

  const front: UnitRect[] = []
  const back: UnitRect[] = []

  const backBlocked = (r: Rect): boolean => {
    const fr: UnitRect = {
      unitId: '', orderId: '', xMm: r.x, yMm: r.y, widthMm: r.w, heightMm: r.h, rotation: 0,
    }
    const mb = mirrorToBack(fr, master)
    const br: Rect = { x: mb.xMm, y: mb.yMm, w: mb.widthMm, h: mb.heightMm }
    if (!rectFitsSide(br, master, 'back')) return true
    return back.some((b) => rectsOverlap(br, { x: b.xMm, y: b.yMm, w: b.widthMm, h: b.heightMm }))
  }

  // ---- 先放锁定 ----
  const lockedUnits: ProductionUnit[] = []
  for (const lock of locks) {
    const unit = units.find((u) => u.id === lock.unitId)
    if (!unit) continue
    if (!rotationAllowed(unit, lock.rotation, master, grain)) continue
    const { w, h } = occupiedSize(unit.widthMm, unit.heightMm, lock.rotation)
    const r: Rect = { x: lock.xMm, y: lock.yMm, w, h }
    if (!rectFitsSide(r, master, 'front')) continue
    // 正面不能与已锁定/禁印区重叠（自由空间已含禁印区）
    if (frees.every((f) => !rectContains(f, r))) continue
    const ur: UnitRect = {
      unitId: unit.id, orderId: unit.orderId, xMm: r.x, yMm: r.y, widthMm: w, heightMm: h,
      rotation: lock.rotation, locked: true,
    }
    const mb = mirrorToBack(ur, master)
    const br: Rect = { x: mb.xMm, y: mb.yMm, w: mb.widthMm, h: mb.heightMm }
    if (!rectFitsSide(br, master, 'back')) continue
    if (back.some((b) => rectsOverlap(br, { x: b.xMm, y: b.yMm, w: b.widthMm, h: b.heightMm }))) continue

    frees = subtractAll(frees, r)
    front.push(ur)
    back.push(mb)
    lockedUnits.push(unit)
  }

  // ---- 再确定性排布其余单元（面积降序，id 决胜） ----
  const lockedIds = new Set(lockedUnits.map((u) => u.id))
  const pending = units
    .filter((u) => !lockedIds.has(u.id))
    .sort((a, b) => {
      const aa = a.widthMm * a.heightMm
      const bb = b.widthMm * b.heightMm
      return bb - aa || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    })

  const unplaced: ProductionUnit[] = []
  for (const unit of pending) {
    // isBlocked 只做背面冲突检测；正面自由空间已保证不撞
    const cand = findBestCandidate(frees, unit, master, grain, backBlocked)
    if (!cand) {
      unplaced.push(unit)
      continue
    }
    const chosen: Rect = { x: cand.free.x, y: cand.free.y, w: cand.w, h: cand.h }
    const ur: UnitRect = {
      unitId: unit.id, orderId: unit.orderId, xMm: chosen.x, yMm: chosen.y,
      widthMm: chosen.w, heightMm: chosen.h, rotation: cand.rotation,
    }
    frees = consumeFree(frees, chosen)
    front.push(ur)
    back.push(mirrorToBack(ur, master))
  }

  return { front, unplaced }
}

// ---------------------------------------------------------------------------
// 计划生成
// ---------------------------------------------------------------------------

export interface GangInput {
  orders: Order[]
  master: MasterSheet
  options?: PlanOptions
}

/** 生成多组、多套母版的完整合版计划 */
export function planGangRun(input: GangInput): GangPlan {
  const { orders, master } = input
  const maxSheets = input.options?.maxSheetsPerGroup ?? 8
  const locks = input.options?.locks ?? []
  const warnings: string[] = []

  const groups = buildGroups(orders, master)
  const layouts: PressLayout[] = []
  const unplacedAll: ProductionUnit[] = []
  // orderId -> 已摆入的书帖数 / 总书帖数
  const placedSig = new Map<string, { placed: number; total: number; runLength: number }>()

  for (const group of groups) {
    const units = expandUnits(group.orders)
    for (const o of group.orders) {
      placedSig.set(o.id, {
        placed: 0,
        total: units.filter((u) => u.orderId === o.id).length,
        runLength: group.runLength,
      })
    }

    let remaining = units
    let safety = 0
    let firstLayout = true
    while (remaining.length > 0 && safety < maxSheets) {
      safety += 1
      const activeLocks = firstLayout ? locks : []
      const { front, unplaced } = packSheet(remaining, master, group.grain, activeLocks)
      if (front.length === 0) {
        unplacedAll.push(...unplaced)
        break
      }
      const back = front.map((r) => mirrorToBack(r, master))
      const rects = front.map((r) => ({ x: r.xMm, y: r.yMm, w: r.widthMm, h: r.heightMm }))
      const cuts = guillotineCuts(rects)
      if (cuts === null) {
        // 理论不可达（装箱即 guillotine 分解），保守起见整组判失败
        warnings.push('检测到不可直线分离的排布，已中止该组（请调整锁定位置）')
        unplacedAll.push(...remaining)
        break
      }
      layouts.push({
        index: layouts.length,
        paper: group.paper,
        grain: group.grain,
        placed: { front, back },
        cuts,
        runLength: group.runLength,
      })
      for (const f of front) {
        const cur = placedSig.get(f.orderId)
        if (cur) cur.placed += 1
      }
      remaining = unplaced
      firstLayout = false
    }
    if (remaining.length > 0) unplacedAll.push(...remaining)
  }

  // ---- 印数满足 / 超印 ----
  const fulfillment: OrderFulfillment[] = []
  let totalOvershoot = 0
  for (const o of orders.filter((x) => x.status === 'verified')) {
    const stat = placedSig.get(o.id)
    const complete = stat && stat.placed >= stat.total
    const copies = complete ? stat.runLength : 0
    const overshoot = Math.max(0, copies - o.quantity)
    const shortage = Math.max(0, o.quantity - copies)
    if (complete && overshoot > o.maxOvershoot) {
      warnings.push(`《${o.name}》超印 ${overshoot} 册，超过允许上限 ${o.maxOvershoot} 册`)
    }
    if (shortage > 0) warnings.push(`《${o.name}》印数不足，尚缺 ${shortage} 册（母版摆不下全部书帖）`)
    totalOvershoot += overshoot
    fulfillment.push({ orderId: o.id, needed: o.quantity, copies, overshoot, shortage })
  }
  fulfillment.sort((a, b) => a.orderId.localeCompare(b.orderId))

  // ---- 指标（废纸率按实际印张加权） ----
  const masterArea = master.widthMm * master.heightMm
  const totalSheets = layouts.reduce((s, l) => s + l.runLength, 0)
  const usedArea = layouts.reduce(
    (s, l) => s + l.placed.front.reduce((a, r) => a + r.widthMm * r.heightMm, 0) * l.runLength,
    0,
  )
  const wasteRate = masterArea === 0 || totalSheets === 0 ? 0 : 1 - usedArea / (masterArea * totalSheets)

  const draftCount = orders.filter((o) => o.status === 'draft').length
  if (draftCount > 0) warnings.push(`${draftCount} 个订单尚未验证，未纳入合版`)

  return {
    layouts,
    fulfillment,
    metrics: {
      sheetCount: layouts.length,
      totalSheets,
      usedArea,
      masterArea,
      wasteRate,
      totalOvershoot,
    },
    unplaced: unplacedAll,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// 成本与计划比较
// ---------------------------------------------------------------------------

export const DEFAULT_COST_WEIGHTS: CostWeights = {
  perSheet: 3.5,
  perOvershoot: 0.8,
  perPlateChange: 120,
}

export function planCost(plan: GangPlan, w: CostWeights = DEFAULT_COST_WEIGHTS): PlanCost {
  const paperCost = plan.metrics.totalSheets * w.perSheet
  const overshootCost = plan.metrics.totalOvershoot * w.perOvershoot
  const plateChangeCost = plan.metrics.sheetCount * w.perPlateChange
  return { paperCost, overshootCost, plateChangeCost, total: paperCost + overshootCost + plateChangeCost }
}

export interface PlanComparison {
  a: { sheetRuns: number; totalSheets: number; overshoot: number; plateChanges: number; cost: PlanCost }
  b: { sheetRuns: number; totalSheets: number; overshoot: number; plateChanges: number; cost: PlanCost }
  delta: { sheets: number; overshoot: number; plateChanges: number; total: number }
  cheaper: 'a' | 'b' | 'tie'
}

export function comparePlans(
  a: GangPlan,
  b: GangPlan,
  w: CostWeights = DEFAULT_COST_WEIGHTS,
): PlanComparison {
  const ca = planCost(a, w)
  const cb = planCost(b, w)
  const stat = (p: GangPlan, c: PlanCost) => ({
    sheetRuns: p.metrics.sheetCount,
    totalSheets: p.metrics.totalSheets,
    overshoot: p.metrics.totalOvershoot,
    plateChanges: p.metrics.sheetCount,
    cost: c,
  })
  return {
    a: stat(a, ca),
    b: stat(b, cb),
    delta: {
      sheets: b.metrics.totalSheets - a.metrics.totalSheets,
      overshoot: b.metrics.totalOvershoot - a.metrics.totalOvershoot,
      plateChanges: b.metrics.sheetCount - a.metrics.sheetCount,
      total: cb.total - ca.total,
    },
    cheaper: cb.total > ca.total + EPS ? 'a' : ca.total > cb.total + EPS ? 'b' : 'tie',
  }
}

// ---------------------------------------------------------------------------
// 成品计划独立校验（碰撞 / 双面镜像 / 咬口禁印 / 可分离）
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

export function validatePlan(plan: GangPlan, master: MasterSheet): ValidationResult {
  const errors: string[] = []

  for (const layout of plan.layouts) {
    const { front, back } = layout.placed

    // 1. 背面必须严格等于正面镜像
    if (back.length !== front.length) {
      errors.push(`第 ${layout.index + 1} 套正反面单元数不一致（正 ${front.length} / 背 ${back.length}）`)
    }
    for (const f of front) {
      const mb = mirrorToBack(f, master)
      const found = back.find((x) => x.unitId === f.unitId)
      if (!found) {
        errors.push(`单元 ${f.unitId} 缺少背面镜像`)
        continue
      }
      const close = (a: number, b: number) => Math.abs(a - b) <= EPS
      if (
        !close(found.xMm, mb.xMm) || !close(found.yMm, mb.yMm) ||
        !close(found.widthMm, mb.widthMm) || !close(found.heightMm, mb.heightMm) ||
        found.rotation !== mb.rotation
      ) {
        errors.push(`单元 ${f.unitId} 背面镜像位置/朝向不一致（背面套不准风险）`)
      }
    }

    // 2. 两面各自碰撞 + 边界/咬口/禁印
    const checkSide = (rects: UnitRect[], sideName: 'front' | 'back') => {
      for (let i = 0; i < rects.length; i += 1) {
        const ri: Rect = { x: rects[i].xMm, y: rects[i].yMm, w: rects[i].widthMm, h: rects[i].heightMm }
        if (!rectFitsSide(ri, master, sideName)) {
          errors.push(`${sideName === 'front' ? '正面' : '背面'}单元 ${rects[i].unitId} 越界或侵入咬口/禁印区`)
        }
        for (let j = i + 1; j < rects.length; j += 1) {
          const rj: Rect = { x: rects[j].xMm, y: rects[j].yMm, w: rects[j].widthMm, h: rects[j].heightMm }
          if (rectsOverlap(ri, rj)) errors.push(`${sideName === 'front' ? '正面' : '背面'}单元 ${rects[i].unitId} 与 ${rects[j].unitId} 重叠`)
        }
      }
    }
    checkSide(front, 'front')
    checkSide(back, 'back')

    // 3. guillotine 可分离
    const rects = front.map((r) => ({ x: r.xMm, y: r.yMm, w: r.widthMm, h: r.heightMm }))
    if (guillotineCuts(rects) === null) {
      errors.push(`第 ${layout.index + 1} 套无法用贯穿直线刀路分离（pinwheel 嵌套）`)
    }
  }

  return { ok: errors.length === 0, errors }
}
