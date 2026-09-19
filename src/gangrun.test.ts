import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COST_WEIGHTS,
  buildGroups,
  comparePlans,
  effectiveGrain,
  expandUnits,
  forbiddenRects,
  gripperRect,
  guillotineCuts,
  mirrorToBack,
  mirrorToFront,
  occupiedSize,
  packSheet,
  pinwheelRects,
  planGangRun,
  planCost,
  printableRect,
  rectsOverlap,
  rotationAllowed,
  validatePlan,
  type MasterSheet,
  type Order,
  type ProductionUnit,
  type Rect,
  type UnitRect,
} from './lib/gangrun'

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

function master(over: Partial<MasterSheet> = {}): MasterSheet {
  return {
    name: '对开 440×320',
    widthMm: 440,
    heightMm: 320,
    gripperEdge: 'top',
    gripperMm: 10,
    deadZones: [],
    pressMode: 'perfector',
    flip: 'long-edge',
    allowRotation: false,
    runStep: 50,
    ...over,
  }
}

let counter = 0
function order(over: Partial<Order> & Pick<Order, 'widthMm' | 'heightMm'>): Order {
  counter += 1
  return {
    id: `o${counter}`,
    name: `订单${counter}`,
    color: '#888888',
    signatures: 1,
    quantity: 100,
    paper: '157g铜版',
    grain: 'parallel',
    maxOvershoot: 50,
    dueDate: '2026-10-01',
    status: 'verified',
    ...over,
  }
}

function unit(u: Partial<ProductionUnit> & Pick<ProductionUnit, 'id' | 'widthMm' | 'heightMm'>): ProductionUnit {
  return { orderId: 'o1', sigIndex: 0, grain: 'parallel', copies: 100, ...u }
}

// ---------------------------------------------------------------------------
// 1. 双面映射
// ---------------------------------------------------------------------------

describe('双面镜像 mirrorToBack', () => {
  const m = master()
  const rect = (x: number, y: number, w: number, h: number, rotation: UnitRect['rotation'] = 0): UnitRect => ({
    unitId: 'u1', orderId: 'o1', xMm: x, yMm: y, widthMm: w, heightMm: h, rotation,
  })

  it('长边翻转：x 镜像、y 不变', () => {
    const b = mirrorToBack(rect(0, 10, 420, 145), m)
    expect(b.xMm).toBe(20)
    expect(b.yMm).toBe(10)
  })

  it('短边翻转：y 镜像、x 不变', () => {
    const ms = master({ flip: 'short-edge' })
    const b = mirrorToBack(rect(10, 10, 200, 100), ms)
    expect(b.xMm).toBe(10)
    expect(b.yMm).toBe(210) // 320 - 10 - 100
  })

  it('镜像两次严格回到原位（正反绑定自反性）', () => {
    for (const flip of ['long-edge', 'short-edge'] as const) {
      const mm = master({ flip })
      const r = rect(13, 27, 180, 90, 180)
      const back2 = mirrorToFront(mirrorToBack(r, mm), mm)
      expect(back2).toEqual(r)
    }
  })

  it('镜像保持宽高（围绕中心，包围盒不变）', () => {
    const r = rect(5, 5, 100, 60)
    const b = mirrorToBack(r, m)
    expect(b.widthMm).toBe(100)
    expect(b.heightMm).toBe(60)
  })

  it('旋转朝向：0↔180、90↔270', () => {
    expect(mirrorToBack(rect(0, 0, 10, 10, 0), m).rotation).toBe(180)
    expect(mirrorToBack(rect(0, 0, 10, 10, 180), m).rotation).toBe(0)
    expect(mirrorToBack(rect(0, 0, 10, 10, 90), m).rotation).toBe(270)
    expect(mirrorToBack(rect(0, 0, 10, 10, 270), m).rotation).toBe(90)
  })

  it('单面印刷：背面即正面，不镜像', () => {
    const ms = master({ pressMode: 'single' })
    const r = rect(3, 7, 100, 60)
    expect(mirrorToBack(r, ms)).toEqual(r)
  })
})

// ---------------------------------------------------------------------------
// 2. 碰撞
// ---------------------------------------------------------------------------

describe('矩形碰撞 rectsOverlap', () => {
  it('相交返回 true', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true)
  })
  it('共边/共线（刀路贴合）不算重叠', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false)
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 5 })).toBe(false)
  })
  it('分离返回 false', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. 纸纹 / 咬口 / 禁印区
// ---------------------------------------------------------------------------

describe('纸纹与旋转', () => {
  const m = master()
  const u = unit({ id: 'u1', widthMm: 100, heightMm: 60, grain: 'parallel' })

  it('0°/180° 不改变纹向，90°/270° 翻转纹向', () => {
    expect(effectiveGrain('parallel', 0)).toBe('parallel')
    expect(effectiveGrain('parallel', 180)).toBe('parallel')
    expect(effectiveGrain('parallel', 90)).toBe('perpendicular')
    expect(effectiveGrain('perpendicular', 270)).toBe('parallel')
  })

  it('默认禁止 90° 旋转；同纹向 0° 允许', () => {
    expect(rotationAllowed(u, 0, m, 'parallel')).toBe(true)
    expect(rotationAllowed(u, 180, m, 'parallel')).toBe(true)
    expect(rotationAllowed(u, 90, m, 'parallel')).toBe(false)
  })

  it('纹向与主纹向冲突的 0° 摆放被拒', () => {
    expect(rotationAllowed(u, 0, m, 'perpendicular')).toBe(false)
  })

  it('允许旋转后，异纹向单元可旋转 90° 校正纹向', () => {
    const mr = master({ allowRotation: true })
    expect(rotationAllowed(u, 90, mr, 'perpendicular')).toBe(true)
  })

  it('90°/270° 占用宽高互换', () => {
    expect(occupiedSize(200, 100, 0)).toEqual({ w: 200, h: 100 })
    expect(occupiedSize(200, 100, 90)).toEqual({ w: 100, h: 200 })
    expect(occupiedSize(200, 100, 270)).toEqual({ w: 100, h: 200 })
  })
})

describe('咬口与可印区', () => {
  it('上咬口：可印区 y 下移咬口宽度', () => {
    const m = master({ gripperEdge: 'top', gripperMm: 12 })
    expect(gripperRect(m)).toEqual({ x: 0, y: 0, w: 440, h: 12 })
    expect(printableRect(m)).toEqual({ x: 0, y: 12, w: 440, h: 308 })
  })
  it.each(['bottom', 'left', 'right'] as const)('%s 咬口可印区正确扣除', (edge) => {
    const m = master({ gripperEdge: edge, gripperMm: 10 })
    const p = printableRect(m)
    const strip = edge === 'bottom' ? 440 : 320
    expect(p.w * p.h).toBe(440 * 320 - 10 * strip)
  })
  it('长边翻转时背面禁印区左右镜像：上咬口仍在上（y 不变）', () => {
    const m = master({ gripperEdge: 'top', gripperMm: 10 })
    const back = forbiddenRects(m, 'back')
    expect(back[0]).toEqual({ x: 0, y: 0, w: 440, h: 10 })
  })
  it('左咬口长边翻到背面后落在右边', () => {
    const m = master({ gripperEdge: 'left', gripperMm: 10 })
    const back = forbiddenRects(m, 'back')
    expect(back[0]).toEqual({ x: 430, y: 0, w: 10, h: 320 })
  })
})

// ---------------------------------------------------------------------------
// 4. 数量展开 / 倍数 / 超印
// ---------------------------------------------------------------------------

describe('数量展开 expandUnits', () => {
  it('每个已验证订单按书帖数展开，展开宽 = 2× 成品宽', () => {
    const orders = [
      order({ widthMm: 210, heightMm: 148, signatures: 4 }),
      order({ widthMm: 100, heightMm: 100, signatures: 2 }),
    ]
    const units = expandUnits(orders)
    expect(units).toHaveLength(6)
    expect(units[0].widthMm).toBe(420)
    expect(units[0].heightMm).toBe(148)
    expect(units.map((u) => u.sigIndex).slice(0, 4)).toEqual([0, 1, 2, 3])
  })
  it('未验证（draft）订单不展开', () => {
    const units = expandUnits([order({ widthMm: 100, heightMm: 100, status: 'draft' })])
    expect(units).toHaveLength(0)
  })
})

describe('合版分组：数量倍数与超印约束', () => {
  it('小订单在允许超印范围内搭大订单共享印次', () => {
    const big = order({ id: 'big', widthMm: 100, heightMm: 100, quantity: 500, maxOvershoot: 0 })
    const small = order({ id: 'small', widthMm: 90, heightMm: 90, quantity: 480, maxOvershoot: 30 })
    const groups = buildGroups([big, small], master())
    expect(groups).toHaveLength(1)
    expect(groups[0].runLength).toBe(500)
    expect(groups[0].orders.map((o) => o.id).sort()).toEqual(['big', 'small'])
  })

  it('超印会超限时小订单另开一组（不强行合版）', () => {
    const big = order({ id: 'big', widthMm: 100, heightMm: 100, quantity: 500, maxOvershoot: 0 })
    const small = order({ id: 'small', widthMm: 90, heightMm: 90, quantity: 400, maxOvershoot: 50 })
    const groups = buildGroups([big, small], master())
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.runLength).sort((a, b) => b - a)).toEqual([500, 400])
  })

  it('不同纸张绝不共版；不同纸纹默认分版', () => {
    const a = order({ id: 'a', widthMm: 80, heightMm: 80, quantity: 100, paper: '铜版' })
    const b = order({ id: 'b', widthMm: 80, heightMm: 80, quantity: 100, paper: '哑粉' })
    const c = order({ id: 'c', widthMm: 80, heightMm: 80, quantity: 100, grain: 'perpendicular' })
    const groups = buildGroups([a, b, c], master())
    expect(groups).toHaveLength(3)
  })

  it('印数按 runStep 向上取整（数量倍数）', () => {
    const o = order({ id: 'a', widthMm: 80, heightMm: 80, quantity: 103, maxOvershoot: 0 })
    const groups = buildGroups([o], master({ runStep: 50 }))
    expect(groups[0].runLength).toBe(150)
  })

  it('允许旋转时异纸纹订单并入同纸组', () => {
    const a = order({ id: 'a', widthMm: 80, heightMm: 80, grain: 'parallel', quantity: 100 })
    const b = order({ id: 'b', widthMm: 80, heightMm: 80, grain: 'perpendicular', quantity: 100 })
    const groups = buildGroups([a, b], master({ allowRotation: true }))
    expect(groups).toHaveLength(1)
    expect(groups[0].grain).toBe('parallel')
  })
})

// ---------------------------------------------------------------------------
// 5. 裁切可分离性
// ---------------------------------------------------------------------------

describe('guillotine 直线裁切可分离', () => {
  it('单个/空矩形 trivially 可切', () => {
    expect(guillotineCuts([])).toEqual([])
    expect(guillotineCuts([{ x: 0, y: 0, w: 10, h: 10 }])).toEqual([])
  })

  it('并排两块：1 刀', () => {
    const cuts = guillotineCuts([
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 100, h: 100 },
    ])
    expect(cuts).toEqual([{ orientation: 'v', posMm: 100 }])
  })

  it('2×2 网格：3 刀全部贯穿', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 50, y: 0, w: 50, h: 50 },
      { x: 0, y: 50, w: 50, h: 50 },
      { x: 50, y: 50, w: 50, h: 50 },
    ]
    const cuts = guillotineCuts(rects)
    expect(cuts).not.toBeNull()
    expect(cuts).toHaveLength(3)
  })

  it('L 形嵌套可分离（先整切再补刀）', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 60, h: 40 },
      { x: 0, y: 40, w: 30, h: 60 },
      { x: 30, y: 40, w: 70, h: 60 },
    ]
    expect(guillotineCuts(rects)).not.toBeNull()
  })

  it('pinwheel 风车嵌套：不可分离，返回 null（拒绝虚假高利用率）', () => {
    expect(guillotineCuts(pinwheelRects())).toBeNull()
  })

  it('中心十字互锁（非 pinwheel 变体）同样不可分离', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 60, h: 40 },
      { x: 60, y: 0, w: 40, h: 60 },
      { x: 40, y: 60, w: 60, h: 40 },
      { x: 0, y: 40, w: 40, h: 60 },
    ]
    expect(guillotineCuts(rects)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. 装箱 packSheet
// ---------------------------------------------------------------------------

describe('确定性 guillotine 装箱', () => {
  const m = master()

  it('单元全部排入且无重叠、不侵咬口', () => {
    const units = [
      unit({ id: 'a', widthMm: 200, heightMm: 100 }),
      unit({ id: 'b', widthMm: 180, heightMm: 120 }),
    ]
    const { front, unplaced } = packSheet(units, m, 'parallel')
    expect(unplaced).toHaveLength(0)
    expect(front).toHaveLength(2)
    for (const f of front) {
      expect(f.yMm).toBeGreaterThanOrEqual(10)
      expect(f.xMm + f.widthMm).toBeLessThanOrEqual(440)
    }
    const rs = front.map((f) => ({ x: f.xMm, y: f.yMm, w: f.widthMm, h: f.heightMm }))
    expect(rectsOverlap(rs[0], rs[1])).toBe(false)
  })

  it('摆不下的单元进入 unplaced（不缩小、不重叠硬塞）', () => {
    const units = [
      unit({ id: 'big', widthMm: 430, heightMm: 300 }), // 宽超过可印 440? 430<440, h300<=310 可放
      unit({ id: 'big2', widthMm: 430, heightMm: 300 }), // 第二张放不下
    ]
    const { front, unplaced } = packSheet(units, m, 'parallel')
    expect(front).toHaveLength(1)
    expect(unplaced.map((u) => u.id)).toEqual(['big2'])
  })

  it('禁印区被避开', () => {
    const mm = master({
      deadZones: [{ id: 'd1', xMm: 0, yMm: 10, widthMm: 120, heightMm: 120 }],
    })
    const units = [unit({ id: 'a', widthMm: 200, heightMm: 100 })]
    const { front } = packSheet(units, mm, 'parallel')
    expect(front).toHaveLength(1)
    // 左上角被禁印区占据，落点必须避开
    const hit = front[0].xMm < 120 && front[0].yMm < 130
    expect(hit).toBe(false)
  })

  it('相同输入两次装箱结果逐字节一致（确定性）', () => {
    const units = [
      unit({ id: 'a', widthMm: 200, heightMm: 100 }),
      unit({ id: 'b', widthMm: 180, heightMm: 120 }),
      unit({ id: 'c', widthMm: 100, heightMm: 100 }),
    ]
    const r1 = JSON.stringify(packSheet(units, m, 'parallel'))
    const r2 = JSON.stringify(packSheet(units, m, 'parallel'))
    expect(r1).toBe(r2)
  })

  it('与输入顺序无关（按面积确定性排序）', () => {
    const units = [
      unit({ id: 'a', widthMm: 200, heightMm: 100 }),
      unit({ id: 'b', widthMm: 180, heightMm: 120 }),
    ]
    const r1 = JSON.stringify(packSheet(units, m, 'parallel'))
    const r2 = JSON.stringify(packSheet([...units].reverse(), m, 'parallel'))
    expect(r1).toBe(r2)
  })

  it('锁定位置被尊重，其余单元绕开并重排', () => {
    const units = [
      unit({ id: 'a', widthMm: 200, heightMm: 100 }),
      unit({ id: 'b', widthMm: 200, heightMm: 100 }),
    ]
    const locks = [{ unitId: 'a', xMm: 120, yMm: 110, rotation: 0 as const }]
    const { front } = packSheet(units, m, 'parallel', locks)
    const a = front.find((f) => f.unitId === 'a')!
    const b = front.find((f) => f.unitId === 'b')!
    expect(a.xMm).toBe(120)
    expect(a.yMm).toBe(110)
    expect(a.locked).toBe(true)
    // b 不得与 a 重叠
    expect(
      rectsOverlap(
        { x: a.xMm, y: a.yMm, w: a.widthMm, h: a.heightMm },
        { x: b.xMm, y: b.yMm, w: b.widthMm, h: b.heightMm },
      ),
    ).toBe(false)
  })

  it('侵入咬口/越界的非法锁定被忽略', () => {
    const units = [unit({ id: 'a', widthMm: 200, heightMm: 100 })]
    const locks = [{ unitId: 'a', xMm: 0, yMm: 2, rotation: 0 as const }] // y=2 侵入上咬口
    const { front } = packSheet(units, m, 'parallel', locks)
    expect(front[0].locked).toBeUndefined()
    expect(front[0].yMm).toBeGreaterThanOrEqual(10)
  })

  it('开启旋转时异纹向单元以 90° 摆入', () => {
    const mm = master({ allowRotation: true })
    const units = [unit({ id: 'a', widthMm: 200, heightMm: 100, grain: 'perpendicular' })]
    const { front } = packSheet(units, mm, 'parallel')
    expect(front).toHaveLength(1)
    expect(front[0].rotation).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// 7. 端到端计划
// ---------------------------------------------------------------------------

describe('planGangRun 端到端', () => {
  const m = master()

  it('正反面严格镜像、无碰撞、可直线分离（validatePlan 通过）', () => {
    const orders = [
      order({ id: 'a', widthMm: 100, heightMm: 100, quantity: 100 }),
      order({ id: 'b', widthMm: 90, heightMm: 80, quantity: 120, maxOvershoot: 50 }),
    ]
    const plan = planGangRun({ orders, master: m })
    const v = validatePlan(plan, m)
    expect(v.ok, v.errors.join('；')).toBe(true)
    expect(plan.layouts.length).toBeGreaterThan(0)
  })

  it('背面镜像在短边翻转下同样套准', () => {
    const ms = master({ flip: 'short-edge' })
    const orders = [order({ id: 'a', widthMm: 100, heightMm: 100, quantity: 100 })]
    const plan = planGangRun({ orders, master: ms })
    expect(validatePlan(plan, ms).ok).toBe(true)
  })

  it('印数满足与超印计入 fulfillment', () => {
    const big = order({ id: 'big', widthMm: 80, heightMm: 80, quantity: 150, maxOvershoot: 0 })
    const small = order({ id: 'small', widthMm: 70, heightMm: 70, quantity: 100, maxOvershoot: 60 })
    const plan = planGangRun({ orders: [big, small], master: m })
    const fb = plan.fulfillment.find((f) => f.orderId === 'big')!
    const fs = plan.fulfillment.find((f) => f.orderId === 'small')!
    expect(fb.copies).toBe(150)
    expect(fb.overshoot).toBe(0)
    expect(fs.copies).toBe(150)
    expect(fs.overshoot).toBe(50)
    expect(fs.shortage).toBe(0)
    expect(plan.metrics.totalOvershoot).toBe(50)
  })

  it('超印受限的小订单分版，各自印数准确', () => {
    const big = order({ id: 'big', widthMm: 80, heightMm: 80, quantity: 300, maxOvershoot: 0 })
    const small = order({ id: 'small', widthMm: 70, heightMm: 70, quantity: 100, maxOvershoot: 20 })
    const plan = planGangRun({ orders: [big, small], master: m })
    const fs = plan.fulfillment.find((f) => f.orderId === 'small')!
    expect(fs.copies).toBe(100)
    expect(fs.overshoot).toBe(0)
  })

  it('母版摆不下时报告短缺，而不是重叠硬塞', () => {
    const huge = order({ id: 'h', widthMm: 400, heightMm: 400, quantity: 100 })
    const plan = planGangRun({ orders: [huge], master: m })
    const fh = plan.fulfillment.find((f) => f.orderId === 'h')!
    expect(fh.shortage).toBe(100)
    expect(fh.copies).toBe(0)
    expect(plan.warnings.some((w) => w.includes('印数不足'))).toBe(true)
  })

  it('废纸率在 [0,1]，且张数 = 各套 runLength 之和', () => {
    const orders = [order({ id: 'a', widthMm: 100, heightMm: 100, quantity: 100 })]
    const plan = planGangRun({ orders, master: m })
    expect(plan.metrics.wasteRate).toBeGreaterThanOrEqual(0)
    expect(plan.metrics.wasteRate).toBeLessThanOrEqual(1)
    const sum = plan.layouts.reduce((s, l) => s + l.runLength, 0)
    expect(plan.metrics.totalSheets).toBe(sum)
  })

  it('draft 订单不进计划且给出提示', () => {
    const plan = planGangRun({
      orders: [order({ id: 'd', widthMm: 80, heightMm: 80, status: 'draft' })],
      master: m,
    })
    expect(plan.layouts).toHaveLength(0)
    expect(plan.warnings.some((w) => w.includes('尚未验证'))).toBe(true)
  })

  it('成品计划被篡改背面后 validatePlan 报错（背面套准守护）', () => {
    const plan = planGangRun({
      orders: [order({ id: 'a', widthMm: 100, heightMm: 100 })],
      master: m,
    })
    plan.layouts[0].placed.back[0].xMm += 30
    expect(validatePlan(plan, m).ok).toBe(false)
  })

  it('完整计划确定性：重复生成结果一致', () => {
    const orders = [
      order({ id: 'a', widthMm: 100, heightMm: 100, quantity: 100 }),
      order({ id: 'b', widthMm: 90, heightMm: 80, quantity: 120 }),
    ]
    const p1 = JSON.stringify(planGangRun({ orders, master: m }))
    const p2 = JSON.stringify(planGangRun({ orders, master: m }))
    expect(p1).toBe(p2)
  })

  it('锁定后重新优化：锁定保留、整体仍合法', () => {
    const orders = [
      order({ id: 'a', widthMm: 100, heightMm: 100, quantity: 100 }),
      order({ id: 'b', widthMm: 120, heightMm: 90, quantity: 100 }),
    ]
    const locks = [{ unitId: 'a#s0', xMm: 200, yMm: 100, rotation: 0 as const }]
    const plan = planGangRun({ orders, master: m, options: { locks } })
    expect(validatePlan(plan, m).ok, validatePlan(plan, m).errors.join('；')).toBe(true)
    const a = plan.layouts[0].placed.front.find((f) => f.unitId === 'a#s0')
    expect(a?.xMm).toBe(200)
    expect(a?.locked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. 成本与计划比较
// ---------------------------------------------------------------------------

describe('成本与计划比较', () => {
  const m = master()

  it('planCost = 纸张 + 超印 + 换版三项之和', () => {
    const plan = planGangRun({
      orders: [order({ id: 'a', widthMm: 80, heightMm: 80, quantity: 100 })],
      master: m,
    })
    const c = planCost(plan)
    expect(c.total).toBeCloseTo(
      plan.metrics.totalSheets * DEFAULT_COST_WEIGHTS.perSheet +
        plan.metrics.totalOvershoot * DEFAULT_COST_WEIGHTS.perOvershoot +
        plan.metrics.sheetCount * DEFAULT_COST_WEIGHTS.perPlateChange,
      6,
    )
  })

  it('comparePlans 给出两套计划的张数/超印/换版差异与更便宜方', () => {
    const a = planGangRun({ orders: [order({ id: 'a', widthMm: 80, heightMm: 80, quantity: 100 })], master: m })
    const b = planGangRun({ orders: [order({ id: 'b', widthMm: 200, heightMm: 140, quantity: 100, signatures: 4 })], master: m })
    const cmp = comparePlans(a, b)
    expect(cmp.a.totalSheets).toBe(100)
    expect(cmp.b.plateChanges).toBeGreaterThanOrEqual(2)
    expect(cmp.cheaper).toBe('a')
    expect(cmp.delta.sheets).toBe(b.metrics.totalSheets - a.metrics.totalSheets)
  })

  it('完全相同的两计划比较为 tie', () => {
    const orders = [order({ id: 'a', widthMm: 80, heightMm: 80, quantity: 100 })]
    const cmp = comparePlans(planGangRun({ orders, master: m }), planGangRun({ orders, master: m }))
    expect(cmp.cheaper).toBe('tie')
    expect(cmp.delta.total).toBe(0)
  })
})
