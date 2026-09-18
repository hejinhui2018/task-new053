/** 拼版领域模型 */

/** 翻面方式：长边翻转（普通书左右翻）/ 短边翻转（挂历式上下翻） */
export type FlipMode = 'long' | 'short'

export type Side = 'front' | 'back'
export type SlotPos = 'left' | 'right'

/** 左侧栏中由用户维护的一个书页（客户稿件） */
export interface BookPage {
  id: string
  /** 栏目标题，如“封面 / 目录 / 封底” */
  title: string
  /** 客户源文件上标注的页码（1 起）；重排时随内容走，重复或跳号会被检测 */
  sourcePage: number
  /** 出血（毫米），低于阈值会提示出血不足 */
  bleedMm: number
  /** 客户来稿本身是否倒置 */
  upsideDown: boolean
  /** 缩略图标识色 */
  color: string
}

/** 补齐到 4 的倍数之后、成书阅读序列中的一页 */
export interface PlacedPage {
  /** 关联 BookPage.id；补白页为 null */
  id: string | null
  title: string
  sourcePage: number | null
  bleedMm: number
  upsideDown: boolean
  color: string
  /** 是否为自动补入的空白页 */
  blank: boolean
  /** 成书阅读位置，1 起（封面 = 1，封底 = N） */
  readingIndex: number
}

export interface PageSlot {
  pos: SlotPos
  /** 印版上该槽位的摆放旋转（版面坐标，0 / 180） */
  rotation: 0 | 180
  page: PlacedPage
}

export interface SheetSide {
  side: Side
  /** [左槽, 右槽]，均以“直视该印刷面”为视角 */
  slots: [PageSlot, PageSlot]
}

/** 一张对折印张（= 4 个书页） */
export interface Sheet {
  /** 0 = 最外层（含封面/封底），向内递增 */
  sheetIndex: number
  front: SheetSide
  back: SheetSide
}

/** 折叠预演中，某个阅读位置对应的物理槽位 */
export interface FoldLocation {
  readingIndex: number
  sheetIndex: number
  side: Side
  pos: SlotPos
  /** 版面上的摆放旋转 */
  rotation: 0 | 180
  /** 成书翻开后读者看到的最终朝向，0 为正立 */
  readingOrientation: 0 | 180
  page: PlacedPage
}

export type IssueLevel = 'error' | 'warning' | 'info'
export type IssueKind =
  | 'blank'
  | 'duplicate'
  | 'missing-source'
  | 'inverted'
  | 'bleed'

export interface BookIssue {
  level: IssueLevel
  kind: IssueKind
  /** 成书阅读位置（如有） */
  readingIndex?: number
  sheetIndex?: number
  message: string
}

/** 需要持久化的整体状态 */
export interface StudioState {
  version: 1
  pages: BookPage[]
  flip: FlipMode
  /** 折叠预演翻开位置：0=封面，N/2=封底，中间为 [2v, 2v+1] 跨页 */
  spread: number
  /** 单张折叠动画选中的印张序号 */
  foldSheet: number
}
