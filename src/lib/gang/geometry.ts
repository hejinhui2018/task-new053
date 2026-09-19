/**
 * 合版几何：矩形、翻面镜像、咬口/禁印区、纸纹、书帖展开尺寸。
 *
 * 坐标约定（单位 mm）：
 * - 正面为直视印刷面，原点在母版【正面左上角】，x 向右、y 向下。
 * - 纸张翻面绕物理边旋转 180°：长边翻转（左右翻）背面坐标做横向镜像
 *   (x -> W-x)，短边翻转（上下翻）做纵向镜像 (y -> H-y)。
 * - 正反版（work-and-back）使用两套独立印版，背面位置与正面相同。
 */
import type {
  BackMode,
  GripZone,
  MasterSheet,
  Rect,
} from './types'

export interface Vec {
  x: number
  y: number
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h }
}

export function right(r: Rect): number {
  return r.x + r.w
}
export function bottom(r: Rect): number {
  return r.y + r.h
}
export function area(r: Rect): number {
  return r.w * r.h
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < right(b) &&
    right(a) > b.x &&
    a.y < bottom(b) &&
    a.y + a.h > b.y
  )
}

/** 严格内含（b 完全落在 a 内，边界可重合） */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    right(inner) <= right(outer) &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

/** 两矩形面积重叠（0 表示仅相切或不相交） */
export function overlapArea(a: Rect, b: Rect): number {
  const ow = Math.min(right(a), right(b)) - Math.max(a.x, b.x)
  const oh = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y)
  return ow > 0 && oh > 0 ? ow * oh : 0
}

/**
 * 正面矩形 -> 背面矩形（直视背面时看到的位置与朝向）。
 *
 * 与单书拼版沿用同一约定：
 * - work-and-turn 自翻版（长边左右翻）：绕竖直轴翻，横向镜像 x→W-x，
 *   内容在背面左右换位、上下不倒；
 * - work-and-tumble 自翻版（短边上下翻）：背面整版旋转 180°，
 *   x→W-x 且 y→H-y；
 * - work-and-back 正反版：正反两套独立印版分别对位，坐标相同。
 */
export function mirrorToBack(
  front: Rect,
  master: { widthMm: number; heightMm: number },
  mode: BackMode,
): Rect {
  switch (mode) {
    case 'work-and-turn':
      return { x: master.widthMm - right(front), y: front.y, w: front.w, h: front.h }
    case 'work-and-tumble':
      return {
        x: master.widthMm - right(front),
        y: master.heightMm - bottom(front),
        w: front.w,
        h: front.h,
      }
    case 'work-and-back':
      return { ...front }
  }
}

/** 往返一致：背面再映回正面必须得到原矩形（任何翻面方式都成立） */
export function mirrorToFront(
  back: Rect,
  master: { widthMm: number; heightMm: number },
  mode: BackMode,
): Rect {
  // 镜像为对合（involution）：映两次回到原位，正反版也一样
  return mirrorToBack(back, master, mode)
}

/**
 * 母版上某条边的咬口条带（正面坐标）。
 */
export function gripRect(master: MasterSheet, grip: GripZone): Rect {
  switch (grip.edge) {
    case 'top':
      return rect(0, 0, master.widthMm, grip.widthMm)
    case 'bottom':
      return rect(0, master.heightMm - grip.widthMm, master.widthMm, grip.widthMm)
    case 'left':
      return rect(0, 0, grip.widthMm, master.heightMm)
    case 'right':
      return rect(master.widthMm - grip.widthMm, 0, grip.widthMm, master.heightMm)
  }
}

/**
 * 咬口在背面的位置。
 * - 长边左右翻：纸张绕竖直轴翻，机台咬住的顶/底边不变（仅左/右边互换）；
 * - 短边上下翻（整版 180°）：咬口边翻到对侧边；
 * - 正反版：两套印版独立对位，机台始终咬同一条边，背面坐标相同。
 */
export function gripRectBack(
  master: MasterSheet,
  grip: GripZone,
  mode: BackMode,
): Rect {
  const front = gripRect(master, grip)
  if (mode === 'work-and-back') return front
  return mirrorToBack(front, master, mode)
}

/**
 * 一个书帖展开后的印面尺寸（mm）。
 * 骑马钉每帖 1 张对折纸：摊平为 2 × 成品宽，成品高。
 */
export function signatureSize(trimW: number, trimH: number): Size {
  return { w: trimW * 2, h: trimH }
}

type Size = { w: number; h: number }

/**
 * 纸纹一致性判定。
 *
 * 约定：订单纸纹相对【成品长边】；母版纸纹相对【母版长边】。
 * 同一纸张纤维方向在物理上是唯一的，因此展开书帖在母版上的摆放必须让
 * 成品长边与母版长边的平行关系匹配两者的纸纹：
 * - 两者纸纹相同（都顺纹 long / 都横纹 short）：成品长边必须平行母版长边；
 * - 两者纸纹不同：成品长边必须垂直母版长边（需要旋转 90°，且订单允许旋转）。
 *
 * @param orderGrain   订单纸纹（相对成品长边）
 * @param masterGrain  母版纸纹（相对母版长边）
 * @param trimW        成品宽（书口方向）
 * @param trimH        成品高
 * @param rotated90    展开书帖是否相对正放旋转了 90°
 *
 * 成品长边 = max(trimW*2 展开宽, trimH) 所在方向。
 */
export function grainConsistent(
  orderGrain: 'long' | 'short',
  masterGrain: 'long' | 'short',
  trimW: number,
  trimH: number,
  rotated90: boolean,
): boolean {
  // 成品长边：未旋转书帖中沿 trimH 方向（竖向）；横版成品长边沿页宽方向。
  // 注意用【成品页】尺寸而非展开尺寸（2*trimW）判断长边。
  const productLongIsVertical = trimH >= trimW
  // 整个书帖旋转 90° 后，成品长边方向对调
  const longParallelMasterLong =
    productLongIsVertical === rotated90 // 竖边长边旋转后变水平，即平行母版长边
  // 母版已规范化为 width>=height，母版长边恒为水平方向
  // 纤维方向一致 ⇔ （两者纸纹相同 ⇔ 成品长边平行母版长边）
  return orderGrain === masterGrain
    ? longParallelMasterLong
    : !longParallelMasterLong
}

/**
 * 返回满足纸纹要求时是否必须旋转 90°。
 * 若两个朝向都无法满足（理论上不会，旋转总能切换平行关系），返回 null。
 */
export function requiredRotation(
  orderGrain: 'long' | 'short',
  masterGrain: 'long' | 'short',
  trimW: number,
  trimH: number,
): boolean | null {
  for (const rotated of [false, true] as const) {
    if (grainConsistent(orderGrain, masterGrain, trimW, trimH, rotated)) {
      return rotated
    }
  }
  return null
}

/** 规范化母版：保证 widthMm >= heightMm（长边为水平方向） */
export function normalizeMaster(master: MasterSheet): MasterSheet {
  if (master.widthMm >= master.heightMm) return master
  // 交换宽高时，水平/竖直纸纹语义互换
  const swappedGrain = master.grain
  return {
    ...master,
    widthMm: master.heightMm,
    heightMm: master.widthMm,
    grain: swappedGrain,
  }
}

/** 两点距离（刀路长度等用） */
export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
