// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

async function renderApp() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<App />)
  })
  return { container, root }
}

describe('App 集成冒烟', () => {
  it('首屏渲染内置 16 页手册、4 张纸', async () => {
    const { container } = await renderApp()
    expect(container.textContent).toContain('画册拼版台')
    expect(container.textContent).toContain('4 张纸')
    // 标准骑马钉配对：第一张正面 16 | 1
    expect(container.textContent).toContain('装订边')
  })

  it('切换短边翻面后背面真实重排：出现 180° 旋转标记', async () => {
    const { container } = await renderApp()
    const before = container.textContent
    expect(before).not.toContain('短边翻面 · 旋转180°')

    await act(async () => {
      const btn = [
        ...container.querySelectorAll<HTMLButtonElement>('.flip-toggle button'),
      ].find((b) => b.textContent?.includes('短边'))!
      btn.click()
    })

    expect(container.textContent).toContain('短边翻面 · 旋转180°')
    expect(container.textContent).toContain('↓ 180°')
  })

  it('删除一页后自动补白，并持久化编辑与翻面方式', async () => {
    const { container } = await renderApp()

    await act(async () => {
      const del = container.querySelector<HTMLButtonElement>(
        '.page-card .icon-btn.red',
      )!
      del.click()
    })
    await act(async () => {
      const btn = [
        ...container.querySelectorAll<HTMLButtonElement>('.flip-toggle button'),
      ].find((b) => b.textContent?.includes('短边'))!
      btn.click()
    })

    expect(container.textContent).toContain('自动补白')
    const saved = JSON.parse(localStorage.getItem('imposition-studio:v1')!)
    expect(saved.pages).toHaveLength(15)
    expect(saved.flip).toBe('short')
    expect(saved.version).toBe(1)
  })

  it('刷新后（重新挂载）恢复本地状态', async () => {
    const first = await renderApp()
    await act(async () => {
      const btn = [
        ...first.container.querySelectorAll<HTMLButtonElement>('.flip-toggle button'),
      ].find((b) => b.textContent?.includes('短边'))!
      btn.click()
    })

    const second = await renderApp()
    expect(second.container.textContent).toContain('短边翻面 · 旋转180°')
  })
})
