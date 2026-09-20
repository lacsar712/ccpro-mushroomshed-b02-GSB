import { createSignal, onMount } from 'solid-js'
import { For, Show } from 'solid-js'
import { api } from '../api/client'
import type { FlushHarvest, GradeMixRow, HarvestGrade, Room } from '../types'

const grades: HarvestGrade[] = ['A', 'B', 'C']

function toLocalInput(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}`
}

const empty = {
  roomId: '',
  harvestedAt: toLocalInput(),
  flushNo: '1',
  weightKg: '',
  grade: 'A' as HarvestGrade,
  operatorName: '',
}

export default function FlushHarvests() {
  const [rows, setRows] = createSignal<FlushHarvest[]>([])
  const [rooms, setRooms] = createSignal<Room[]>([])
  const [mix, setMix] = createSignal<GradeMixRow[]>([])
  const [form, setForm] = createSignal({ ...empty })
  const [error, setError] = createSignal('')
  const [expandedId, setExpandedId] = createSignal<number | null>(null)
  const [appealForm, setAppealForm] = createSignal({ nextGrade: 'B' as HarvestGrade, reason: '' })
  const [appealError, setAppealError] = createSignal<Record<number, string>>({})
  const [appealing, setAppealing] = createSignal<number | null>(null)

  async function load() {
    const [harvests, roomList, gradeMix] = await Promise.all([
      api<FlushHarvest[]>('/api/flush-harvests'),
      api<Room[]>('/api/rooms'),
      api<GradeMixRow[]>('/api/flush-harvests/grade-mix'),
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
      // 直接展示接口返回的原文
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function remove(id: number) {
    if (!confirm('确认删除该采收记录？其全部改判记录也会一并删除。')) return
    setError('')
    try {
      await api(`/api/flush-harvests/${id}`, { method: 'DELETE' })
      if (expandedId() === id) setExpandedId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  function toggleAppeals(r: FlushHarvest) {
    setExpandedId(expandedId() === r.id ? null : r.id)
    setAppealError({ ...appealError(), [r.id]: '' })
    setAppealForm({
      nextGrade: grades.find((g) => g !== r.effectiveGrade) ?? 'B',
      reason: '',
    })
  }

  async function submitAppeal(r: FlushHarvest) {
    const reason = appealForm().reason.trim()
    if (reason.length < 6) {
      setAppealError({ ...appealError(), [r.id]: 'reason 去掉空白后至少 6 个字' })
      return
    }
    setAppealing(r.id)
    setAppealError({ ...appealError(), [r.id]: '' })
    try {
      await api(`/api/flush-harvests/${r.id}/appeals`, {
        method: 'POST',
        body: JSON.stringify({ nextGrade: appealForm().nextGrade, reason }),
      })
      setAppealForm({ ...appealForm(), reason: '' })
      await load()
    } catch (err) {
      // 失败时展示接口原文
      setAppealError({
        ...appealError(),
        [r.id]: err instanceof Error ? err.message : '改判失败',
      })
    } finally {
      setAppealing(null)
    }
  }

  // 用列表的 effectiveGrade 重新汇总,核对与 grade-mix 接口一致(差 <= 0.001)
  function listMix(grade: HarvestGrade) {
    return rows()
      .filter((r) => r.effectiveGrade === grade)
      .reduce((s, r) => s + r.weightKg, 0)
  }

  const mixByGrade = () => {
    const m: Partial<Record<HarvestGrade, number>> = {}
    for (const row of mix()) m[row.grade] = row.weightKg
    return m
  }

  return (
    <div>
      <header class="page-header">
        <h1>采收记录</h1>
        <p class="muted">
          潮次、等级与重量；weightKg 须 &gt; 0。等级写下即冻结，改判另记 GradeAppeal，不覆盖原等级。
        </p>
      </header>
      {error() && <div class="error">{error()}</div>}

      <div class="panel" style={{ display: 'flex', gap: '2rem', 'flex-wrap': 'wrap' }}>
        <strong>按有效等级汇总（grade-mix）：</strong>
        <For each={grades}>
          {(g) => {
            const apiKg = () => mixByGrade()[g] ?? 0
            return (
              <span class={`badge grade-${g.toLowerCase()}`}>
                {g}：{apiKg().toFixed(3)} kg（列表合计 {listMix(g).toFixed(3)}）
              </span>
            )
          }}
        </For>
      </div>

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
          等级（写入后冻结）
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
              <th>改判笔数</th>
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
                      <span class={`badge grade-${r.originalGrade.toLowerCase()}`}>
                        {r.originalGrade}
                      </span>
                    </td>
                    <td>
                      <span class={`badge grade-${r.effectiveGrade.toLowerCase()}`}>
                        {r.effectiveGrade}
                      </span>
                      <Show when={r.effectiveGrade !== r.originalGrade}>
                        <span class="muted">（已改判）</span>
                      </Show>
                    </td>
                    <td>{r.appealCount}</td>
                    <td>{r.operatorName}</td>
                    <td style={{ display: 'flex', gap: '0.4rem' }}>
                      <button type="button" class="btn ghost" onClick={() => toggleAppeals(r)}>
                        {expandedId() === r.id ? '收起改判' : `改判 (${r.appealCount})`}
                      </button>
                      <button type="button" class="btn ghost" onClick={() => remove(r.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                  <Show when={expandedId() === r.id}>
                    <tr>
                      <td colSpan={10}>
                        <div class="panel" style={{ margin: '0.5rem 0' }}>
                          <h4 style={{ margin: '0 0 0.5rem' }}>
            改判记录（{r.appealCount} 笔）— 有效等级取 appealedAt 最晚者，同时刻取 id 更大者
                          </h4>
                          <Show when={appealError()[r.id]}>
                            <div class="error">{appealError()[r.id]}</div>
                          </Show>
                          <div style={{ display: 'flex', gap: '0.6rem', 'flex-wrap': 'wrap', 'align-items': 'flex-end' }}>
                            <label>
                              改判为
                              <select
                                value={appealForm().nextGrade}
                                onChange={(e) =>
                                  setAppealForm({
                                    ...appealForm(),
                                    nextGrade: e.currentTarget.value as HarvestGrade,
                                  })
                                }
                              >
                                <For each={grades.filter((g) => g !== r.effectiveGrade)}>
                                  {(g) => <option value={g}>{g}</option>}
                                </For>
                              </select>
                            </label>
                            <label style={{ flex: 1, 'min-width': '240px' }}>
                              理由（去空白后至少 6 字，且不能等于当前有效等级 {r.effectiveGrade}）
                              <input
                                value={appealForm().reason}
                                onInput={(e) =>
                                  setAppealForm({ ...appealForm(), reason: e.currentTarget.value })
                                }
                                placeholder="例如：复检发现菌盖破损率超标"
                              />
                            </label>
                            <button
                              type="button"
                              class="btn primary"
                              disabled={appealing() === r.id}
                              onClick={() => submitAppeal(r)}
                            >
                              {appealing() === r.id ? '提交中…' : '提交改判'}
                            </button>
                          </div>
                          <table style={{ 'margin-top': '0.6rem' }}>
                            <thead>
                              <tr>
                                <th>ID</th>
                                <th>改判等级</th>
                                <th>理由</th>
                                <th>提交时间</th>
                              </tr>
                            </thead>
                            <tbody>
                              <For each={r.appeals}>
                                {(a) => (
                                  <tr>
                                    <td>{a.id}</td>
                                    <td>
                                      <span class={`badge grade-${a.nextGrade.toLowerCase()}`}>
                                        {a.nextGrade}
                                      </span>
                                    </td>
                                    <td>{a.reason}</td>
                                    <td>{new Date(a.appealedAt).toLocaleString()}</td>
                                  </tr>
                                )}
                              </For>
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  </Show>
                </>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}
