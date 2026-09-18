import type { BookPage, StudioState } from '../types'

/** 内置 16 页产品手册（骑马钉 4 张纸） */
export function createDefaultBrochure(): BookPage[] {
  const palette = [
    '#e8eef7', '#fdeee8', '#e9f6ee', '#f4ecf7',
    '#fbf3dd', '#e6f4f5', '#f3e9e9', '#edeaf4',
  ]
  const titles: Array<[string, number]> = [
    ['封面', 1],
    ['卷首语', 2],
    ['目录', 3],
    ['品牌故事', 4],
    ['产品系列 A', 5],
    ['产品细节', 6],
    ['工艺材质', 7],
    ['应用场景一', 8],
    ['应用场景二', 9],
    ['技术参数', 10],
    ['定制流程', 11],
    ['服务网络', 12],
    ['常见问题', 13],
    ['客户案例', 14],
    ['联系方式', 15],
    ['封底', 16],
  ]
  return titles.map(([title, sourcePage], i) => ({
    id: `seed_${i + 1}`,
    title,
    sourcePage,
    bleedMm: 3,
    upsideDown: false,
    color: palette[i % palette.length],
  }))
}

const STORAGE_KEY = 'imposition-studio:v1'

export function loadState(): StudioState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StudioState
    if (parsed.version !== 1 || !Array.isArray(parsed.pages)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveState(state: StudioState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存储失败（隐私模式等）不影响使用
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
