import { createEffect, createSignal, onMount } from 'solid-js'
import { For } from 'solid-js'
import { api } from '../api/client'
import type { FlushHarvest, GradeAppeal, GradeMix, HarvestGrade, Room } from '../types'

const grades: HarvestGrade[] = ['A', 'B', 'C']

function toLocalInput(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const empty = {
  roomId: '',
  harvestedAt: toLocalInput(),
  flushNo: '1',
  weightKg: '',
  grade: 'A' as HarvestGrade,
  operatorName: '',
}

function GradeBadge(props: { grade: HarvestGrade }) {
  return <span class={`badge grade-${props.grade.toLowerCase()}`}>{props.grade}</span>
}

/** 单条采收的改判表单与各笔改判；失败时展示接口返回的 detail 原文。 */
function AppealBox(props: { harvest: FlushHarvest; onDone: () => Promise<void> }) {
  const otherGrades = () => grades.filter((g) => g !== props.harvest.effectiveGrade)
  const [nextGrade, setNextGrade] = createSignal<HarvestGrade>(otherGrades()[0])
  const [reason, setReason] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  // 有效等级变化后（如刚改判成功），若下拉停在已失效的选项上则切到第一个合法等级
  createEffect(() => {
    if (!otherGrades().includes(nextGrade())) setNextGrade(otherGrades()[0])
  })

  async function submit(e: Event) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api(`/api/flush-harvests/${props.harvest.id}/appeals`, {
        method: 'POST',
        body: JSON.stringify({ nextGrade: nextGrade(), reason: reason() }),
      })
      setReason('')
      await props.onDone()
    } catch (err) {
      // api() 已把响应体里的 detail 原文放进 message
      setError(err instanceof Error ? err.message : '改判失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="appeal-box">
      <div class="appeal-current">
        当前有效等级：<GradeBadge grade={props.harvest.effectiveGrade} />
        <span class="muted">（原等级 {props.harvest.originalGrade}，已改判 {props.harvest.appealCount} 笔）</span>
      </div>

      <form class="appeal-form" onSubmit={submit}>
        <label>
          改判为
          <select value={nextGrade()} onChange={(e) => setNextGrade(e.currentTarget.value as HarvestGrade)}>
            <For each={otherGrades()}>{(g) => <option value={g}>{g}</option>}</For>
          </select>
        </label>
        <label class="appeal-reason">
          理由（去空白后至少 6 字）
          <input
            value={reason()}
            onInput={(e) => setReason(e.currentTarget.value)}
            placeholder="说明改判依据"
            required
          />
        </label>
        <button type="submit" class="btn primary" disabled={busy()}>
          {busy() ? '提交中…' : '提交改判'}
        </button>
      </form>
      {error() && <div class="error">{error()}</div>}

      <ul class="appeal-list">
        <For each={props.harvest.appeals}>
          {(a: GradeAppeal) => (
            <li>
              <GradeBadge grade={a.nextGrade} />
              <span class="appeal-reason-text">{a.reason}</span>
              <span class="muted">{new Date(a.appealedAt).toLocaleString()}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

export default function FlushHarvests() {
  const [rows, setRows] = createSignal<FlushHarvest[]>([])
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [mix, setMix] = createSignal<GradeMix | null>(null)
  const [form, setForm] = createSignal({ ...empty })
  const [error, setError] = createSignal('')
  const [expanded, setExpanded] = createSignal<number | null>(null)

  async function load() {
    const [harvests, roomList, gradeMix] = await Promise.all([
      api<FlushHarvest[]>('/api/flush-harvests'),
      api<Room[]>('/api/rooms'),
      api<GradeMix>('/api/flush-harvests/grade-mix'),
    ])
    setRows(harvests)
    setRooms(roomList)
    setMix(gradeMix)
  }

  onMount(() => {
    load().catch((e) => setError(e.message))
  })

  async function onSubmit(e: Event) {
    e.preventDefault()
    setError('')
    try {
      await api('/api/flush-harvests', {
        method: 'POST',
        body: JSON.stringify({
          roomId: Number(form().roomId),
          harvestedAt: new Date(form().harvestedAt).toISOString(),
          flushNo: Number(form().flushNo),
          weightKg: Number(form().weightKg),
          grade: form().grade,
          operatorName: form().operatorName,
        }),
      })
      setForm({ ...empty, harvestedAt: toLocalInput() })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function remove(id: number) {
    if (!confirm('确认删除该采收记录？')) return
    try {
      await api(`/api/flush-harvests/${id}`, { method: 'DELETE' })
      if (expanded() === id) setExpanded(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const mixKg = (g: HarvestGrade) => mix()?.mix.find((m) => m.grade === g)?.weightKg ?? 0

  return (
    <div>
      <header class="page-header">
        <h1>采收记录</h1>
        <p class="muted">潮次、等级与重量；grade 记录后冻结，改判另挂 GradeAppeal，不覆盖原等级</p>
      </header>
      {error() && <div class="error">{error()}</div>}

      {mix() && (
        <div class="stat-grid">
          <div class="panel stat-card">
            <div class="stat-label">有效等级 A 合计</div>
            <div class="stat-value">{mixKg('A').toFixed(3)} kg</div>
          </div>
          <div class="panel stat-card">
            <div class="stat-label">有效等级 B 合计</div>
            <div class="stat-value">{mixKg('B').toFixed(3)} kg</div>
          </div>
          <div class="panel stat-card">
            <div class="stat-label">有效等级 C 合计</div>
            <div class="stat-value">{mixKg('C').toFixed(3)} kg</div>
          </div>
          <div class="panel stat-card accent">
            <div class="stat-label">总计</div>
            <div class="stat-value">{(mix()?.totalKg ?? 0).toFixed(3)} kg</div>
          </div>
        </div>
      )}

      <form class="panel form-grid" onSubmit={onSubmit}>
        <label>
          出菇室
          <select
            value={form().roomId}
            onChange={(e) => setForm({ ...form(), roomId: e.currentTarget.value })}
            required
          >
            <option value="">选择出菇室</option>
            <For each={rooms()}>
              {(r) => (
                <option value={String(r.id)}>
                  {r.roomCode} · {r.species}
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          采收时间
          <input
            type="datetime-local"
            value={form().harvestedAt}
            onInput={(e) => setForm({ ...form(), harvestedAt: e.currentTarget.value })}
            required
          />
        </label>
        <label>
          潮次
          <input
            type="number"
            min="1"
            value={form().flushNo}
            onInput={(e) => setForm({ ...form(), flushNo: e.currentTarget.value })}
            required
          />
        </label>
        <label>
          重量 (kg)
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={form().weightKg}
            onInput={(e) => setForm({ ...form(), weightKg: e.currentTarget.value })}
            required
          />
        </label>
        <label>
          等级
          <select
            value={form().grade}
            onChange={(e) =>
              setForm({ ...form(), grade: e.currentTarget.value as HarvestGrade })
            }
          >
            <For each={grades}>{(g) => <option value={g}>{g}</option>}</For>
          </select>
        </label>
        <label>
          操作人
          <input
            value={form().operatorName}
            onInput={(e) => setForm({ ...form(), operatorName: e.currentTarget.value })}
            required
          />
        </label>
        <button type="submit" class="btn primary">
          新增采收
        </button>
      </form>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>室 ID</th>
              <th>时间</th>
              <th>潮次</th>
              <th>重量</th>
              <th>原等级</th>
              <th>有效等级</th>
              <th>改判</th>
              <th>操作人</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(r) => (
                <>
                  <tr>
                    <td>{r.id}</td>
                    <td>{r.roomId}</td>
                    <td>{new Date(r.harvestedAt).toLocaleString()}</td>
                    <td>{r.flushNo}</td>
                    <td>{r.weightKg}</td>
                    <td>
                      <GradeBadge grade={r.originalGrade} />
                    </td>
                    <td>
                      <GradeBadge grade={r.effectiveGrade} />
                      {r.effectiveGrade !== r.originalGrade && <span class="muted"> ← 改判</span>}
                    </td>
                    <td>
                      <button type="button" class="btn ghost" onClick={() => setExpanded(expanded() === r.id ? null : r.id)}>
                        {r.appealCount} 笔{expanded() === r.id ? ' ▲' : ' ▼'}
                      </button>
                    </td>
                    <td>{r.operatorName}</td>
                    <td>
                      <button type="button" class="btn ghost" onClick={() => remove(r.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                  {expanded() === r.id && (
                    <tr class="appeal-row">
                      <td colSpan={10}>
                        <AppealBox harvest={r} onDone={load} />
                      </td>
                    </tr>
                  )}
                </>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}
