// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'

const GANG_KEY = 'imposition-studio:gang:v1'

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

async function gotoGang(container: HTMLElement) {
  await act(async () => {
    const btn = [...container.querySelectorAll<HTMLButtonElement>('.view-toggle button')]
      .find((b) => b.textContent?.includes('多订单合版'))!
    btn.click()
  })
}

/** React 受控输入必须通过原生 setter 赋值才能触发 onChange */
function setInputValue(input: HTMLInputElement, value: string) {
  const proto = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('多订单合版工作区', () => {
  it('切到合版视图：渲染三个样例订单、母版正反面与计划指标', async () => {
    const { container } = await renderApp()
    await gotoGang(container)

    expect(container.textContent).toContain('城市文旅画册')
    expect(container.textContent).toContain('品牌产品手册')
    expect(container.textContent).toContain('展会明信片册')
    // 正反面两个 SVG
    expect(container.querySelectorAll('.gang-svg')).toHaveLength(2)
    expect(container.textContent).toContain('印版套数（换版）')
    expect(container.textContent).toContain('废纸率')
    // 样例共享 500 印次
    expect(container.textContent).toContain('500')
    // 超印 20 + 40 = 60
    expect(container.textContent).toContain('60')
  })

  it('三个样例订单同纸同纹合在一套，印数满足带超印', async () => {
    const { container } = await renderApp()
    await gotoGang(container)
    // 单套排布 ×500 张
    expect(container.textContent).toContain('第 1 套 × 500 张')
    // 印数满足：500/500、500/480 超20、500/460 超40
    expect(container.textContent).toContain('500/480')
    expect(container.textContent).toContain('500/460')
    expect(container.textContent).toContain('超 20')
    expect(container.textContent).toContain('超 40')
  })

  it('母版正反面都绘制订单身份色块与裁切线', async () => {
    const { container } = await renderApp()
    await gotoGang(container)
    // 正面 + 背面各 4 个生产单元 group
    const faces = container.querySelectorAll('.gang-face')
    expect(faces).toHaveLength(2)
    expect(faces[0].querySelectorAll('.gang-unit')).toHaveLength(4)
    expect(faces[1].querySelectorAll('.gang-unit')).toHaveLength(4)
    // 裁切线（贯穿虚线）
    expect(container.querySelectorAll('.gang-cut').length).toBeGreaterThan(0)
    // 咬口标注
    expect(container.textContent).toContain('咬口')
  })

  it('编辑订单后写入 localStorage，刷新重挂载恢复', async () => {
    const first = await renderApp()
    await gotoGang(first.container)
    await act(async () => {
      const input = first.container
        .querySelectorAll<HTMLInputElement>('.gr-name')[0]
      setInputValue(input, '改名后的画册')
    })
    const saved = JSON.parse(localStorage.getItem(GANG_KEY)!)
    expect(saved.orders[0].name).toBe('改名后的画册')
    expect(saved.version).toBe(1)

    const second = await renderApp()
    await gotoGang(second.container)
    expect(second.container.textContent).toContain('改名后的画册')
  })

  it('撤销/重做：撤回验证后撤销恢复', async () => {
    const { container } = await renderApp()
    await gotoGang(container)
    const unitCountText = () =>
      [...container.querySelectorAll('.panel .hint')]
        .map((n) => n.textContent ?? '')
        .find((t) => t.includes('生产单元')) ?? ''
    const before = unitCountText()
    expect(before).toContain('已验证订单 3 个')

    // 撤回第一个订单的验证
    await act(async () => {
      const btn = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.trim() === '撤回验证')!
      btn.click()
    })
    expect(unitCountText()).toContain('已验证订单 2 个')

    // 撤销
    await act(async () => {
      ;[...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('撤销'))!.click()
    })
    expect(unitCountText()).toBe(before)

    // 重做
    await act(async () => {
      ;[...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('重做'))!.click()
    })
    expect(unitCountText()).toContain('已验证订单 2 个')
  })

  it('存为基线后出现 A/B 计划比较表', async () => {
    const { container } = await renderApp()
    await gotoGang(container)
    await act(async () => {
      ;[...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('存为比较基线'))!.click()
    })
    expect(container.textContent).toContain('计划比较（A = 基线 · B = 当前）')
    expect(container.textContent).toContain('两套计划成本持平')
    // 清除基线按钮出现
    expect(container.textContent).toContain('清除基线')
  })

  it('把订单改为草稿后该订单不参与合版且出现提示', async () => {
    const { container } = await renderApp()
    await gotoGang(container)
    await act(async () => {
      ;[...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.trim() === '撤回验证')!.click()
    })
    expect(container.textContent).toContain('草稿订单不参与合版')
  })
})
