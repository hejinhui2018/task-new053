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

function click(container: HTMLElement, selector: string, text?: string) {
  const btns = [...container.querySelectorAll<HTMLButtonElement>(selector)]
  const btn = text ? btns.find((b) => b.textContent?.includes(text))! : btns[0]
  btn.click()
  return btn
}

describe('合版工作台 UI 冒烟', () => {
  it('切换到多单合版：渲染三个示例订单、母版正反面与计划指标', async () => {
    const { container } = await renderApp()
    await act(async () => {
      click(container, '.view-switch button', '多单合版')
    })
    const text = container.textContent!
    expect(text).toContain('多单合版')
    expect(text).toContain('文旅画册')
    expect(text).toContain('艺术展刊')
    expect(text).toContain('产品小册')
    // 正面与背面两个 SVG 面
    expect(container.querySelectorAll('.board-svg')).toHaveLength(2)
    expect(text).toContain('母版用纸')
    expect(text).toContain('废纸率')
    expect(text).toContain('印数满足情况')
    // 三个订单都满足印数
    expect((text.match(/满足/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('切换印刷方式为正反版：换版费按每套正反两块版计', async () => {
    const { container } = await renderApp()
    await act(async () => click(container, '.view-switch button', '多单合版'))
    const before = container.querySelector('.metric-grid')?.textContent ?? ''
    const platesBefore = /(\d+)/.exec(
      [...container.querySelectorAll('.metric')]
        .find((m) => m.textContent?.includes('套版'))!
        .querySelector('.m-value')!.textContent!,
    )![1]

    await act(async () => click(container, '.mode-btn', '正反版'))

    const platesAfter = /(\d+)/.exec(
      [...container.querySelectorAll('.metric')]
        .find((m) => m.textContent?.includes('套版'))!
        .querySelector('.m-value')!.textContent!,
    )![1]
    expect(Number(platesAfter)).toBe(Number(platesBefore) * 2)
    expect(before).toBeTruthy()
  })

  it('存基线后出现对比表，切换策略后能看到差值', async () => {
    const { container } = await renderApp()
    await act(async () => click(container, '.view-switch button', '多单合版'))
    expect(container.textContent).toContain('尚无基线')

    await act(async () => click(container, '.gang-plan-panel button', '存为比较基线'))
    expect(container.querySelector('.compare table')).toBeTruthy()
    expect(container.textContent).toContain('合计（元）')
  })

  it('撤销/重做可用：新建订单进入历史，撤销后订单数还原', async () => {
    const { container } = await renderApp()
    await act(async () => click(container, '.view-switch button', '多单合版'))

    const orderCount = () => container.querySelectorAll('.order-card').length
    expect(orderCount()).toBe(3)
    await act(async () => click(container, '.gang-order-panel button', '新建订单'))
    expect(orderCount()).toBe(4)

    await act(async () => click(container, '.undo-row button', '撤销'))
    expect(orderCount()).toBe(3)
    await act(async () => click(container, '.undo-row button', '重做'))
    expect(orderCount()).toBe(4)
  })

  it('合版工作区持久化到本地，重挂载后恢复（含基线）', async () => {
    const first = await renderApp()
    await act(async () => click(first.container, '.view-switch button', '多单合版'))
    await act(async () => click(first.container, '.gang-order-panel button', '新建订单'))
    await act(async () => click(first.container, '.gang-plan-panel button', '存为比较基线'))

    const saved = JSON.parse(localStorage.getItem('imposition-studio:gang-v1')!)
    expect(saved.version).toBe(1)
    expect(saved.workspace.orders).toHaveLength(4)
    expect(saved.baseline).toBeTruthy()
    expect(localStorage.getItem('imposition-studio:view')).toBe('gang')

    const second = await renderApp()
    await act(async () => click(second.container, '.view-switch button', '多单合版'))
    expect(second.container.querySelectorAll('.order-card').length).toBe(4)
    expect(second.container.querySelector('.compare table')).toBeTruthy()
  })

  it('未验证订单不能上版：取消验证后出现错误并显示未验证标记', async () => {
    const { container } = await renderApp()
    await act(async () => click(container, '.view-switch button', '多单合版'))
    // 打开第一个订单的编辑框
    await act(async () => {
      ;[...container.querySelectorAll<HTMLButtonElement>('.order-card button')]
        .find((b) => b.title === '编辑')!.click()
    })
    await act(async () => {
      const cb = [
        ...container.querySelectorAll<HTMLInputElement>('.order-form input[type=checkbox]'),
      ].find((c) => c.parentElement?.textContent?.includes('书帖已验证'))!
      cb.click()
    })
    const text = container.textContent!
    expect(text).toContain('未验证')
    expect(text).toContain('计划存在错误')
  })
})
