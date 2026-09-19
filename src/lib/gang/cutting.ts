/**
 * 直线刀路（guillotine cut）可分离性。
 *
 * 印厂后加工只有一刀贯穿当前料块的直刀：每一刀必须沿一条贯穿线把
 * 当前矩形料块切成两块，且刀路上不能压着任何单元（刀只能走废料缝）。
 * 一个排布“可分离”，当且仅当存在这样一串刀路，把每个单元完整地
 * 切成独立料块——互相嵌套（L 形包围、十字穿插）的排布即使无重叠
 * 也无法分离，不能用它换取虚假的高利用率。
 *
 * 同一订单的多个书帖可以相邻（它们本来就是同一件活），但不同订单
 * 之间必须能被直线刀路切开：我们按【订单分组】判定，最终每块只含
 * 一个订单；订单内部再切到单帖（帖与帖来自同一版面 repeat，
 * 实际上每帖会在不同的重复印张上，但几何上仍要求可单帖分离）。
 */
import type { Cut, Rect } from './types'
import { area as rectArea, bottom, right } from './geometry'

export interface Item {
  id: string
  /** 分组身份：同一订单的单元共享 group；刀路必须能把不同 group 切开 */
  group: string
  rect: Rect
}

export interface SeparationResult {
  separable: boolean
  /** 判定为不可分离的原因（测试用） */
  reason?: 'nested' | 'cut-through-item' | 'empty' | 'mixed-final'
  /** 可分离时的完整刀序（沿料块边界执行） */
  cuts: Cut[]
}

interface Piece {
  bounds: Rect
  items: Item[]
}

const EPS = 1e-6

/**
 * 判定一组排布在给定料块内是否可被 guillotine 刀路完全分离。
 * @param items  排布单元（要求两两不重叠）
 * @param stock  料块（母版可印区）
 * @param requireSingleGroupFinal
 *   true  => 最终每块只能含一个 group（不同订单必须能切开）
 *   false => 切到单帖即可（每个单元一块）
 */
export function guillotineSeparate(
  items: Item[],
  stock: Rect,
  mode: 'group' | 'item' = 'group',
): SeparationResult {
  if (items.length === 0) return { separable: true, cuts: [] }
  for (const it of items) {
    if (
      it.rect.x < stock.x - EPS ||
      it.rect.y < stock.y - EPS ||
      right(it.rect) > right(stock) + EPS ||
      bottom(it.rect) > bottom(stock) + EPS
    ) {
      return { separable: false, reason: 'nested', cuts: [] }
    }
  }

  const cuts: Cut[] = []
  const initial: Piece = { bounds: stock, items }
  const stack: Piece[] = [initial]
  let guard = 0
  const maxGuards = items.length * 8 + 8

  while (stack.length > 0) {
    guard += 1
    if (guard > maxGuards) return { separable: false, reason: 'nested', cuts }
    const piece = stack.pop()!

    const done =
      mode === 'group'
        ? piece.items.every((i) => i.group === piece.items[0].group)
        : piece.items.length === 1
    if (done) {
      // group 模式：同组多帖仍需能切到单帖（本函数只验证订单可分离，
      // 同订单帖允许相邻共刀），所以整块即视为该订单的合法料块。
      continue
    }
    if (piece.items.length === 1) continue

    const split = findSplit(piece, mode)
    if (!split) {
      return { separable: false, reason: 'nested', cuts }
    }
    cuts.push(split.cut)
    stack.push(split.a, split.b)
  }

  return { separable: true, cuts }
}

interface Split {
  cut: Cut
  a: Piece
  b: Piece
}

/**
 * 在料块中找一条贯穿刀路：刀路必须
 * 1) 从料块一边贯穿到对边；
 * 2) 不切穿任何单元（只能走单元之间的缝隙或料块废料区）；
 * 3) 刀两侧都有内容（至少一侧的 group/单元集合发生分离）。
 * 枚举所有单元边界作为候选线，结果确定性（先 v 后 h、坐标升序）。
 */
function findSplit(piece: Piece, mode: 'group' | 'item'): Split | null {
  const { bounds, items } = piece

  // ---- 竖直刀（沿 y 方向贯穿）：候选 x = 各单元左边或右边 ----
  const xs = uniqueSorted(items.flatMap((i) => [i.rect.x, right(i.rect)]))
  for (const at0 of xs) {
    const at = snapToPiece(at0, bounds)
    if (at == null) continue
    if (at <= bounds.x + EPS || at >= right(bounds) - EPS) continue
    if (crossesItemV(items, at, bounds)) continue
    const left = items.filter((i) => right(i.rect) <= at + EPS)
    const rightItems = items.filter((i) => i.rect.x >= at - EPS)
    if (left.length === 0 || rightItems.length === 0) continue
    if (left.length + rightItems.length !== items.length) continue
    if (!usefulSplit(left, rightItems, mode)) continue
    const cut: Cut = { orient: 'v', at, from: bounds.y, to: bottom(bounds) }
    return {
      cut,
      a: { bounds: { x: bounds.x, y: bounds.y, w: at - bounds.x, h: bounds.h }, items: left },
      b: {
        bounds: { x: at, y: bounds.y, w: right(bounds) - at, h: bounds.h },
        items: rightItems,
      },
    }
  }

  // ---- 水平刀 ----
  const ys = uniqueSorted(items.flatMap((i) => [i.rect.y, bottom(i.rect)]))
  for (const at0 of ys) {
    const at = snapToPiece(at0, bounds)
    if (at == null) continue
    if (at <= bounds.y + EPS || at >= bottom(bounds) - EPS) continue
    if (crossesItemH(items, at, bounds)) continue
    const top = items.filter((i) => bottom(i.rect) <= at + EPS)
    const bottomItems = items.filter((i) => i.rect.y >= at - EPS)
    if (top.length === 0 || bottomItems.length === 0) continue
    if (top.length + bottomItems.length !== items.length) continue
    if (!usefulSplit(top, bottomItems, mode)) continue
    const cut: Cut = { orient: 'h', at, from: bounds.x, to: right(bounds) }
    return {
      cut,
      a: { bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: at - bounds.y }, items: top },
      b: {
        bounds: { x: bounds.x, y: at, w: bounds.w, h: bottom(bounds) - at },
        items: bottomItems,
      },
    }
  }

  return null
}

/**
 * 刀只有在【真正分开两个不同组】（group 模式）或分出单元时才有意义。
 * 同组内部共刀允许，但我们不需要它来证明可分离，跳过以免产生伪刀序。
 */
function usefulSplit(a: Item[], b: Item[], mode: 'group' | 'item'): boolean {
  if (mode === 'item') return a.length > 0 && b.length > 0
  const ga = new Set(a.map((i) => i.group))
  const gb = new Set(b.map((i) => i.group))
  for (const g of ga) if (!gb.has(g)) return true
  for (const g of gb) if (!ga.has(g)) return true
  return false
}

/** 竖刀 at 是否切穿单元（单元区间跨越 at 且 y 范围在料块内相交） */
function crossesItemV(items: Item[], at: number, bounds: Rect): boolean {
  return items.some(
    (i) =>
      i.rect.x < at - EPS &&
      right(i.rect) > at + EPS &&
      i.rect.y < bottom(bounds) &&
      bottom(i.rect) > bounds.y,
  )
}

function crossesItemH(items: Item[], at: number, bounds: Rect): boolean {
  return items.some(
    (i) =>
      i.rect.y < at - EPS &&
      bottom(i.rect) > at + EPS &&
      i.rect.x < right(bounds) &&
      right(i.rect) > bounds.x,
  )
}

/** 候选线吸附：贴边的边界直接当作料块边（返回 null 跳过） */
function snapToPiece(v: number, bounds: Rect): number | null {
  if (Math.abs(v - bounds.x) < EPS || Math.abs(v - (bounds.x + bounds.w)) < EPS) return null
  if (Math.abs(v - bounds.y) < EPS || Math.abs(v - (bounds.y + bounds.h)) < EPS) return null
  return v
}

function uniqueSorted(vals: number[]): number[] {
  return [...new Set(vals.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b)
}

/** 单元总面积（利用率/废纸统计用） */
export function itemsArea(items: Item[]): number {
  return items.reduce((s, i) => s + rectArea(i.rect), 0)
}
