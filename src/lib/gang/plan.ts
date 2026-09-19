/**
 * 多订单合版计划引擎。
 *
 * 生产单元：每个【已验证】订单的每个书帖 = 一个正反绑定单元
 * （正面印什么、背面经翻面镜像后必须落在同一张纸的对应位置）。
 *
 * 计划生成是【确定性】的：不使用随机数或无序迭代，单元优先级、
 * 朝向、候选坐标、开版顺序全部固定——同一输入（含锁定）永远得到
 * 同一计划，测试与撤销/基线对比都依赖这一点。
 *
 * 候选摆放必须同时通过：
 *  1. 正面：不越界、不撞咬口/禁印区、不与其他单元重叠；
 *  2. 背面：镜像位置同样不越界、不撞背面咬口/禁印区、不重叠；
 *  3. 纸纹：成品长边与母版纤维方向匹配（由 grain 决定是否旋转）；
 *  4. 裁切：当前版面始终保持 guillotine 可分离（不接受嵌套换利用率）。
 *
 * 印数倍数：逐版封版时，该版印次 = 版上各订单（run + allowOvers −
 * 已排册数）的最小值；同一书帖可跨版分摊印数（120 + 180 = 300），
 * 订单册数按其各书帖所得印次的最小值配套，缺帖或过量都如实计入。
 */
import type {
  BackMode,
  BoardPlan,
  ForbiddenZone,
  GangOrder,
  LockedCell,
  MasterSheet,
  PlacedCell,
  PlanIssue,
  PlanResult,
  PlanStrategy,
  PlanTotals,
  PressConfig,
  Rect,
} from './types'
import {
  area,
  contains,
  gripRect,
  gripRectBack,
  intersects,
  mirrorToBack,
  overlapArea,
  rect as makeRect,
  requiredRotation,
  signatureSize,
} from './geometry'
import { guillotineSeparate, type Item } from './cutting'
import { enumeratePlacements } from './pack'
import { PLATE_COST, sheetPrice } from './catalog'

export interface PlanInput {
  orders: GangOrder[]
  master: MasterSheet
  press: PressConfig
  forbidden: ForbiddenZone[]
  locks: LockedCell[]
  strategy: PlanStrategy
}

interface Unit {
  unitId: string
  orderId: string
  signature: number
  w: number
  h: number
  rotated: boolean
}

/** 单元间留缝 mm（出血 + 刀路余量） */
export const CELL_GAP_MM = 3
/** 套版数安全上限（防止异常输入死循环） */
const MAX_BOARDS = 24

const FULL = (m: MasterSheet): Rect => makeRect(0, 0, m.widthMm, m.heightMm)

/** 主入口：生成完整合版计划 */
export function planGang(input: PlanInput): PlanResult {
  const { orders, master, press, forbidden, locks, strategy } = input
  const issues: PlanIssue[] = []
  const full = FULL(master)
  const orderById = new Map(orders.map((o) => [o.id, o]))

  // ---- 正面/背面禁印矩形（咬口 + 禁印区） ----
  const frontBlockers: Rect[] = [gripRect(master, press.grip)]
  const backBlockers: Rect[] = [gripRectBack(master, press.grip, press.mode)]
  for (const fz of forbidden) {
    frontBlockers.push(fz.rect)
    backBlockers.push(
      fz.mirrorToBack ? mirrorToBack(fz.rect, master, press.mode) : { ...fz.rect },
    )
  }

  // ---- 订单级校验，决定哪些订单可投产；展开书帖单元 ----
  const validUnitsByOrder = new Map<string, Unit[]>()
  for (const order of orders) {
    const reason = validateOrder(order, master)
    if (reason) {
      issues.push({
        level: 'error',
        code: reason.code,
        orderId: order.id,
        message: `《${order.name}》：${reason.message}`,
      })
      continue
    }
    const spread = signatureSize(order.trimW, order.trimH)
    const rotated = requiredRotation(order.grain, master.grain, order.trimW, order.trimH)!
    const dims = rotated ? { w: spread.h, h: spread.w } : { w: spread.w, h: spread.h }
    const units: Unit[] = Array.from({ length: order.signatures }, (_, s) => ({
      unitId: unitId(order.id, s),
      orderId: order.id,
      signature: s,
      w: dims.w,
      h: dims.h,
      rotated,
    }))
    validUnitsByOrder.set(order.id, units)
  }

  // ---- 预建锁定套版（boardIndex 即人工指定的套版序号） ----
  const maxLockedBoard = locks.reduce((m, l) => Math.max(m, l.boardIndex), -1)
  const boards: BoardPlan[] = Array.from(
    { length: Math.max(0, maxLockedBoard + 1) },
    (_, i) => ({ boardIndex: i, repeat: 0, cells: [], cuts: [], usedArea: 0 }),
  )

  for (const lock of locks) {
    const order = orderById.get(lock.orderId)
    const unit = validUnitsByOrder.get(lock.orderId)?.[lock.signature]
    if (!order || !unit) {
      issues.push({
        level: 'warning',
        code: 'lock-dropped',
        orderId: lock.orderId,
        boardIndex: lock.boardIndex,
        message: `锁定（${lock.orderId} 第 ${lock.signature + 1} 帖）引用的订单/书帖不存在或未验证，已丢弃`,
      })
      continue
    }
    if (lock.rotated !== unit.rotated) {
      issues.push({
        level: 'error',
        code: 'grain-impossible',
        orderId: order.id,
        boardIndex: lock.boardIndex,
        message: `《${order.name}》锁定位置的旋转方向与纸纹要求冲突，锁定被拒绝`,
      })
      continue
    }
    const board = boards[lock.boardIndex]
    const rect = makeRect(lock.x, lock.y, unit.w, unit.h)
    const backRect = mirrorToBack(rect, master, press.mode)
    let code: PlanIssue['code'] | null = null
    if (!contains(full, rect)) code = 'does-not-fit'
    else if (frontBlockers.some((b) => intersects(rect, b))) code = 'grip-overlap'
    else if (backBlockers.some((b) => intersects(backRect, b))) code = 'grip-overlap'
    else if (board.cells.some((c) => intersects(makeRect(c.x, c.y, c.w, c.h), rect))) code = 'collision'
    else if (
      board.cells.some((c) =>
        intersects(mirrorToBack(makeRect(c.x, c.y, c.w, c.h), master, press.mode), backRect),
      )
    )
      code = 'back-overlap'
    if (code) {
      issues.push({
        level: 'error',
        code,
        orderId: order.id,
        boardIndex: lock.boardIndex,
        message: `《${order.name}》锁定位置非法（${issueLabel(code)}），锁定被拒绝`,
      })
      continue
    }
    board.cells.push({
      unitId: unit.unitId,
      orderId: order.id,
      orderName: order.name,
      color: order.color,
      signature: lock.signature,
      x: lock.x,
      y: lock.y,
      w: unit.w,
      h: unit.h,
      rotated: unit.rotated,
      locked: true,
    })
  }

  // ---- 印数感知的确定性开版 ----
  // produced[orderId][sig] = 该书帖已封版印次之和
  const produced = new Map<string, number[]>()
  for (const [id, units] of validUnitsByOrder) {
    produced.set(id, new Array(units.length).fill(0))
  }
  const copiesSoFar = (oid: string): number =>
    Math.min(...(produced.get(oid) ?? [0]))

  let boardIndex = -1
  let safety = 0
  while (validOrders(orders, validUnitsByOrder).some((o) => copiesSoFar(o.id) < o.run)) {
    safety += 1
    if (safety > MAX_BOARDS + 1) {
      issues.push({ level: 'error', code: 'does-not-fit', message: '超过套版上限仍未满足全部印数' })
      break
    }
    boardIndex += 1
    if (boardIndex >= boards.length) {
      boards.push({ boardIndex, repeat: 0, cells: [], cuts: [], usedArea: 0 })
    }
    const board = boards[boardIndex]

    // 候选订单：尚未成套；候选帖：该帖印次还不足需求量。
    // 确定性优先级（交期/印数/id），不足的帖在后续版继续补齐。
    const candidates = priorityOrders(orders, validUnitsByOrder, strategy).filter(
      (o) => copiesSoFar(o.id) < o.run + o.allowOvers,
    )
    fillBoard(
      board,
      candidates,
      validUnitsByOrder,
      produced,
      master,
      press.mode,
      frontBlockers,
      backBlockers,
    )

    if (board.cells.length === 0) {
      // 一块空版说明剩余需求在当前母版上无论如何都排不下
      issues.push({
        level: 'error',
        code: 'does-not-fit',
        boardIndex: board.boardIndex,
        message: `第 ${board.boardIndex + 1} 套版无法放入任何尚缺书帖，存在订单印数无法完成`,
      })
      break
    }

    // 印次上限逐帖计算：
    // - 该版覆盖订单【全部】书帖：允许印到 run+allowOvers（超印合法）；
    // - 只覆盖【部分】书帖：最多印到 run（缺帖版印超的部分无法成套，纯浪费）。
    let repeat = Number.POSITIVE_INFINITY
    const sigsOnBoard = new Map<string, Set<number>>()
    for (const c of board.cells) {
      const set = sigsOnBoard.get(c.orderId) ?? new Set<number>()
      set.add(c.signature)
      sigsOnBoard.set(c.orderId, set)
    }
    for (const c of board.cells) {
      const o = orderById.get(c.orderId)!
      const fullSet = sigsOnBoard.get(c.orderId)!.size >= o.signatures
      const ceiling = fullSet ? o.run + o.allowOvers : o.run
      const cap = ceiling - produced.get(c.orderId)![c.signature]
      repeat = Math.min(repeat, cap)
    }
    board.repeat = Math.max(0, Math.floor(repeat))
    for (const c of board.cells) {
      produced.get(c.orderId)![c.signature] += board.repeat
    }
  }

  // ---- 版面几何总校验（碰撞/背面镜像/咬口） ----
  for (const board of boards) {
    // 带锁定单元但最终印次为 0 的版：该锁定未参与生产
    if (board.repeat === 0 && board.cells.some((c) => c.locked)) {
      issues.push({
        level: 'warning',
        code: 'lock-dropped',
        boardIndex: board.boardIndex,
        message: `第 ${board.boardIndex + 1} 套版上的人工锁定未参与印刷（对应印数已在其他套版满足），锁定被忽略`,
      })
    }
    verifyBoard(board, master, press.mode, frontBlockers, backBlockers, full, issues)
    const items: Item[] = board.cells.map((c) => ({
      id: c.unitId,
      group: c.orderId,
      rect: makeRect(c.x, c.y, c.w, c.h),
    }))
    if (board.cells.length > 0) {
      const sep = guillotineSeparate(items, full, 'item')
      if (!sep.separable) {
        issues.push({
          level: 'error',
          code: 'not-guillotine',
          boardIndex: board.boardIndex,
          message: `第 ${board.boardIndex + 1} 套版存在不可直线分离的嵌套排布，不能上机直刀裁切`,
        })
      }
      board.cuts = dedupeCuts(sep.cuts)
      board.usedArea = board.cells.reduce((s, c) => s + c.w * c.h, 0)
    }
  }

  // ---- 印数满足 / 超印统计 ----
  const stats = orders.map((o) => {
    const arr = produced.get(o.id)
    const copies = arr ? Math.min(...arr) : 0
    const memberBoards = boards
      .filter((b) => b.repeat > 0 && b.cells.some((c) => c.orderId === o.id))
      .map((b) => b.boardIndex)
    return {
      orderId: o.id,
      run: o.run,
      copies,
      overs: Math.max(0, copies - o.run),
      met: copies >= o.run,
      boards: memberBoards,
    }
  })
  for (const st of stats) {
    const o = orderById.get(st.orderId)!
    if (!validUnitsByOrder.has(o.id)) continue
    if (!st.met) {
      issues.push({
        level: 'error',
        code: 'quantity-short',
        orderId: o.id,
        message: `《${o.name}》印数不足：计划 ${st.copies} / 需求 ${o.run}`,
      })
    }
    if (st.overs > o.allowOvers) {
      issues.push({
        level: 'error',
        code: 'overs-exceeded',
        orderId: o.id,
        message: `《${o.name}》超印 ${st.overs} 册，超过允许上限 ${o.allowOvers} 册`,
      })
    }
  }

  const totals = buildTotals(boards, master, press.mode, stats)
  return {
    strategy,
    boards: boards.filter((b) => b.cells.length > 0 && b.repeat > 0),
    stats,
    totals,
    issues,
    feasible: !issues.some((i) => i.level === 'error'),
    generatedAt: 0,
  }
}

// ---------------------------------------------------------------------------

function validOrders(orders: GangOrder[], valid: Map<string, unknown>): GangOrder[] {
  return orders.filter((o) => valid.has(o.id))
}

/** 确定性订单优先级：默认交期 → 大印数 → id；换版策略下大印数优先 */
function priorityOrders(
  orders: GangOrder[],
  valid: Map<string, unknown>,
  strategy: PlanStrategy,
): GangOrder[] {
  return orders
    .filter((o) => valid.has(o.id))
    .slice()
    .sort((a, b) => {
      if (strategy === 'min-plates' && a.run !== b.run) return b.run - a.run
      return (
        a.dueDate.localeCompare(b.dueDate) ||
        b.run - a.run ||
        a.id.localeCompare(b.id)
      )
    })
}

interface OrderInvalid {
  code: PlanIssue['code']
  message: string
}

function validateOrder(o: GangOrder, master: MasterSheet): OrderInvalid | null {
  if (!o.verified) return { code: 'order-unverified', message: '书帖未通过拼版验证' }
  if (o.paper !== master.grade) {
    return { code: 'paper-mismatch', message: '纸张品种与母版纸不一致，不能同版印刷' }
  }
  if (o.trimW <= 0 || o.trimH <= 0 || o.signatures <= 0 || o.run <= 0) {
    return { code: 'does-not-fit', message: '成品尺寸、书帖数或印数非法' }
  }
  const needRotate = requiredRotation(o.grain, master.grain, o.trimW, o.trimH)
  if (needRotate === null) {
    return { code: 'grain-impossible', message: '纸纹方向在任何朝向下都无法与母版一致' }
  }
  if (needRotate && !o.allowRotate) {
    return { code: 'grain-impossible', message: '纸纹一致要求旋转 90°，但该订单禁止旋转' }
  }
  const spread = signatureSize(o.trimW, o.trimH)
  const w = needRotate ? spread.h : spread.w
  const h = needRotate ? spread.w : spread.h
  if (w > master.widthMm || h > master.heightMm) {
    return {
      code: 'does-not-fit',
      message: `展开书帖 ${w}×${h}mm 大于母版 ${master.widthMm}×${master.heightMm}mm`,
    }
  }
  return null
}

/**
 * 往一块套版里放入候选订单的书帖（每个订单每帖至多一件）。
 * 已印够需求量的书帖不再重复上版；严格按订单优先级、帖号顺序尝试；
 * 每件放入后重新验证整版 guillotine 可分离——破坏直线可分离性的
 * 候选被跳过，绝不以嵌套换取利用率。
 */
function fillBoard(
  board: BoardPlan,
  candidates: GangOrder[],
  unitsByOrder: Map<string, Unit[]>,
  produced: Map<string, number[]>,
  master: MasterSheet,
  mode: BackMode,
  frontBlockers: Rect[],
  backBlockers: Rect[],
): void {
  const full = FULL(master)
  for (const order of candidates) {
    const units = unitsByOrder.get(order.id)!
    for (const unit of units) {
      // 同一书帖在同一套版上至多一件（锁定或本循环已放）；跨版加印合法
      if (board.cells.some((c) => c.unitId === unit.unitId)) continue
      // 该帖印次已满足需求（run；超出的超印只在成套版封版时自然产生）
      if ((produced.get(order.id)?.[unit.signature] ?? 0) >= order.run) continue
      const place = findPlacement(unit, board, master, mode, frontBlockers, backBlockers)
      if (!place) continue
      const cell: PlacedCell = {
        unitId: unit.unitId,
        orderId: order.id,
        orderName: order.name,
        color: order.color,
        signature: unit.signature,
        x: place.x,
        y: place.y,
        w: unit.w,
        h: unit.h,
        rotated: unit.rotated,
        locked: false,
      }
      const tentative = [...board.cells, cell]
      const items: Item[] = tentative.map((c) => ({
        id: c.unitId,
        group: c.orderId,
        rect: makeRect(c.x, c.y, c.w, c.h),
      }))
      if (!guillotineSeparate(items, full, 'item').separable) continue
      board.cells.push(cell)
    }
  }
}

/**
 * 为单元在当前版面上找一个合法落点：
 * 枚举全部底左候选点（y 优先），逐个校验正面留缝不撞障碍、
 * 背面镜像不越界/不撞背面障碍/不与已放单元的镜像重叠，取第一个通过者。
 */
function findPlacement(
  unit: Unit,
  board: BoardPlan,
  master: MasterSheet,
  mode: BackMode,
  frontBlockers: Rect[],
  backBlockers: Rect[],
): Rect | null {
  const full = FULL(master)
  const frontOccupied = [
    ...frontBlockers,
    ...board.cells.map((c) => inflate(makeRect(c.x, c.y, c.w, c.h), CELL_GAP_MM)),
  ]
  const candidates = enumeratePlacements(unit.w, unit.h, full, frontOccupied, 0)

  for (const cand of candidates) {
    const back = mirrorToBack(cand, master, mode)
    if (!contains(full, back)) continue
    if (backBlockers.some((b) => intersects(back, b))) continue
    let backClash = false
    for (const c of board.cells) {
      const existBack = mirrorToBack(makeRect(c.x, c.y, c.w, c.h), master, mode)
      if (intersects(inflate(existBack, CELL_GAP_MM), back)) {
        backClash = true
        break
      }
    }
    if (!backClash) return cand
  }
  return null
}

function inflate(r: Rect, g: number): Rect {
  return makeRect(r.x - g, r.y - g, r.w + g * 2, r.h + g * 2)
}

/** 封版后总校验：越界、正面碰撞、咬口/禁印区、背面镜像重叠 */
function verifyBoard(
  board: BoardPlan,
  master: MasterSheet,
  mode: BackMode,
  frontBlockers: Rect[],
  backBlockers: Rect[],
  full: Rect,
  issues: PlanIssue[],
): void {
  const rects = board.cells.map((c) => makeRect(c.x, c.y, c.w, c.h))
  for (let i = 0; i < rects.length; i += 1) {
    if (!contains(full, rects[i])) {
      pushIssue(issues, board, 'does-not-fit', i, '单元越出母版')
    }
    for (const b of frontBlockers) {
      if (intersects(rects[i], b)) pushIssue(issues, board, 'grip-overlap', i, '正面压入咬口/禁印区')
    }
    for (let j = i + 1; j < rects.length; j += 1) {
      if (overlapArea(rects[i], rects[j]) > 0) pushIssue(issues, board, 'collision', i, '正面单元重叠')
    }
    const backI = mirrorToBack(rects[i], master, mode)
    for (const b of backBlockers) {
      if (intersects(backI, b)) pushIssue(issues, board, 'back-overlap', i, '背面镜像压入咬口/禁印区')
    }
    for (let j = i + 1; j < rects.length; j += 1) {
      const backJ = mirrorToBack(rects[j], master, mode)
      if (overlapArea(backI, backJ) > 0) {
        pushIssue(issues, board, 'back-overlap', i, '背面镜像后重叠，翻面会串版')
      }
    }
  }
}

function pushIssue(
  issues: PlanIssue[],
  board: BoardPlan,
  code: PlanIssue['code'],
  i: number,
  detail: string,
): void {
  const cell = board.cells[i]
  issues.push({
    level: 'error',
    code,
    boardIndex: board.boardIndex,
    orderId: cell?.orderId,
    message: `第 ${board.boardIndex + 1} 套版：${cell?.orderName ?? ''} ${detail}`,
  })
}

function buildTotals(
  boards: BoardPlan[],
  master: MasterSheet,
  mode: BackMode,
  stats: PlanResult['stats'],
): PlanTotals {
  const printed = boards.filter((b) => b.cells.length > 0 && b.repeat > 0)
  const sheets = printed.reduce((s, b) => s + b.repeat, 0)
  const platesPerBoard = mode === 'work-and-back' ? 2 : 1
  const plates = printed.length * platesPerBoard
  const overs = stats.reduce((s, x) => s + x.overs, 0)
  const boardArea = area(FULL(master))
  const usedWeighted = printed.reduce((s, b) => s + b.usedArea * b.repeat, 0)
  const wasteRate = sheets === 0 ? 0 : 1 - usedWeighted / (boardArea * sheets)
  const paperCost = Math.round(sheets * sheetPrice(master) * 100) / 100
  const plateCost = plates * PLATE_COST
  return {
    sheets,
    plates,
    overs,
    wasteRate: Math.round(wasteRate * 10000) / 10000,
    paperCost,
    plateCost,
    totalCost: Math.round((paperCost + plateCost) * 100) / 100,
  }
}

function dedupeCuts(cuts: BoardPlan['cuts']): BoardPlan['cuts'] {
  const seen = new Set<string>()
  const out: BoardPlan['cuts'] = []
  for (const c of cuts) {
    const key = `${c.orient}:${Math.round(c.at * 100)}:${Math.round(c.from * 100)}:${Math.round(c.to * 100)}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(c)
    }
  }
  return out.sort((a, b) =>
    a.orient === b.orient ? a.at - b.at : a.orient === 'v' ? -1 : 1,
  )
}

function issueLabel(code: PlanIssue['code']): string {
  const map: Record<PlanIssue['code'], string> = {
    'order-unverified': '书帖未验证',
    'paper-mismatch': '纸张不一致',
    'does-not-fit': '越界或放不下',
    'grain-impossible': '纸纹冲突',
    collision: '正面碰撞',
    'grip-overlap': '咬口/禁印区',
    'forbidden-overlap': '禁印区',
    'back-overlap': '背面镜像冲突',
    'not-guillotine': '不可直线分离',
    'quantity-short': '印数不足',
    'overs-exceeded': '超印超限',
    'lock-dropped': '锁定丢弃',
  }
  return map[code]
}

export function unitId(orderId: string, signature: number): string {
  return `${orderId}#s${signature}`
}
