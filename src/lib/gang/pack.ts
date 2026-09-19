/**
 * 确定性底左（bottom-left）装箱。
 *
 * 不使用随机数、不依赖 Map 迭代顺序：候选位置与摆放朝向全部按
 * 固定次序枚举，同一输入永远得到同一结果（测试依赖这一点）。
 *
 * 与"只按矩形塞满纸面"的区别：装箱只负责【提出】候选摆放，
 * 是否接受还要过三关——纸纹一致、正反两面镜像不碰撞/不压禁印区、
 * 整版可被直线刀路分离（由 plan.ts 校验）。
 */
import type { Rect } from './types'
import { bottom, intersects, rect as makeRect, right } from './geometry'

export interface PackItem {
  id: string
  w: number
  h: number
  /** 是否允许旋转 90° */
  allowRotate: boolean
  /** 调用方可强制旋转（纸纹要求） */
  forceRotate?: boolean
}

export interface PackedRect extends Rect {
  id: string
  rotated: boolean
}

export interface PackResult {
  placed: PackedRect[]
  /** 装不进去的条目 id（按输入顺序） */
  rejected: string[]
}

/**
 * @param items       待装条目（顺序即优先级，确定性）
 * @param stock       可印区矩形
 * @param blocked     区内已有障碍（调用方负责留缝扩张）
 * @param gapMm       单元与障碍的最小留缝
 */
export function bottomLeftPack(
  items: PackItem[],
  stock: Rect,
  blocked: Rect[] = [],
  gapMm = 0,
): PackResult {
  const occupied: Rect[] = blocked.map((b) => ({ ...b }))
  const placed: PackedRect[] = []
  const rejected: string[] = []

  for (const item of items) {
    let fitted: PackedRect | null = null
    for (const v of variantsFor(item)) {
      const cand = enumeratePlacements(v.w, v.h, stock, occupied, gapMm)[0]
      if (cand) {
        fitted = { ...cand, id: item.id, rotated: v.rotated }
        break
      }
    }
    if (fitted) {
      placed.push(fitted)
      occupied.push(fitted)
    } else {
      rejected.push(item.id)
    }
  }

  return { placed, rejected }
}

/**
 * 枚举固定朝向的全部合法底左候选点，按【y 最小、其次 x 最小】排序。
 *
 * 候选坐标 = 料块原点与每个已占矩形右边/底边（含留缝）的笛卡尔积，
 * 这是经典 maximal-rectangles 底左启发式；所有候选都必须完全落在
 * 料块内（x/y 不允许为负），且与任何已占矩形保持 gap 留缝。
 */
export function enumeratePlacements(
  w: number,
  h: number,
  stock: Rect,
  occupied: Rect[],
  gap = 0,
): Rect[] {
  if (w <= 0 || h <= 0 || w > stock.w + 1e-6 || h > stock.h + 1e-6) return []

  const xs = new Set<number>([stock.x])
  const ys = new Set<number>([stock.y])
  for (const o of occupied) {
    xs.add(clamp(right(o) + gap, stock))
    ys.add(clamp(bottom(o) + gap, stock))
    xs.add(clamp(o.x + gap, stock))
    ys.add(clamp(o.y + gap, stock))
  }

  const out: Rect[] = []
  for (const x of xs) {
    for (const y of ys) {
      if (x < stock.x - 1e-6 || y < stock.y - 1e-6) continue
      if (x + w > right(stock) + 1e-6 || y + h > bottom(stock) + 1e-6) continue
      const cand = makeRect(x, y, w, h)
      const inflatedProbe =
        gap > 0 ? makeRect(x - gap, y - gap, w + gap * 2, h + gap * 2) : cand
      if (occupied.some((o) => intersects(inflatedProbe, o))) continue
      out.push(cand)
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

function clamp(v: number, stock: Rect): number {
  if (v < stock.x) return stock.x
  if (v > right(stock)) return right(stock)
  return v
}

/** 一个条目的朝向候选：不旋转优先；允许时再试旋转，次序固定 */
function variantsFor(item: PackItem): Array<{ w: number; h: number; rotated: boolean }> {
  const force = item.forceRotate ?? false
  const out: Array<{ w: number; h: number; rotated: boolean }> = []
  if (force) {
    out.push({ w: item.h, h: item.w, rotated: true })
    if (item.allowRotate) out.push({ w: item.w, h: item.h, rotated: false })
  } else {
    out.push({ w: item.w, h: item.h, rotated: false })
    if (item.allowRotate) out.push({ w: item.h, h: item.w, rotated: true })
  }
  return out
}
