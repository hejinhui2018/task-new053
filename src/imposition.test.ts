import { describe, expect, it } from 'vitest'
import type { BookPage, FlipMode } from './types'
import {
  MIN_BLEED_MM,
  buildFoldOrder,
  buildSheets,
  detectIssues,
  impose,
  padPages,
} from './lib/imposition'

function makePages(count: number, overrides: Partial<BookPage> = {}): BookPage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id_${i + 1}`,
    title: `第${i + 1}页`,
    sourcePage: i + 1,
    bleedMm: 3,
    upsideDown: false,
    color: '#eeeeee',
    ...overrides,
  }))
}

describe('padPages 补白', () => {
  it('页数已是 4 的倍数时不补白', () => {
    const placed = padPages(makePages(16))
    expect(placed).toHaveLength(16)
    expect(placed.every((p) => !p.blank)).toBe(true)
    expect(placed.map((p) => p.readingIndex)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    )
  })

  it.each([
    [13, 3],
    [14, 2],
    [15, 1],
    [17, 3],
  ])('%d 页时补到 4 的倍数（补 %d 页）', (input, blanks) => {
    const placed = padPages(makePages(input))
    expect(placed).toHaveLength(input + blanks)
    expect(placed.filter((p) => p.blank)).toHaveLength(blanks)
  })

  it('空白页补在封底【之前】，封底仍是全书最后一页', () => {
    const pages = makePages(14)
    pages[pages.length - 1].title = '封底'
    const placed = padPages(pages)
    expect(placed).toHaveLength(16)
    expect(placed[15].title).toBe('封底')
    expect(placed[15].blank).toBe(false)
    // 阅读位置 14、15 是空白，封底在 16
    expect(placed.slice(13, 15).every((p) => p.blank)).toBe(true)
    expect(placed[12].blank).toBe(false)
  })

  it('补白页带正确的阅读位置', () => {
    const placed = padPages(makePages(15))
    expect(placed[14]).toMatchObject({ blank: true, readingIndex: 15 })
    expect(placed[15]).toMatchObject({ blank: false, readingIndex: 16 })
  })

  it('空页面列表安全返回空数组', () => {
    expect(padPages([])).toEqual([])
    expect(buildSheets([], 'long')).toEqual([])
    expect(buildFoldOrder([], 'long')).toEqual([])
  })
})

describe('buildSheets 页码配对', () => {
  const n = 16
  const placed = padPages(makePages(n))

  it('长边翻转：16 页骑马钉标准配对', () => {
    const sheets = buildSheets(placed, 'long')
    expect(sheets).toHaveLength(4)
    const nums = sheets.map((s) => [
      s.front.slots.map((x) => x.page.readingIndex),
      s.back.slots.map((x) => x.page.readingIndex),
    ])
    expect(nums).toEqual([
      [[16, 1], [2, 15]],
      [[14, 3], [4, 13]],
      [[12, 5], [6, 11]],
      [[10, 7], [8, 9]],
    ])
  })

  it('所有阅读位置 1..N 在印张上恰好出现一次', () => {
    for (const n of [4, 8, 12, 16, 20]) {
      const p = padPages(makePages(n))
      const sheets = buildSheets(p, 'long')
      const all = sheets.flatMap((s) =>
        [s.front, s.back].flatMap((side) => side.slots.map((x) => x.page.readingIndex)),
      )
      expect(all.sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1))
    }
  })

  it('页数不是 4 的倍数直接抛错（必须先补白）', () => {
    const odd = makePages(13).map((p, i) => ({ ...p, readingIndex: i + 1, blank: false, id: p.id, sourcePage: p.sourcePage }))
    expect(() => buildSheets(odd as never, 'long')).toThrow()
  })

  it('正面装订边在两个槽位之间（折线居中），正面左右槽位均为正立', () => {
    const sheets = buildSheets(placed, 'long')
    for (const s of sheets) {
      expect(s.front.slots[0].pos).toBe('left')
      expect(s.front.slots[1].pos).toBe('right')
      expect(s.front.slots[0].rotation).toBe(0)
      expect(s.front.slots[1].rotation).toBe(0)
    }
  })
})

describe('双面翻转（长边 vs 短边）', () => {
  const placed = padPages(makePages(16))

  it('长边翻转：背面槽位正立，顺序 [2 | N-1]', () => {
    const back = buildSheets(placed, 'long')[0].back
    expect(back.slots.map((x) => x.page.readingIndex)).toEqual([2, 15])
    expect(back.slots.every((x) => x.rotation === 0)).toBe(true)
  })

  it('短边翻转：背面不仅标签变化——槽位互换且全部旋转 180°', () => {
    const long = buildSheets(placed, 'long')
    const short = buildSheets(placed, 'short')

    const longBack = long[0].back.slots.map((x) => x.page.readingIndex)
    const shortBack = short[0].back.slots.map((x) => x.page.readingIndex)

    // 排列立即更新：左右互换
    expect(shortBack).toEqual([...longBack].reverse())
    // 每个槽位都旋转 180
    expect(short[0].back.slots.every((x) => x.rotation === 180)).toBe(true)
    expect(long[0].back.slots.every((x) => x.rotation === 0)).toBe(true)

    // 正面两种翻面方式完全一致
    for (let k = 0; k < 4; k += 1) {
      expect(short[k].front).toEqual(long[k].front)
      expect(short[k].back.slots.map((x) => x.page.readingIndex))
        .toEqual([...long[k].back.slots.map((x) => x.page.readingIndex)].reverse())
      expect(short[k].back.slots.every((x) => x.rotation === 180)).toBe(true)
    }
  })

  it('两种翻面下包含的页面集合相同，只是几何摆放不同', () => {
    const collect = (flip: FlipMode) =>
      buildSheets(placed, flip)
        .flatMap((s) => s.back.slots.map((x) => x.page.readingIndex))
        .sort((a, b) => a - b)
    expect(collect('short')).toEqual(collect('long'))
  })
})

describe('折叠后阅读顺序', () => {
  it('折叠后严格按 1..N 阅读，封面在前封底在后', () => {
    for (const flip of ['long', 'short'] as FlipMode[]) {
      const placed = padPages(makePages(16))
      const order = buildFoldOrder(buildSheets(placed, flip), flip)
      expect(order.map((o) => o.readingIndex)).toEqual(
        Array.from({ length: 16 }, (_, i) => i + 1),
      )
      expect(order[0].page.readingIndex).toBe(1)
      expect(order[15].page.readingIndex).toBe(16)
    }
  })

  it('长边翻转：所有正常来稿折叠后朝向正立', () => {
    const placed = padPages(makePages(16))
    const order = buildFoldOrder(buildSheets(placed, 'long'), 'long')
    expect(order.every((o) => o.readingOrientation === 0)).toBe(true)
  })

  it('短边翻转：旋转 180° 的背面经上下翻页抵消，读者看到的仍是正立页', () => {
    const placed = padPages(makePages(16))
    const order = buildFoldOrder(buildSheets(placed, 'short'), 'short')
    expect(order.every((o) => o.readingOrientation === 0)).toBe(true)
  })

  it('来稿自身倒置时，阅读朝向标记为 180（倒置检测）', () => {
    const pages = makePages(16)
    pages[4].upsideDown = true
    const placed = padPages(pages)
    const order = buildFoldOrder(buildSheets(placed, 'long'), 'long')
    const bad = order.find((o) => o.readingIndex === 5)
    expect(bad?.readingOrientation).toBe(180)
    expect(order.filter((o) => o.readingOrientation === 180)).toHaveLength(1)
  })

  it('补白页也出现在折叠顺序中且正立', () => {
    const placed = padPages(makePages(14))
    const order = buildFoldOrder(buildSheets(placed, 'long'), 'long')
    expect(order).toHaveLength(16)
    expect(order.filter((o) => o.page.blank)).toHaveLength(2)
    expect(order.every((o) => o.readingOrientation === 0)).toBe(true)
  })
})

describe('问题检测 detectIssues', () => {
  it('发现重复源页号', () => {
    const pages = makePages(16)
    pages[5].sourcePage = 3 // 与第 3 页重复
    const placed = padPages(pages)
    const issues = detectIssues(pages, placed)
    const dup = issues.filter((i) => i.kind === 'duplicate')
    expect(dup.length).toBeGreaterThan(0)
    expect(dup.every((i) => i.level === 'error')).toBe(true)
  })

  it('发现源稿跳号（缺页）', () => {
    const pages = makePages(16)
    pages[7].sourcePage = 9 // 占用 9，原来的 8 缺失；后续 8..15 号页也会连环缺
    const placed = padPages(pages)
    const issues = detectIssues(pages, placed)
    expect(issues.some((i) => i.kind === 'missing-source')).toBe(true)
  })

  it('出血不足给出警告', () => {
    const pages = makePages(16)
    pages[0].bleedMm = MIN_BLEED_MM - 1
    const placed = padPages(pages)
    const issues = detectIssues(pages, placed)
    expect(issues.some((i) => i.kind === 'bleed' && i.readingIndex === 1)).toBe(true)
  })

  it('自动补白页给出提示信息', () => {
    const pages = makePages(15)
    const placed = padPages(pages)
    const issues = detectIssues(pages, placed)
    expect(issues.some((i) => i.kind === 'blank')).toBe(true)
  })

  it('正常 16 页手册无 error/warning', () => {
    const pages = makePages(16)
    const { issues } = impose(pages, 'long')
    expect(issues.filter((i) => i.level !== 'info')).toHaveLength(0)
  })
})
