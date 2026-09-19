import { useEffect, useMemo, useState } from 'react'
import PageList from './components/PageList'
import SheetView from './components/SheetView'
import FoldPreview from './components/FoldPreview'
import GangWorkspace from './components/gang/GangWorkspace'
import { impose, nextId } from './lib/imposition'
import { clearState, createDefaultBrochure, loadState, saveState } from './lib/storage'
import type { BookPage, FlipMode } from './types'

const ADD_COLORS = ['#e8eef7', '#fdeee8', '#e9f6ee', '#f4ecf7', '#fbf3dd', '#e6f4f5']

type View = 'book' | 'gang'

export default function App() {
  const [view, setView] = useState<View>('book')
  const initial = useMemo(() => loadState(), [])
  const [pages, setPages] = useState<BookPage[]>(
    () => initial?.pages ?? createDefaultBrochure(),
  )
  const [flip, setFlip] = useState<FlipMode>(initial?.flip ?? 'long')
  const [spread, setSpread] = useState(initial?.spread ?? 0)
  const [foldSheet, setFoldSheet] = useState(initial?.foldSheet ?? 0)

  const { placed, sheets, foldOrder, issues } = useMemo(
    () => impose(pages, flip),
    [pages, flip],
  )

  // 页面数变化后，夹紧预演位置
  const total = placed.length
  const safeSpread = total === 0 ? 0 : Math.min(Math.max(0, spread), total / 2)
  const safeFoldSheet = sheets.length === 0 ? 0 : Math.min(Math.max(0, foldSheet), sheets.length - 1)

  // 编辑与预演位置持久化到浏览器本地
  useEffect(() => {
    saveState({ version: 1, pages, flip, spread: safeSpread, foldSheet: safeFoldSheet })
  }, [pages, flip, safeSpread, safeFoldSheet])

  useEffect(() => {
    if (safeSpread !== spread) setSpread(safeSpread)
    if (safeFoldSheet !== foldSheet) setFoldSheet(safeFoldSheet)
  }, [safeSpread, safeFoldSheet, spread, foldSheet])

  const movePage = (draggedId: string, insertAt: number) => {
    setPages((prev) => {
      const from = prev.findIndex((p) => p.id === draggedId)
      if (from < 0) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      const target = from < insertAt ? insertAt - 1 : insertAt
      next.splice(Math.max(0, Math.min(target, next.length)), 0, item)
      return next
    })
  }

  const addPage = () => {
    setPages((prev) => {
      const maxSource = prev.reduce((m, p) => Math.max(m, p.sourcePage), 0)
      const page: BookPage = {
        id: nextId('new'),
        title: `新增页面 ${maxSource + 1}`,
        sourcePage: maxSource + 1,
        bleedMm: 3,
        upsideDown: false,
        color: ADD_COLORS[prev.length % ADD_COLORS.length],
      }
      return [...prev, page]
    })
  }

  const deletePage = (id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id))
  }

  const updatePage = (id: string, patch: Partial<BookPage>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const resetAll = () => {
    if (!window.confirm('恢复为内置 16 页产品手册？当前编辑会被清除。')) return
    clearState()
    setPages(createDefaultBrochure())
    setFlip('long')
    setSpread(0)
    setFoldSheet(0)
  }

  // 阅读位置 -> 问题（供左侧卡片角标）
  const issuesByReading = useMemo(() => {
    const map = new Map<number, { level: 'error' | 'warning' | 'info'; text: string }[]>()
    for (const issue of issues) {
      if (!issue.readingIndex) continue
      const arr = map.get(issue.readingIndex) ?? []
      const text =
        issue.kind === 'duplicate' ? '重复页'
        : issue.kind === 'inverted' ? '倒置'
        : issue.kind === 'bleed' ? '出血不足'
        : issue.kind === 'blank' ? '补白'
        : issue.message
      arr.push({ level: issue.level, text })
      map.set(issue.readingIndex, arr)
    }
    return map
  }, [issues])

  const badgesForId = (id: string) => {
    const p = placed.find((x) => x.id === id)
    return p ? (issuesByReading.get(p.readingIndex) ?? []) : []
  }

  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.filter((i) => i.level === 'warning').length

  return (
    <>
      <header className="app-header">
        <h1>画册拼版台</h1>
        <div className="view-toggle" role="group" aria-label="工作区切换">
          <button className={view === 'book' ? 'active' : ''} onClick={() => setView('book')}>
            单本拼版
          </button>
          <button className={view === 'gang' ? 'active' : ''} onClick={() => setView('gang')}>
            多订单合版
          </button>
        </div>
        {view === 'book' && (
          <>
            <span className="sub">骑马钉 · 送印前印张与折叠预演</span>
            <div className="spacer" />
            <span className="sub">
              来稿 {pages.length} 页 → 成书 {total} 页 · {sheets.length} 张纸
              {errors > 0 && <span style={{ color: 'var(--red)', marginLeft: 8 }}>● {errors} 错误</span>}
              {warnings > 0 && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>● {warnings} 警告</span>}
            </span>
            <div className="flip-toggle" role="group" aria-label="翻面方式">
              <button
                className={flip === 'long' ? 'active' : ''}
                onClick={() => setFlip('long')}
                title="左右翻页（普通书刊）"
              >
                长边翻转
              </button>
              <button
                className={flip === 'short' ? 'active' : ''}
                onClick={() => setFlip('short')}
                title="上下翻页（挂历式），背面整版旋转 180°"
              >
                短边翻转
              </button>
            </div>
            <button className="btn danger" onClick={resetAll}>重置手册</button>
          </>
        )}
        {view === 'gang' && (
          <>
            <span className="sub">多订单 · 同纸同纹合版 · 直线裁切可分离</span>
            <div className="spacer" />
          </>
        )}
      </header>

      {view === 'book' ? (
        <main className="layout">
          <PageList
            pages={pages}
            badgesForId={badgesForId}
            onMove={movePage}
            onAdd={addPage}
            onDelete={deletePage}
            onUpdate={updatePage}
          />
          <SheetView sheets={sheets} />
          <FoldPreview
            sheets={sheets}
            foldOrder={foldOrder}
            issues={issues}
            flip={flip}
            spread={safeSpread}
            onSpreadChange={setSpread}
            foldSheet={safeFoldSheet}
            onFoldSheetChange={setFoldSheet}
          />
        </main>
      ) : (
        <GangWorkspace />
      )}
    </>
  )
}
