import type {
  BookIssue,
  BookPage,
  FlipMode,
  FoldLocation,
  PlacedPage,
  Sheet,
  SheetSide,
} from '../types'

/** 出血不足阈值（毫米） */
export const MIN_BLEED_MM = 3

let idCounter = 0
/** 生成稳定可读的 id（测试环境不依赖 crypto） */
export function nextId(prefix = 'p'): string {
  idCounter += 1
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

/**
 * 补白：骑马钉每张纸对折产生 4 个书页，总页数必须是 4 的倍数。
 * 不足的空白页补在【封底之前】，保证封底仍在全书最末。
 */
export function padPages(pages: BookPage[]): PlacedPage[] {
  if (pages.length === 0) return []
  const remainder = pages.length % 4
  const blanksNeeded = remainder === 0 ? 0 : 4 - remainder

  const makeBlank = (readingIndex: number): PlacedPage => ({
    id: null,
    title: '空白页',
    sourcePage: null,
    bleedMm: 0,
    upsideDown: false,
    color: '#f4f4f5',
    blank: true,
    readingIndex,
  })

  if (blanksNeeded === 0) {
    return pages.map((p, i) => toPlaced(p, i + 1))
  }

  // 最后一张用户页视为封底，空白插在它之前
  const backCover = pages[pages.length - 1]
  const front = pages.slice(0, -1)
  const result: PlacedPage[] = front.map((p, i) => toPlaced(p, i + 1))
  for (let b = 0; b < blanksNeeded; b += 1) {
    result.push(makeBlank(result.length + 1))
  }
  result.push(toPlaced(backCover, result.length + 1))
  return result
}

function toPlaced(p: BookPage, readingIndex: number): PlacedPage {
  return {
    id: p.id,
    title: p.title,
    sourcePage: p.sourcePage,
    bleedMm: p.bleedMm,
    upsideDown: p.upsideDown,
    color: p.color,
    blank: false,
    readingIndex,
  }
}

/**
 * 生成印张拼版方案。
 *
 * 约定（从印刷厂视角直视每张纸的某一面）：
 * - 第 k 张（0 起，0 为最外层）包住的 4 个阅读位置：
 *   正面 [N-2k | 2k+1]，背面 [2k+2 | N-2k-1]
 *   即正面左半为靠封底一侧、右半为靠封面一侧（中间是竖向折线/装订边）。
 * - 长边翻转：背面横向翻面，槽位正立 (rotation=0)。
 * - 短边翻转（tumble）：背面相对长边版面整体旋转 180°，
 *   因此左右槽位互换且每个槽位 rotation=180 —— 不只是标签变化。
 */
export function buildSheets(placed: PlacedPage[], flip: FlipMode): Sheet[] {
  const n = placed.length
  if (n % 4 !== 0) {
    throw new Error(`页数 ${n} 不是 4 的倍数，请先补白`)
  }
  const sheetCount = n / 4
  const sheets: Sheet[] = []

  for (let k = 0; k < sheetCount; k += 1) {
    const front: Sheet['front'] = {
      side: 'front',
      slots: [
        { pos: 'left', rotation: 0, page: placed[n - 2 * k - 1] },
        { pos: 'right', rotation: 0, page: placed[2 * k] },
      ],
    }

    const backSlots: SheetSide['slots'] =
      flip === 'long'
        ? [
            { pos: 'left', rotation: 0, page: placed[2 * k + 1] },
            { pos: 'right', rotation: 0, page: placed[n - 2 * k - 2] },
          ]
        : [
            // tumble：背面版面相对长边旋转 180°，左右槽位互换且均旋转 180
            { pos: 'left', rotation: 180, page: placed[n - 2 * k - 2] },
            { pos: 'right', rotation: 180, page: placed[2 * k + 1] },
          ]
    const back: SheetSide = { side: 'back', slots: backSlots }

    sheets.push({ sheetIndex: k, front, back })
  }
  return sheets
}

/**
 * 折叠后的成书阅读顺序：把每个阅读位置映射回它所在的印张/面/槽位，
 * 并计算读者翻开后看到的真实朝向。
 *
 * 背面在短边翻面对，版面上旋转 180° 的页面经上下翻页后对读者反而正立；
 * 因此背面需要按翻面方式做一次几何抵消，再叠加来稿自身的倒置。
 */
export function buildFoldOrder(sheets: Sheet[], flip: FlipMode): FoldLocation[] {
  const locations: FoldLocation[] = []

  for (const sheet of sheets) {
    for (const sideName of ['front', 'back'] as const) {
      const side = sheet[sideName]
      for (const slot of side.slots) {
        const backCorrection =
          sideName === 'back' && flip === 'short' ? 180 : 0
        const printed = slot.rotation + backCorrection
        const readingOrientation = (
          (printed % 360) + (slot.page.upsideDown ? 180 : 0)
        ) % 360 as 0 | 180

        locations.push({
          readingIndex: slot.page.readingIndex,
          sheetIndex: sheet.sheetIndex,
          side: sideName,
          pos: slot.pos,
          rotation: slot.rotation,
          readingOrientation: readingOrientation as 0 | 180,
          page: slot.page,
        })
      }
    }
  }

  return locations.sort((a, b) => a.readingIndex - b.readingIndex)
}

/** 全书问题检测：补白、重复源页号、跳号缺页、来稿倒置、出血不足 */
export function detectIssues(pages: BookPage[], placed: PlacedPage[]): BookIssue[] {
  const issues: BookIssue[] = []

  for (const p of placed) {
    if (p.blank) {
      issues.push({
        level: 'info',
        kind: 'blank',
        readingIndex: p.readingIndex,
        message: `第 ${p.readingIndex} 页为自动补入的空白页（封底前补白）`,
      })
      continue
    }
    if (p.upsideDown) {
      issues.push({
        level: 'warning',
        kind: 'inverted',
        readingIndex: p.readingIndex,
        message: `《${p.title}》来稿方向倒置，拼版后读者看到的是倒页`,
      })
    }
    if (p.bleedMm < MIN_BLEED_MM) {
      issues.push({
        level: 'warning',
        kind: 'bleed',
        readingIndex: p.readingIndex,
        message: `《${p.title}》出血 ${p.bleedMm}mm，不足 ${MIN_BLEED_MM}mm`,
      })
    }
  }

  const sourceCounts = new Map<number, number>()
  for (const p of pages) {
    sourceCounts.set(p.sourcePage, (sourceCounts.get(p.sourcePage) ?? 0) + 1)
  }
  for (const p of placed.filter((x) => !x.blank)) {
    if ((sourceCounts.get(p.sourcePage!) ?? 0) > 1) {
      issues.push({
        level: 'error',
        kind: 'duplicate',
        readingIndex: p.readingIndex,
        message: `《${p.title}》与其他页面重复使用了源稿第 ${p.sourcePage} 页`,
      })
    }
  }

  const used = [...sourceCounts.keys()].sort((a, b) => a - b)
  if (used.length > 0) {
    const maxPage = used[used.length - 1]
    for (let s = 1; s <= maxPage; s += 1) {
      if (!sourceCounts.has(s)) {
        issues.push({
          level: 'error',
          kind: 'missing-source',
          message: `源稿缺第 ${s} 页（存在跳号，最多到第 ${maxPage} 页）`,
        })
      }
    }
  }

  const order: Record<BookIssue['level'], number> = {
    error: 0,
    warning: 1,
    info: 2,
  }
  return issues.sort(
    (a, b) =>
      order[a.level] - order[b.level] ||
      (a.readingIndex ?? 0) - (b.readingIndex ?? 0),
  )
}

/** 一次算好全部派生数据 */
export function impose(pages: BookPage[], flip: FlipMode) {
  const placed = padPages(pages)
  const sheets = buildSheets(placed, flip)
  const foldOrder = buildFoldOrder(sheets, flip)
  const issues = detectIssues(pages, placed)
  return { placed, sheets, foldOrder, issues }
}
