import type { GripperEdge, MasterSheet, PressFlip, PressMode } from '../../lib/gangrun'

interface Props {
  master: MasterSheet
  onChange: (patch: Partial<MasterSheet>) => void
  onAddDeadZone: () => void
  onDeleteDeadZone: (id: string) => void
  onUpdateDeadZone: (id: string, patch: Partial<MasterSheet['deadZones'][number]>) => void
}

const PRESETS: Array<[string, number, number]> = [
  ['大度对开 860×590', 860, 590],
  ['正度对开 787×546', 787, 546],
  ['A2 594×420', 594, 420],
  ['A1 841×594', 841, 594],
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="gr-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export default function MasterPanel({ master, onChange, onAddDeadZone, onDeleteDeadZone, onUpdateDeadZone }: Props) {
  return (
    <div className="panel gr-master-panel">
      <h2>母版与上机设置</h2>
      <div className="hint">
        选择母版纸张、咬口位置与宽度、禁印区与印刷方式。咬口条带与禁印区两面都不可印，
        背面视角会随翻面自动镜像。
      </div>

      <div className="gr-grid">
        <Field label="母版预设">
          <select
            defaultValue=""
            onChange={(e) => {
              const p = PRESETS.find(([n]) => n === e.target.value)
              if (p) onChange({ name: p[0], widthMm: p[1], heightMm: p[2] })
            }}
          >
            <option value="" disabled>选择规格…</option>
            {PRESETS.map(([n]) => <option key={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="母版名称">
          <input value={master.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="纸宽 mm">
          <input type="number" min={1} value={master.widthMm}
            onChange={(e) => onChange({ widthMm: Math.max(1, Number(e.target.value)) })} />
        </Field>
        <Field label="纸高 mm">
          <input type="number" min={1} value={master.heightMm}
            onChange={(e) => onChange({ heightMm: Math.max(1, Number(e.target.value)) })} />
        </Field>
        <Field label="咬口位置">
          <select value={master.gripperEdge} onChange={(e) => onChange({ gripperEdge: e.target.value as GripperEdge })}>
            <option value="top">上边（进纸边）</option>
            <option value="bottom">下边</option>
            <option value="left">左边</option>
            <option value="right">右边</option>
          </select>
        </Field>
        <Field label="咬口宽 mm">
          <input type="number" min={0} value={master.gripperMm}
            onChange={(e) => onChange({ gripperMm: Math.max(0, Number(e.target.value)) })} />
        </Field>
        <Field label="印刷方式">
          <select value={master.pressMode} onChange={(e) => onChange({ pressMode: e.target.value as PressMode })}>
            <option value="perfector">双面印刷（正反套印）</option>
            <option value="single">单面印刷</option>
          </select>
        </Field>
        <Field label="翻面方式">
          <select value={master.flip} onChange={(e) => onChange({ flip: e.target.value as PressFlip })}>
            <option value="long-edge">长边翻转（左右翻）</option>
            <option value="short-edge">短边翻转（上下翻）</option>
          </select>
        </Field>
        <Field label="印数步进">
          <input type="number" min={1} value={master.runStep}
            onChange={(e) => onChange({ runStep: Math.max(1, Number(e.target.value)) })} />
        </Field>
        <Field label="允许旋转 90°">
          <input type="checkbox" checked={master.allowRotation}
            onChange={(e) => onChange({ allowRotation: e.target.checked })} />
        </Field>
      </div>

      <div className="gr-deadzones">
        <div className="gr-dz-head">
          <b>禁印区（{master.deadZones.length}）</b>
          <button className="btn" onClick={onAddDeadZone}>＋ 添加禁印区</button>
        </div>
        {master.deadZones.map((dz) => (
          <div key={dz.id} className="gr-dz-row">
            <span>x</span>
            <input type="number" value={dz.xMm} onChange={(e) => onUpdateDeadZone(dz.id, { xMm: Number(e.target.value) })} />
            <span>y</span>
            <input type="number" value={dz.yMm} onChange={(e) => onUpdateDeadZone(dz.id, { yMm: Number(e.target.value) })} />
            <span>宽</span>
            <input type="number" value={dz.widthMm} onChange={(e) => onUpdateDeadZone(dz.id, { widthMm: Math.max(1, Number(e.target.value)) })} />
            <span>高</span>
            <input type="number" value={dz.heightMm} onChange={(e) => onUpdateDeadZone(dz.id, { heightMm: Math.max(1, Number(e.target.value)) })} />
            <button className="icon-btn red" onClick={() => onDeleteDeadZone(dz.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
