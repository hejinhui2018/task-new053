import { describe, expect, it } from 'vitest'
import {
  bottom,
  contains,
  grainConsistent,
  gripRect,
  gripRectBack,
  intersects,
  mirrorToBack,
  mirrorToFront,
  overlapArea,
  requiredRotation,
  right,
  signatureSize,
} from './lib/gang/geometry'
import { bottomLeftPack } from './lib/gang/pack'
import { guillotineSeparate, type Item } from './lib/gang/cutting'
import { planGang } from './lib/gang/plan'
import { createSampleOrders, MASTER_PRESETS } from './lib/gang/catalog'
import type {
  BackMode,
  GangOrder,
  LockedCell,
  MasterSheet,
  PressConfig,
  Rect,
} from './lib/gang/types'

const MASTER: MasterSheet = {
  id: 'm',
  name: '测试母版 889×597',
  widthMm: 889,
  heightMm: 597,
  grade: 'coated-157',
  grain: 'long',
}

const PRESS: PressConfig = {
  mode: 'work-and-turn',
  flip: 'long',
  grip: { edge: 'top', widthMm: 12 },
}

function plan(
  orders: GangOrder[],
  overrides: {
    master?: MasterSheet
    press?: PressConfig
    locks?: LockedCell[]
    forbidden?: import('./lib/gang/types').ForbiddenZone[]
  } = {},
) {
  return planGang({
    orders,
    master: overrides.master ?? MASTER,
    press: overrides.press ?? PRESS,
    forbidden: overrides.forbidden ?? [],
    locks: overrides.locks ?? [],
    strategy: 'min-overs',
  })
}

function rectOf(c: { x: number; y: number; w: number; h: number }): Rect {
  return { x: c.x, y: c.y, w: c.w, h: c.h }
}

/** 母版全幅矩形（母版坐标原点在左上角） */
const FULL_RECT: Rect = { x: 0, y: 0, w: MASTER.widthMm, h: MASTER.heightMm }

// ---------------------------------------------------------------------------
describe('双面镜像映射', () => {
  const m = { widthMm: 889, heightMm: 597 }
  const f: Rect = { x: 100, y: 50, w: 300, h: 200 }

  it('长边左右翻（work-and-turn）：横向镜像、纵向不变', () => {
    const b = mirrorToBack(f, m, 'work-and-turn')
    expect(b).toEqual({ x: 889 - 400, y: 50, w: 300, h: 200 })
    expect(b.x).toBe(489)
  })

  it('短边上下翻（work-and-tumble）：整版 180°，横纵都镜像', () => {
    const b = mirrorToBack(f, m, 'work-and-tumble')
    expect(b).toEqual({ x: 489, y: 597 - 250, w: 300, h: 200 })
    expect(b.y).toBe(347)
  })

  it('正反版（work-and-back）：正反两套版独立对位，坐标相同', () => {
    expect(mirrorToBack(f, m, 'work-and-back')).toEqual(f)
  })

  it.each(['work-and-turn', 'work-and-tumble', 'work-and-back'] as BackMode[])(
    '往返一致：正面→背面→正面必须还原（%s）',
    (mode) => {
      const b = mirrorToBack(f, m, mode)
      expect(mirrorToFront(b, m, mode)).toEqual(f)
    },
  )

  it('镜像不改变尺寸（翻面不会把书帖拉大压小）', () => {
    for (const mode of ['work-and-turn', 'work-and-tumble', 'work-and-back'] as BackMode[]) {
      const b = mirrorToBack(f, m, mode)
      expect(b.w).toBe(f.w)
      expect(b.h).toBe(f.h)
    }
  })

  it('咬口：左右翻咬住的顶边不变；上下翻换到对侧边；正反版同位', () => {
    const g = gripRect(MASTER, PRESS.grip) // 顶部 12mm 条带
    expect(g).toEqual({ x: 0, y: 0, w: 889, h: 12 })
    const backTurn = gripRectBack(MASTER, PRESS.grip, 'work-and-turn')
    expect(backTurn.y).toBe(0) // 顶边仍在顶部
    const backTumble = gripRectBack(MASTER, PRESS.grip, 'work-and-tumble')
    expect(backTumble.y).toBe(597 - 12) // 翻到底边
    const backWAB = gripRectBack(MASTER, PRESS.grip, 'work-and-back')
    expect(backWAB).toEqual(g)
  })

  it('禁印区镜像：横向镜像后落到对侧 x', () => {
    const zone: Rect = { x: 760, y: 565, w: 120, h: 24 }
    const b = mirrorToBack(zone, MASTER, 'work-and-turn')
    expect(b.x).toBe(889 - 880) // 9
    expect(b.y).toBe(zone.y)
  })
})

// ---------------------------------------------------------------------------
describe('矩形碰撞与包含', () => {
  it('相交判定：重叠 true，仅边相切不算碰撞（留缝可共刀）', () => {
    const a: Rect = { x: 0, y: 0, w: 100, h: 100 }
    expect(intersects(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
    expect(intersects(a, { x: 100, y: 0, w: 100, h: 100 })).toBe(false)
    expect(overlapArea(a, { x: 100, y: 0, w: 100, h: 100 })).toBe(0)
    expect(overlapArea(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(2500)
  })

  it('包含判定（边界可重合）', () => {
    const stock: Rect = { x: 0, y: 0, w: 889, h: 597 }
    expect(contains(stock, { x: 0, y: 12, w: 420, h: 285 })).toBe(true)
    expect(contains(stock, { x: 0, y: 12, w: 420, h: 590 })).toBe(false)
  })

  it('书帖展开宽 = 2 × 成品宽', () => {
    expect(signatureSize(210, 285)).toEqual({ w: 420, h: 285 })
  })
})

// ---------------------------------------------------------------------------
describe('纸纹一致性', () => {
  // 母版顺纹：纤维沿母版长边（水平）。竖版成品（长边竖直）要顺纹，
  // 必须把展开书帖旋转 90°，使成品长边与纤维平行。
  it('竖版成品（210×285）双方都顺纹：必须旋转 90° 才一致，正放反而错', () => {
    expect(grainConsistent('long', 'long', 210, 285, true)).toBe(true)
    expect(grainConsistent('long', 'long', 210, 285, false)).toBe(false)
  })

  it('订单横纹 + 母版顺纹（竖版）：不旋转才一致', () => {
    expect(grainConsistent('short', 'long', 200, 260, false)).toBe(true)
    expect(grainConsistent('short', 'long', 200, 260, true)).toBe(false)
  })

  it('横版成品（宽>高）方向相反：双方顺纹时不旋转即一致', () => {
    expect(grainConsistent('long', 'long', 285, 210, false)).toBe(true)
    expect(grainConsistent('long', 'long', 285, 210, true)).toBe(false)
  })

  it('三个示例订单在大度对开母版上的必需旋转：A 转、B 不转、C 转', () => {
    const samples = createSampleOrders()
    const rot = (o: GangOrder) =>
      requiredRotation(o.grain, MASTER.grain, o.trimW, o.trimH)
    expect(rot(samples[0])).toBe(true) // 210×285 竖版顺纹
    expect(rot(samples[1])).toBe(false) // 200×260 横纹
    expect(rot(samples[2])).toBe(true) // 140×210 竖版顺纹
  })

  it('展开尺寸随旋转交换宽高（横纹 B 不转，版面尺寸仍为 400×260）', () => {
    const s = signatureSize(200, 260) // 400×260
    const rotated = requiredRotation('short', 'long', 200, 260)
    expect(rotated).toBe(false)
    expect(s).toEqual({ w: 400, h: 260 })
  })
})

// ---------------------------------------------------------------------------
describe('底左装箱', () => {
  const stock: Rect = { x: 0, y: 0, w: 300, h: 300 }

  it('从左上角开始，第二个单元排在右侧并保持留缝', () => {
    const r = bottomLeftPack(
      [
        { id: 'a', w: 100, h: 100, allowRotate: false },
        { id: 'b', w: 100, h: 100, allowRotate: false },
      ],
      stock,
      [],
      5,
    )
    expect(r.placed.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [105, 0],
    ])
    expect(r.rejected).toEqual([])
  })

  it('装不下的单元进入 rejected 而不是越界', () => {
    const r = bottomLeftPack(
      [
        { id: 'a', w: 250, h: 250, allowRotate: false },
        { id: 'b', w: 100, h: 100, allowRotate: false },
      ],
      stock,
      [],
      0,
    )
    expect(r.placed).toHaveLength(1)
    expect(r.rejected).toEqual(['b'])
    for (const p of r.placed) expect(contains(stock, p)).toBe(true)
  })

  it('确定性：同一输入多次运行结果完全一致', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `u${i}`,
      w: 80 + (i % 3) * 20,
      h: 70,
      allowRotate: true,
    }))
    const r1 = bottomLeftPack(items, stock, [{ x: 0, y: 0, w: 12, h: 300 }], 3)
    const r2 = bottomLeftPack(items, stock, [{ x: 0, y: 0, w: 12, h: 300 }], 3)
    expect(r1).toEqual(r2)
  })
})

// ---------------------------------------------------------------------------
describe('直线裁切可分离（guillotine）', () => {
  const stock: Rect = { x: 0, y: 0, w: 300, h: 300 }

  it('左右并排：一条竖刀即可分离', () => {
    const items: Item[] = [
      { id: 'a', group: 'A', rect: { x: 0, y: 0, w: 140, h: 300 } },
      { id: 'b', group: 'B', rect: { x: 160, y: 0, w: 140, h: 300 } },
    ]
    const r = guillotineSeparate(items, stock, 'group')
    expect(r.separable).toBe(true)
    expect(r.cuts[0].orient).toBe('v')
    expect(r.cuts[0].at).toBeGreaterThanOrEqual(140)
    expect(r.cuts[0].at).toBeLessThanOrEqual(160)
  })

  it('2×2 网格可切到单件（item 模式，同订单帖也必须能分开）', () => {
    const items: Item[] = [
      { id: 'a', group: 'A', rect: { x: 0, y: 0, w: 140, h: 140 } },
      { id: 'b', group: 'A', rect: { x: 160, y: 0, w: 140, h: 140 } },
      { id: 'c', group: 'A', rect: { x: 0, y: 160, w: 140, h: 140 } },
      { id: 'd', group: 'A', rect: { x: 160, y: 160, w: 140, h: 140 } },
    ]
    const r = guillotineSeparate(items, stock, 'item')
    expect(r.separable).toBe(true)
    expect(r.cuts.length).toBeGreaterThanOrEqual(3) // 4 块至少 3 刀
  })

  it('风车形四件互锁：无贯穿缝，判定为不可分离（拒绝虚假利用率）', () => {
    // 中央 x100..200 / y100..200 留空，四件呈风车互锁，
    // 任意贯穿竖线/横线都会切穿至少一件
    const items: Item[] = [
      { id: 'a', group: 'A', rect: { x: 0, y: 0, w: 200, h: 100 } },
      { id: 'b', group: 'B', rect: { x: 200, y: 0, w: 100, h: 200 } },
      { id: 'c', group: 'C', rect: { x: 100, y: 200, w: 200, h: 100 } },
      { id: 'd', group: 'D', rect: { x: 0, y: 100, w: 100, h: 200 } },
    ]
    // 先确认排布本身无重叠（不是靠碰撞挡下的）
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        expect(overlapArea(items[i].rect, items[j].rect)).toBe(0)
      }
    }
    const r = guillotineSeparate(items, stock, 'item')
    expect(r.separable).toBe(false)
  })

  it('group 模式：同组相邻共刀允许，异组仍必须可切开', () => {
    const items: Item[] = [
      { id: 'a1', group: 'A', rect: { x: 0, y: 0, w: 140, h: 140 } },
      { id: 'a2', group: 'A', rect: { x: 0, y: 160, w: 140, h: 140 } },
      { id: 'b1', group: 'B', rect: { x: 160, y: 0, w: 140, h: 300 } },
    ]
    const r = guillotineSeparate(items, stock, 'group')
    expect(r.separable).toBe(true)
    // 第一刀必须是分开 A/B 的竖刀，而不是先切 A 内部
    expect(r.cuts[0].orient).toBe('v')
  })

  it('越出料块的单元直接判不可分离', () => {
    const items: Item[] = [
      { id: 'a', group: 'A', rect: { x: 0, y: 0, w: 310, h: 100 } },
    ]
    expect(guillotineSeparate(items, stock, 'item').separable).toBe(false)
  })

  it('空排布可分离且无刀', () => {
    expect(guillotineSeparate([], stock, 'item')).toEqual({ separable: true, cuts: [] })
  })
})

// ---------------------------------------------------------------------------
describe('合版计划 · 示例三订单', () => {
  it('三个不同尺寸/印数订单合版：全部满足、无 error、超印不超过允许值', () => {
    const p = plan(createSampleOrders())
    expect(p.feasible).toBe(true)
    expect(p.issues.filter((i) => i.level === 'error')).toHaveLength(0)
    for (const s of p.stats) {
      const o = createSampleOrders().find((x) => x.id === s.orderId)!
      expect(s.met).toBe(true)
      expect(s.copies).toBeGreaterThanOrEqual(o.run)
      expect(s.overs).toBeLessThanOrEqual(o.allowOvers)
    }
  })

  it('出现真实的跨版分摊与受控超印（小册 360 需求，超印恰好 40）', () => {
    const p = plan(createSampleOrders())
    const c = p.stats.find((s) => s.orderId === 'sample-c')!
    expect(c.copies).toBe(400)
    expect(c.overs).toBe(40)
    // 小册出现在多块套版上（120 + 280 分摊）
    expect(c.boards.length).toBeGreaterThan(1)
  })

  it('每块套版：正面不重叠、不压咬口、背面镜像互不重叠且不压背面咬口', () => {
    const p = plan(createSampleOrders())
    expect(p.boards.length).toBeGreaterThan(1)
    for (const b of p.boards) {
      const rs = b.cells.map(rectOf)
      for (let i = 0; i < rs.length; i += 1) {
        expect(contains(FULL_RECT, rs[i])).toBe(true)
        // 留缝：最近边间距 >= CELL_GAP_MM（相切不碰撞即可，留缝由布局保证）
        for (let j = i + 1; j < rs.length; j += 1) {
          expect(overlapArea(rs[i], rs[j])).toBe(0)
          const bi = mirrorToBack(rs[i], MASTER, 'work-and-turn')
          const bj = mirrorToBack(rs[j], MASTER, 'work-and-turn')
          expect(overlapArea(bi, bj)).toBe(0)
        }
        const back = mirrorToBack(rs[i], MASTER, 'work-and-turn')
        expect(contains(FULL_RECT, back)).toBe(true)
        const gBack = gripRectBack(MASTER, PRESS.grip, 'work-and-turn')
        expect(intersects(back, gBack)).toBe(false)
      }
    }
  })

  it('每块套版都可直线分离，且记录的刀路不切穿任何单元', () => {
    const p = plan(createSampleOrders())
    for (const b of p.boards) {
      const items: Item[] = b.cells.map((c) => ({
        id: c.unitId,
        group: c.orderId,
        rect: rectOf(c),
      }))
      expect(guillotineSeparate(items, FULL_RECT, 'item').separable).toBe(true)
      for (const cut of b.cuts) {
        for (const c of b.cells) {
          const r = rectOf(c)
          if (cut.orient === 'v') {
            const crossesX = cut.at > r.x + 1e-6 && cut.at < right(r) - 1e-6
            const inY = cut.to > r.y + 1e-6 && cut.from < bottom(r) - 1e-6
            expect(crossesX && inY).toBe(false)
          } else {
            const crossesY = cut.at > r.y + 1e-6 && cut.at < bottom(r) - 1e-6
            const inX = cut.to > r.x + 1e-6 && cut.from < right(r) - 1e-6
            expect(crossesY && inX).toBe(false)
          }
        }
      }
    }
  })

  it('废纸率介于 0..1，总用纸 = Σ 套版印次', () => {
    const p = plan(createSampleOrders())
    expect(p.totals.wasteRate).toBeGreaterThan(0)
    expect(p.totals.wasteRate).toBeLessThan(1)
    expect(p.totals.sheets).toBe(p.boards.reduce((s, b) => s + b.repeat, 0))
    expect(p.totals.totalCost).toBeCloseTo(p.totals.paperCost + p.totals.plateCost, 2)
  })
})

// ---------------------------------------------------------------------------
describe('数量倍数与超印', () => {
  function order(partial: Partial<GangOrder>): GangOrder {
    return {
      id: 'o1',
      name: '单帖订单',
      color: '#2f5bd8',
      trimW: 140,
      trimH: 210,
      signatures: 1,
      run: 300,
      paper: 'coated-157',
      grain: 'long',
      allowOvers: 0,
      dueDate: '2026-10-01',
      allowRotate: true,
      verified: true,
      ...partial,
    }
  }

  it('一版放得下全部书帖时：1 套版、印次=印数、无超印', () => {
    const p = plan([order({ signatures: 3, run: 300 })])
    expect(p.feasible).toBe(true)
    expect(p.boards).toHaveLength(1)
    expect(p.boards[0].repeat).toBe(300)
    expect(p.totals.sheets).toBe(300)
    expect(p.totals.plates).toBe(1)
    expect(p.stats[0].copies).toBe(300)
  })

  it('母版每版只能放 1 帖时：各帖单独开版，印数仍精确配套', () => {
    // A 书帖旋转后 285×420；500×460 母版横放两件需 573、竖放两件需 855，每版仅一帖
    const smallMaster: MasterSheet = { ...MASTER, widthMm: 500, heightMm: 460 }
    const p = plan([order({ trimW: 210, trimH: 285, signatures: 4, run: 250 })], {
      master: smallMaster,
    })
    expect(p.feasible).toBe(true)
    expect(p.boards).toHaveLength(4)
    for (const b of p.boards) {
      expect(b.cells).toHaveLength(1)
      expect(b.repeat).toBe(250)
    }
    expect(p.stats[0].copies).toBe(250)
    expect(p.stats[0].overs).toBe(0)
  })

  it('两订单同版合印印数不同：按瓶颈印次共印，余额另开版，不产生多余超印', () => {
    const x = order({ id: 'x', name: 'X', run: 100, signatures: 1, trimW: 200, trimH: 260, grain: 'short' })
    const y = order({ id: 'y', name: 'Y', run: 150, signatures: 1, color: '#d2691e', trimW: 200, trimH: 260, grain: 'short' })
    const p = plan([x, y])
    const sx = p.stats.find((s) => s.orderId === 'x')!
    const sy = p.stats.find((s) => s.orderId === 'y')!
    expect(sx.copies).toBe(100)
    expect(sy.copies).toBe(150)
    expect(p.totals.sheets).toBe(150)
  })

  it('收紧超印上限后，计划改用更多套版凑齐印数而不是突破上限', () => {
    const samples = createSampleOrders()
    const loose = plan(samples)
    const tight = plan(
      samples.map((o) => (o.id === 'sample-c' ? { ...o, allowOvers: 10 } : o)),
    )
    expect(tight.feasible).toBe(true)
    const c = tight.stats.find((s) => s.orderId === 'sample-c')!
    expect(c.overs).toBeLessThanOrEqual(10)
    expect(c.met).toBe(true)
    // 更紧的超印约束不会比宽松方案用更少的套版（通常更多）
    expect(tight.boards.length).toBeGreaterThanOrEqual(loose.boards.length)
  })
})

// ---------------------------------------------------------------------------
describe('订单与母版约束校验', () => {
  const base: GangOrder = {
    id: 'o1',
    name: '校验单',
    color: '#2f5bd8',
    trimW: 210,
    trimH: 285,
    signatures: 2,
    run: 100,
    paper: 'coated-157',
    grain: 'long',
    allowOvers: 10,
    dueDate: '2026-10-01',
    allowRotate: true,
    verified: true,
  }

  it('未验证书帖不能进入合版', () => {
    const p = plan([{ ...base, verified: false }])
    expect(p.feasible).toBe(false)
    expect(p.issues.some((i) => i.code === 'order-unverified')).toBe(true)
    expect(p.boards).toHaveLength(0)
  })

  it('纸张品种与母版不一致：拒印', () => {
    const p = plan([{ ...base, paper: 'uncoated-120' }])
    expect(p.issues.some((i) => i.code === 'paper-mismatch')).toBe(true)
    expect(p.feasible).toBe(false)
  })

  it('纸纹要求旋转但订单禁止旋转：报纸纹冲突', () => {
    const p = plan([{ ...base, grain: 'long', allowRotate: false }])
    expect(p.issues.some((i) => i.code === 'grain-impossible')).toBe(true)
  })

  it('展开书帖大于母版：报放不下', () => {
    const p = plan([{ ...base, trimW: 400, trimH: 500 }])
    expect(p.issues.some((i) => i.code === 'does-not-fit')).toBe(true)
  })

  it('禁印区占用过大导致没有合法落点：印数不足', () => {
    const p = plan([base], {
      forbidden: [
        {
          id: 'fz',
          name: '大面积禁印',
          rect: { x: 0, y: 12, w: 889, h: 500 },
          mirrorToBack: false,
        },
      ],
    })
    expect(p.feasible).toBe(false)
    expect(p.issues.some((i) => i.code === 'quantity-short' || i.code === 'does-not-fit')).toBe(true)
  })

  it('正反版模式：每套版计 2 块印版（正反各一）', () => {
    const p = plan(createSampleOrders(), {
      press: { ...PRESS, mode: 'work-and-back' },
    })
    expect(p.feasible).toBe(true)
    expect(p.totals.plates).toBe(p.boards.length * 2)
  })
})

// ---------------------------------------------------------------------------
describe('人工锁定', () => {
  it('锁定的书帖固定在指定坐标并标记 locked，其余单元围绕它重排', () => {
    const samples = createSampleOrders()
    // sample-c 140×210 竖版顺纹在顺纹母版上【必须旋转 90°】（版面 210×280）
    const lock: LockedCell = {
      boardIndex: 0,
      orderId: 'sample-c',
      signature: 0,
      x: 100,
      y: 100,
      rotated: true,
    }
    const p = plan(samples, { locks: [lock] })
    const cell = p.boards
      .flatMap((b) => b.cells)
      .find((c) => c.orderId === 'sample-c' && c.signature === 0 && c.locked)!
    expect(cell).toBeTruthy()
    expect(cell.x).toBe(100)
    expect(cell.y).toBe(100)
    expect(cell.rotated).toBe(true)
    // 同一套版内其他单元不与锁定单元重叠（不同套版是不同纸张，允许同位）
    const lockedRect = rectOf(cell)
    const sameBoard = p.boards.find((b) => b.cells.some((c) => c === cell))!
    for (const c of sameBoard.cells) {
      if (c.locked) continue
      expect(overlapArea(lockedRect, rectOf(c))).toBe(0)
    }
    expect(p.feasible).toBe(true)
  })

  it('锁定压入咬口：拒绝该锁定并报错', () => {
    const samples = createSampleOrders()
    const lock: LockedCell = {
      boardIndex: 0,
      orderId: 'sample-c',
      signature: 0,
      x: 0,
      y: 0, // 顶部 12mm 咬口内（旋转后高 280）
      rotated: true,
    }
    const p = plan(samples, { locks: [lock] })
    expect(p.issues.some((i) => i.code === 'grip-overlap')).toBe(true)
    expect(
      p.boards.flatMap((b) => b.cells).some((c) => c.locked && c.x === 0 && c.y === 0),
    ).toBe(false)
  })

  it('两个锁定互相碰撞：第二个被拒绝', () => {
    const samples = createSampleOrders()
    const l1: LockedCell = { boardIndex: 0, orderId: 'sample-c', signature: 0, x: 0, y: 12, rotated: true }
    const l2: LockedCell = { boardIndex: 0, orderId: 'sample-c', signature: 1, x: 10, y: 12, rotated: true }
    const p = plan(samples, { locks: [l1, l2] })
    expect(p.issues.some((i) => i.code === 'collision' || i.code === 'back-overlap')).toBe(true)
    expect(p.boards[0].cells.filter((c) => c.locked)).toHaveLength(1)
  })

  it('锁定旋转方向违反纸纹：拒绝', () => {
    const samples = createSampleOrders()
    // sample-a 210×285 竖版顺纹必须旋转，锁定强行正放
    const lock: LockedCell = { boardIndex: 0, orderId: 'sample-a', signature: 0, x: 0, y: 12, rotated: false }
    const p = plan(samples, { locks: [lock] })
    expect(p.issues.some((i) => i.code === 'grain-impossible')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('确定性优化', () => {
  it('相同输入（含锁定、禁印区、印刷方式）两次计划结果逐字段一致', () => {
    const orders = createSampleOrders()
    const forbidden = [
      { id: 'fz', name: '测控条', rect: { x: 760, y: 565, w: 120, h: 24 }, mirrorToBack: true },
    ]
    const locks: LockedCell[] = [
      { boardIndex: 0, orderId: 'sample-c', signature: 0, x: 0, y: 300, rotated: false },
    ]
    const args = { orders, master: MASTER, press: PRESS, forbidden, locks }
    const p1 = planGang({ ...args, strategy: 'min-overs' })
    const p2 = planGang({ ...args, strategy: 'min-overs' })
    expect(JSON.stringify(p1.boards)).toBe(JSON.stringify(p2.boards))
    expect(JSON.stringify(p1.stats)).toBe(JSON.stringify(p2.stats))
    expect(JSON.stringify(p1.totals)).toBe(JSON.stringify(p2.totals))
  })

  it('订单数组顺序被打乱不影响结果（按确定优先级而非输入顺序）', () => {
    const a = createSampleOrders()
    const b = [a[2], a[0], a[1]]
    const p1 = plan(a)
    const p2 = plan(b)
    expect(p2.feasible).toBe(p1.feasible)
    expect(p2.totals.sheets).toBe(p1.totals.sheets)
    // 逐订单产出一致
    for (const o of a) {
      const s1 = p1.stats.find((s) => s.orderId === o.id)!
      const s2 = p2.stats.find((s) => s.orderId === o.id)!
      expect(s2.copies).toBe(s1.copies)
    }
  })

  it('换版成本策略：正反版换版成本翻倍，对比基线能体现差异', () => {
    const samples = createSampleOrders()
    const wat = plan(samples, { press: PRESS })
    const wab = plan(samples, { press: { ...PRESS, mode: 'work-and-back' } })
    expect(wab.totals.plateCost).toBeGreaterThan(wat.totals.plateCost)
  })
})

// ---------------------------------------------------------------------------
describe('预设母版目录', () => {
  it('内置三个不同尺寸与印数的示例订单', () => {
    const s = createSampleOrders()
    expect(s).toHaveLength(3)
    const dims = new Set(s.map((o) => `${o.trimW}x${o.trimH}`))
    expect(dims.size).toBe(3)
    const runs = new Set(s.map((o) => o.run))
    expect(runs.size).toBe(3)
  })

  it('预设母版均为长边水平（width >= height）', () => {
    for (const m of MASTER_PRESETS) expect(m.widthMm).toBeGreaterThanOrEqual(m.heightMm)
  })
})
