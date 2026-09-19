/** 纸张、母版与内置示例订单目录 */
import type { GangOrder, MasterSheet, PaperGrade } from './types'

export const PAPER_GRADES: Record<
  PaperGrade,
  { label: string; gsm: number; /** 每平米单价（元） */ pricePerM2: number }
> = {
  'coated-157': { label: '铜版纸 157g', gsm: 157, pricePerM2: 0.82 },
  'coated-200': { label: '铜版纸 200g', gsm: 200, pricePerM2: 1.05 },
  'uncoated-120': { label: '胶版纸 120g', gsm: 120, pricePerM2: 0.66 },
  'uncoated-250': { label: '白卡 250g', gsm: 250, pricePerM2: 1.35 },
}

/** 单张母版纸价（元）= 面积(m²) × 克重品种单价 */
export function sheetPrice(master: MasterSheet): number {
  const m2 = (master.widthMm * master.heightMm) / 1_000_000
  return Math.round(m2 * PAPER_GRADES[master.grade].pricePerM2 * 100) / 100
}

/** 每色每套晒版/换版成本（元）；正反版需正反两套版 */
export const PLATE_COST = 80

/** 常用上机母版（widthMm 已保证 ≥ heightMm） */
export const MASTER_PRESETS: MasterSheet[] = [
  {
    id: 'ms-dadu',
    name: '大度对开 889×597',
    widthMm: 889,
    heightMm: 597,
    grade: 'coated-157',
    grain: 'long',
  },
  {
    id: 'ms-zhengdu',
    name: '正度对开 787×546',
    widthMm: 787,
    heightMm: 546,
    grade: 'coated-157',
    grain: 'long',
  },
  {
    id: 'ms-a2plus',
    name: 'A2+ 数码纸 640×460',
    widthMm: 640,
    heightMm: 460,
    grade: 'coated-157',
    grain: 'long',
  },
]

/** 内置三个不同尺寸与印数的合版订单示例 */
export function createSampleOrders(): GangOrder[] {
  return [
    {
      id: 'sample-a',
      name: '文旅画册 · A4',
      color: '#2f5bd8',
      trimW: 210,
      trimH: 285,
      signatures: 4,
      run: 300,
      paper: 'coated-157',
      grain: 'long',
      allowOvers: 30,
      dueDate: isoDate(7),
      allowRotate: true,
      verified: true,
    },
    {
      id: 'sample-b',
      name: '艺术展刊 · 200×260',
      color: '#d2691e',
      trimW: 200,
      trimH: 260,
      signatures: 6,
      run: 120,
      paper: 'coated-157',
      grain: 'short',
      allowOvers: 20,
      dueDate: isoDate(3),
      allowRotate: true,
      verified: true,
    },
    {
      id: 'sample-c',
      name: '产品小册 · 140×210',
      color: '#2f8f5b',
      trimW: 140,
      trimH: 210,
      signatures: 3,
      run: 360,
      paper: 'coated-157',
      grain: 'long',
      allowOvers: 40,
      dueDate: isoDate(10),
      allowRotate: true,
      verified: true,
    },
  ]
}

/** 示例禁印区（母版边角色差测控条占位） */
export function createSampleForbidden(): import('./types').ForbiddenZone[] {
  return [
    {
      id: 'fz-colorbar',
      name: '测控条',
      rect: { x: 760, y: 565, w: 120, h: 24 },
      mirrorToBack: true,
    },
  ]
}

function isoDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}
