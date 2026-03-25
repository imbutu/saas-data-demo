import { useState, useEffect, useRef, useCallback } from 'react'
import { mockFetch } from './mock/index'

const IS_MOCK = true // Mock 模式，无需后端
import './App.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  sql?: string
  file?: { name: string; size: number }
  result?: { columns: string[]; rows: any[][]; total: number }
  /** 有数据结果的消息：附带引导操作 */
  hasData?: boolean
  error?: string
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
}

interface Report {
  id: string
  title: string
  description?: string
  sql: string
  columns: string[]
  rows: any[][]
  chart_type: string
}

interface DownloadRecord {
  id: string
  report_title: string
  file_name: string
  date_start: string
  date_end: string
  status: 'pending' | 'ready' | 'failed'
  error_msg?: string
  created_at: number
  ready_at?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUICK_QUESTIONS = [
  '昨天的营业额是多少？',
  '本周每天营业额趋势',
  '上周卖得最好的10道菜',
  '昨天各支付方式的收款金额',
  '本月优惠情况汇总',
  '昨天各餐段的订单量',
]

const CYCLE_OPTIONS = [
  { key: 'daily',   label: '按日', desc: '每天导出前一天数据' },
  { key: 'weekly',  label: '按周', desc: '每周一导出上周数据' },
  { key: 'monthly', label: '按月', desc: '每月1日导出上月数据' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatTs(ts: number) {
  const d = new Date(ts * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

let msgIdCounter = 0

function authHeader() {
  const token = localStorage.getItem('demo_token') || 'demo'
  return { Authorization: `Bearer ${token}` }
}

async function apiFetch(url: string, opts?: RequestInit) {
  if (IS_MOCK) {
    return mockFetch(url, opts)
  }
  const res = await fetch(url, {
    ...opts,
    headers: { ...authHeader(), ...(opts?.headers || {}) },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Save Report Dialog ───────────────────────────────────────────────────────

function SaveReportDialog({
  msg,
  onClose,
  onSaved,
}: {
  msg: Message
  onClose: () => void
  onSaved: (report: Report) => void
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSave = async () => {
    if (!title.trim()) { setErr('请输入报表名称'); return }
    setSaving(true)
    try {
      const report = await apiFetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          sql: msg.sql || '',
          columns: msg.result?.columns || [],
          rows: msg.result?.rows || [],
          chart_type: 'bar',
        }),
      })
      onSaved(report)
    } catch (e: any) {
      setErr('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">💾 保存为常用报表</div>
        <input
          className="modal-input"
          placeholder="给报表起个名字，例如：每日营业额汇总"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          autoFocus
        />
        {err && <div className="modal-err">{err}</div>}
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Export Task Dialog ───────────────────────────────────────────────────────

function ExportTaskDialog({
  reports,
  onClose,
  onCreated,
}: {
  msg?: Message
  reports: Report[]
  onClose: () => void
  onCreated: () => void
}) {
  const [selectedReportId, setSelectedReportId] = useState<string>('')
  const [taskName, setTaskName] = useState('')
  const [exportType, setExportType] = useState<'dynamic' | 'fixed'>('dynamic')
  const [cycles, setCycles] = useState<string[]>(['daily'])
  const [triggerTime, setTriggerTime] = useState('08:00')
  const [fixedStart, setFixedStart] = useState('')
  const [fixedEnd, setFixedEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // 如果已有当前查询对应的保存报表，自动选中
  useEffect(() => {
    if (reports.length > 0 && !selectedReportId) {
      setSelectedReportId(reports[0].id)
      setTaskName(reports[0].title + '定时导出')
    }
  }, [reports])

  const toggleCycle = (key: string) => {
    setCycles(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  const handleCreate = async () => {
    if (!selectedReportId) { setErr('请选择一个报表'); return }
    if (!taskName.trim()) { setErr('请输入任务名称'); return }
    if (exportType === 'dynamic' && cycles.length === 0) { setErr('请至少选择一个导出频次'); return }
    if (exportType === 'fixed' && (!fixedStart || !fixedEnd)) { setErr('请填写导出日期范围'); return }

    setSaving(true)
    try {
      await apiFetch('/api/export-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: selectedReportId,
          task_name: taskName.trim(),
          export_type: exportType,
          dynamic_cycle: exportType === 'dynamic' ? cycles : null,
          dynamic_range: cycles.includes('daily') ? 'yesterday' : cycles.includes('weekly') ? 'last_week' : 'last_month',
          trigger_time: triggerTime,
          fixed_date_start: exportType === 'fixed' ? fixedStart.replace(/-/g, '') : null,
          fixed_date_end: exportType === 'fixed' ? fixedEnd.replace(/-/g, '') : null,
        }),
      })
      onCreated()
    } catch (e: any) {
      setErr('创建失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-export" onClick={e => e.stopPropagation()}>
        <div className="modal-title">⏰ 创建定时导出任务</div>

        {/* 报表选择 */}
        <div className="form-section">
          <div className="form-label">选择报表</div>
          {reports.length === 0 ? (
            <div className="modal-warn">⚠️ 还没有保存的报表，请先保存当前查询结果为报表</div>
          ) : (
            <select
              className="modal-select"
              value={selectedReportId}
              onChange={e => {
                setSelectedReportId(e.target.value)
                const r = reports.find(r => r.id === e.target.value)
                if (r) setTaskName(r.title + '定时导出')
              }}
            >
              {reports.map(r => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          )}
        </div>

        {/* 任务名称 */}
        <div className="form-section">
          <div className="form-label">任务名称</div>
          <input
            className="modal-input"
            value={taskName}
            onChange={e => setTaskName(e.target.value)}
            placeholder="例如：每日营业额自动导出"
          />
        </div>

        {/* 导出类型 */}
        <div className="form-section">
          <div className="form-label">导出方式</div>
          <div className="tab-switcher">
            <button
              className={`tab-btn${exportType === 'dynamic' ? ' active' : ''}`}
              onClick={() => setExportType('dynamic')}
            >
              🔄 动态导出
            </button>
            <button
              className={`tab-btn${exportType === 'fixed' ? ' active' : ''}`}
              onClick={() => setExportType('fixed')}
            >
              📅 固定日期导出
            </button>
          </div>
        </div>

        {/* 动态导出配置 */}
        {exportType === 'dynamic' && (
          <>
            <div className="form-section">
              <div className="form-label">导出频次（可多选）</div>
              <div className="cycle-checkboxes">
                {CYCLE_OPTIONS.map(opt => (
                  <label key={opt.key} className={`cycle-item${cycles.includes(opt.key) ? ' checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={cycles.includes(opt.key)}
                      onChange={() => toggleCycle(opt.key)}
                    />
                    <div>
                      <div className="cycle-label">{opt.label}</div>
                      <div className="cycle-desc">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="form-section">
              <div className="form-label">触发时间</div>
              <input
                type="time"
                className="modal-input"
                value={triggerTime}
                onChange={e => setTriggerTime(e.target.value)}
              />
            </div>
          </>
        )}

        {/* 固定导出配置 */}
        {exportType === 'fixed' && (
          <div className="form-section">
            <div className="form-label">日期范围</div>
            <div className="date-range-row">
              <input
                type="date"
                className="modal-input"
                value={fixedStart}
                onChange={e => setFixedStart(e.target.value)}
              />
              <span className="date-sep">至</span>
              <input
                type="date"
                className="modal-input"
                value={fixedEnd}
                onChange={e => setFixedEnd(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="modal-tip">
          📥 导出的 Excel 文件可在左侧「下载中心」下载
        </div>

        {err && <div className="modal-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={saving || reports.length === 0}
          >
            {saving ? '创建中...' : '立即创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Download Center ──────────────────────────────────────────────────────────

function DownloadCenter({ onClose }: { onClose: () => void }) {
  const [records, setRecords] = useState<DownloadRecord[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch('/api/downloads')
      setRecords(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000) // 5s 轮询，等待 pending 变 ready
    return () => clearInterval(timer)
  }, [refresh])

  const handleDownload = (id: string, filename: string) => {
    const a = document.createElement('a')
    a.href = `/api/downloads/${id}/file`
    a.download = filename
    // 需要携带 token；用 fetch + blob 方式
    fetch(`/api/downloads/${id}/file`, { headers: authHeader() })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob)
        a.href = url
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      })
  }

  const statusBadge = (s: string) => {
    if (s === 'ready') return <span className="badge badge-green">✅ 可下载</span>
    if (s === 'pending') return <span className="badge badge-orange">⏳ 生成中</span>
    return <span className="badge badge-red">❌ 失败</span>
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-box" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">📥 下载中心</div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        {loading ? (
          <div className="drawer-empty">加载中...</div>
        ) : records.length === 0 ? (
          <div className="drawer-empty">暂无导出记录<br /><span>创建定时导出任务后，文件会出现在这里</span></div>
        ) : (
          <div className="download-list">
            {records.map(r => (
              <div key={r.id} className="download-item">
                <div className="dl-info">
                  <div className="dl-title">{r.report_title}</div>
                  <div className="dl-meta">
                    {r.date_start && r.date_end && (
                      <span className="dl-range">{r.date_start} ~ {r.date_end}</span>
                    )}
                    <span className="dl-time">{formatTs(r.created_at)}</span>
                  </div>
                  {r.status === 'failed' && r.error_msg && (
                    <div className="dl-error">{r.error_msg}</div>
                  )}
                </div>
                <div className="dl-right">
                  {statusBadge(r.status)}
                  {r.status === 'ready' && (
                    <button
                      className="btn-dl"
                      onClick={() => handleDownload(r.id, r.file_name)}
                    >
                      ↓ 下载
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Dimension Confirm Dialog ─────────────────────────────────────────────────

interface DimCategory {
  name: string
  description: string
  sql_condition: string
  confidence: number
}

interface DimResult {
  dim_name: string
  case_when_sql: string
  categories: DimCategory[]
  overall_confidence: number
  uncertain_categories: string[]
  clarify_question: string | null
}

interface ConflictDim {
  dim_name: string
  existing: any
  new: DimResult
}

interface DimensionsData {
  dimensions: DimResult[]
  needs_clarify: boolean
  conflict_dims: ConflictDim[]
}

function DimensionConfirmDialog({
  data,
  onClose,
  onConfirmed,
}: {
  data: DimensionsData
  onClose: () => void
  onConfirmed: () => void
}) {
  const [scope, setScope] = useState<'report' | 'global'>('report')
  const [clarifyInput, setClarifyInput] = useState<Record<string, string>>({})
  const [refinedDims, setRefinedDims] = useState<DimResult[]>(data.dimensions)
  const [refiningDim, setRefiningDim] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // 是否有待追问的维度
  const needsClarify = refinedDims.some(d => d.clarify_question)

  const handleRefine = async (dimName: string) => {
    const clarify = clarifyInput[dimName]?.trim()
    if (!clarify) return
    setRefiningDim(dimName)
    try {
      const current = refinedDims.find(d => d.dim_name === dimName)!
      const result = await apiFetch('/api/dimensions/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dim_name: dimName,
          current_result: current,
          user_clarification: clarify,
        }),
      })
      setRefinedDims(prev => prev.map(d => d.dim_name === dimName ? result : d))
      setClarifyInput(prev => ({ ...prev, [dimName]: '' }))
    } catch (e: any) {
      setErr('补充解析失败：' + e.message)
    } finally {
      setRefiningDim(null)
    }
  }

  const handleConfirm = async () => {
    const validDims = refinedDims.filter(d => d.case_when_sql && !d.clarify_question)
    if (validDims.length === 0) { setErr('没有可保存的维度'); return }
    setSaving(true)
    try {
      await apiFetch('/api/dimensions/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimensions: validDims, scope }),
      })
      onConfirmed()
    } catch (e: any) {
      setErr('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const confidenceColor = (c: number) => c >= 0.8 ? '#22c55e' : c >= 0.6 ? '#f59e0b' : '#ef4444'
  const confidenceLabel = (c: number) => c >= 0.8 ? '✅ 高置信' : c >= 0.6 ? '⚠️ 中置信' : '❓ 低置信'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-dim" onClick={e => e.stopPropagation()}>
        <div className="modal-title">🔍 发现自定义维度定义</div>
        <p className="modal-desc">我从你上传的 Excel 中识别到以下自定义维度，请确认解析是否正确：</p>

        {/* 冲突提示 */}
        {data.conflict_dims.length > 0 && (
          <div className="dim-conflict-warning">
            ⚠️ 以下维度与已有的全局维度同名，确认后将覆盖：
            {data.conflict_dims.map(c => (
              <span key={c.dim_name} className="dim-conflict-tag">「{c.dim_name}」</span>
            ))}
          </div>
        )}

        {/* 维度列表 */}
        <div className="dim-list">
          {refinedDims.map((dim) => (
            <div key={dim.dim_name} className="dim-card">
              <div className="dim-card-header">
                <span className="dim-name">{dim.dim_name}</span>
                <span
                  className="dim-confidence"
                  style={{ color: confidenceColor(dim.overall_confidence) }}
                >
                  {confidenceLabel(dim.overall_confidence)}（{Math.round(dim.overall_confidence * 100)}%）
                </span>
              </div>

              {/* 分类列表 */}
              <div className="dim-categories">
                {dim.categories.map((cat) => (
                  <div key={cat.name} className="dim-cat-row">
                    <span className="dim-cat-name">
                      {dim.uncertain_categories?.includes(cat.name) ? '❓' : '✅'} {cat.name}
                    </span>
                    <span className="dim-cat-desc">{cat.description}</span>
                    <code className="dim-cat-sql">{cat.sql_condition}</code>
                  </div>
                ))}
              </div>

              {/* 生成的 CASE WHEN 预览 */}
              <details className="dim-sql-preview">
                <summary>查看生成的 SQL</summary>
                <pre className="dim-sql-code">{dim.case_when_sql}</pre>
              </details>

              {/* 追问区 */}
              {dim.clarify_question && (
                <div className="dim-clarify-box">
                  <p className="dim-clarify-q">❓ {dim.clarify_question}</p>
                  <div className="dim-clarify-input-row">
                    <input
                      className="modal-input"
                      placeholder="补充说明..."
                      value={clarifyInput[dim.dim_name] || ''}
                      onChange={e => setClarifyInput(prev => ({ ...prev, [dim.dim_name]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleRefine(dim.dim_name) }}
                    />
                    <button
                      className="btn-refine"
                      onClick={() => handleRefine(dim.dim_name)}
                      disabled={refiningDim === dim.dim_name}
                    >
                      {refiningDim === dim.dim_name ? '解析中...' : '重新解析'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 作用域选择 */}
        <div className="dim-scope-row">
          <span className="dim-scope-label">生效范围：</span>
          <label className="dim-scope-opt">
            <input
              type="radio"
              name="scope"
              value="report"
              checked={scope === 'report'}
              onChange={() => setScope('report')}
            />
            仅对本次报表生效
          </label>
          <label className="dim-scope-opt">
            <input
              type="radio"
              name="scope"
              value="global"
              checked={scope === 'global'}
              onChange={() => setScope('global')}
            />
            设为默认（所有报表都生效）
          </label>
        </div>

        {needsClarify && (
          <p className="dim-clarify-tip">⚠️ 有维度解析不确定，请先补充说明后再保存</p>
        )}
        {err && <div className="modal-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>跳过</button>
          <button
            className={`btn-primary${(saving || needsClarify) ? ' disabled' : ''}`}
            onClick={handleConfirm}
            disabled={saving || needsClarify}
          >
            {saving ? '保存中...' : '✅ 确认保存维度'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [poiName] = useState('周记餐厅')
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const init: Conversation = {
      id: Date.now().toString(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
    }
    return [init]
  })
  const [activeId, setActiveId] = useState<string>(() => Date.now().toString())
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSql, setShowSql] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reports
  const [reports, setReports] = useState<Report[]>([])
  const fetchReports = useCallback(async () => {
    try {
      const data = await apiFetch('/api/reports')
      setReports(data)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { fetchReports() }, [fetchReports])

  // Modal state
  const [saveDialog, setSaveDialog] = useState<Message | null>(null)
  const [exportDialog, setExportDialog] = useState<Message | null>(null)
  const [showDownloadCenter, setShowDownloadCenter] = useState(false)
  const [dimensionDialog, setDimensionDialog] = useState<DimensionsData | null>(null)

  const activeConv = conversations.find(c => c.id === activeId)
  const messages = activeConv?.messages || []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const newConversation = () => {
    const conv: Conversation = {
      id: Date.now().toString(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
    }
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
    setInput('')
  }

  const updateConv = (id: string, msgs: Message[]) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== id) return c
      const firstUser = msgs.find(m => m.role === 'user')
      const title = firstUser
        ? firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '...' : '')
        : c.title
      return { ...c, messages: msgs, title }
    }))
  }

  const sendMessage = async (text: string, file?: File) => {
    if ((!text.trim() && !file) || loading || !activeId) return

    const userMsg: Message = {
      id: ++msgIdCounter,
      role: 'user',
      content: file ? (text || `上传文件：${file.name}`) : text,
      file: file ? { name: file.name, size: file.size } : undefined,
    }
    const newMsgs = [...messages, userMsg]
    updateConv(activeId, newMsgs)
    setInput('')
    setLoading(true)

    try {
      const token = localStorage.getItem('demo_token') || 'demo'
      let res: any

      if (file && file.name.match(/\.(xlsx|xls)$/i)) {
        // ── Step 1: analyze（含自定义维度解析）──
        const formData1 = new FormData()
        formData1.append('file', file)
        const analyzeResp = await fetch('/api/excel/analyze', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData1,
        })
        if (!analyzeResp.ok) throw new Error(await analyzeResp.text())
        const analyzed = await analyzeResp.json()

        // ── 如果有自定义维度，弹出确认框（先暂停主流程，等用户确认后再继续）──
        const dimsData: DimensionsData = analyzed.dimensions
        if (dimsData?.dimensions?.length > 0) {
          // 先把"正在分析"消息加入对话
          const analyzingMsg: Message = {
            id: ++msgIdCounter,
            role: 'assistant',
            content: `📋 已识别 ${analyzed.headers?.length || 0} 个字段，匹配率 ${Math.round((analyzed.match_rate || 0) * 100)}%。\n我在你的 Excel 中发现了自定义维度定义，请确认解析结果。`,
          }
          updateConv(activeId, [...newMsgs, analyzingMsg])
          setLoading(false)
          setDimensionDialog(dimsData)
          return  // 暂停，等待用户确认维度
        }

        // ── Step 2: build-report（提交后异步轮询）──
        const buildResp = await fetch('/api/excel/build-report', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            headers: analyzed.headers,
            mapped: analyzed.mapped,
            unmapped: analyzed.unmapped,
            user_description: text || '',
          }),
        })
        if (!buildResp.ok) throw new Error(await buildResp.text())
        const buildInit = await buildResp.json()

        // 若后端返回 task_id，进入轮询模式（菜品表等大查询）
        if (buildInit.task_id) {
          const taskId = buildInit.task_id
          const maxWait = 900_000  // 最多等 15 分钟
          const pollInterval = 10_000  // 每 10s 轮询一次
          const pollStart = Date.now()
          while (Date.now() - pollStart < maxWait) {
            await new Promise(r => setTimeout(r, pollInterval))
            const pollResp = await fetch(`/api/excel/build-report/${taskId}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!pollResp.ok) throw new Error(await pollResp.text())
            const pollData = await pollResp.json()
            if (pollData.status === 'done') {
              res = {
                type: 'data',
                report_title: pollData.report_title,
                sql: pollData.sql,
                columns: pollData.columns,
                rows: pollData.rows,
                total: pollData.total,
                chart_type: pollData.chart_type,
                date_hint: pollData.date_hint,
              }
              break
            } else if (pollData.status === 'error') {
              throw new Error(pollData.error || '报表生成失败')
            }
            // status === 'running'，继续等
          }
          if (!res) throw new Error('报表生成超时（超过15分钟），请稍后重试')
        } else {
          res = buildInit
        }
      } else {
        const history = newMsgs.slice(-6).map(m => ({
          role: m.role,
          content: m.role === 'user' ? m.content : (m.sql ? `已生成SQL: ${m.sql}` : m.content),
        }))
        const resp = await fetch('/api/chat/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query: text, history }),
        })
        if (!resp.ok) throw new Error(await resp.text())
        res = await resp.json()
      }

      const hasData = res.type === 'data' && res.columns && res.columns.length > 0

      const assistantMsg: Message = {
        id: ++msgIdCounter,
        role: 'assistant',
        content: res.type === 'clarify'
          ? res.reply
          : `已查询到 ${res.total} 条数据`,
        sql: res.sql,
        result: hasData ? { columns: res.columns, rows: res.rows, total: res.total } : undefined,
        hasData,
      }
      updateConv(activeId, [...newMsgs, assistantMsg])
    } catch (e: any) {
      updateConv(activeId, [...newMsgs, {
        id: ++msgIdCounter,
        role: 'assistant',
        content: '',
        error: e.message || '查询失败，请重试',
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) sendMessage(input, file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) sendMessage(input, file)
  }

  return (
    <div className="app-root">
      {/* ── 左侧边栏 ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">🍜</span>
          <div>
            <div className="logo-title">AI 取数助手</div>
            <div className="logo-sub">{poiName}</div>
          </div>
        </div>

        <div className="sidebar-new">
          <button className="btn-new" onClick={newConversation}>
            ✏️ 新建对话
          </button>
        </div>

        <div className="sidebar-list">
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`conv-item${conv.id === activeId ? ' active' : ''}`}
              onClick={() => setActiveId(conv.id)}
            >
              <div className="conv-title">💬 {conv.title}</div>
              <div className="conv-time">{formatTime(conv.createdAt)}</div>
            </div>
          ))}
        </div>

        {/* 下载中心入口 */}
        <div className="sidebar-download">
          <button className="btn-download-center" onClick={() => setShowDownloadCenter(true)}>
            📥 下载中心
          </button>
        </div>

        <div className="sidebar-footer">
          <button className="btn-logout" onClick={() => {
            localStorage.clear()
            window.location.href = '/login'
          }}>
            ← 退出登录
          </button>
        </div>
      </aside>

      {/* ── 主内容区 ── */}
      <main
        className="main"
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {dragging && (
          <div className="drop-overlay">📂 松开以上传文件</div>
        )}

        <div className="messages-wrap">
          <div className="messages-inner">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">🍜</div>
                <h2 className="empty-title">有什么我能帮你查的？</h2>
                <p className="empty-sub">支持自然语言查数，也可以上传 Excel 模板</p>
                <div className="quick-grid">
                  {QUICK_QUESTIONS.map(q => (
                    <button key={q} className="quick-btn" onClick={() => sendMessage(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`msg-row msg-${msg.role}`}>
                {msg.role === 'user' ? (
                  <div className="bubble-user">
                    {msg.file && (
                      <div className="file-badge">
                        📎 {msg.file.name}
                        <span className="file-size">({(msg.file.size / 1024).toFixed(1)}KB)</span>
                      </div>
                    )}
                    {msg.content}
                  </div>
                ) : (
                  <div className="msg-ai">
                    <div className="ai-avatar">🤖</div>
                    <div className="bubble-ai">
                      {msg.error ? (
                        <div className="error-msg">❌ {msg.error}</div>
                      ) : (
                        <>
                          <div className="ai-status">
                            {msg.hasData ? `✅ ${msg.content}` : msg.content}
                          </div>

                          {msg.result && msg.result.columns.length > 0 && (
                            <div className="result-table-wrap">
                              <table className="result-table">
                                <thead>
                                  <tr>
                                    {msg.result.columns.map((col, i) => (
                                      <th key={i}>{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {msg.result.rows.slice(0, 10).map((row, i) => (
                                    <tr key={i}>
                                      {row.map((cell: any, j: number) => (
                                        <td key={j}>{cell ?? '-'}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {msg.result.total > 10 && (
                                <div className="table-more">共 {msg.result.total} 条，显示前 10 条</div>
                              )}
                            </div>
                          )}

                          {/* 引导操作区 */}
                          {msg.hasData && (
                            <div className="guide-section">
                              <div className="guide-text">
                                你可以把这张报表保存为常用报表，也可以直接创建定时导出任务，我会定期自动导出数据，你可以在「下载中心」下载文件 📥
                              </div>
                              <div className="guide-actions">
                                <button
                                  className="guide-btn"
                                  onClick={() => setSaveDialog(msg)}
                                >
                                  💾 保存为报表
                                </button>
                                <button
                                  className="guide-btn guide-btn-primary"
                                  onClick={() => setExportDialog(msg)}
                                >
                                  ⏰ 创建定时导出
                                </button>
                              </div>
                            </div>
                          )}

                          {msg.sql && (
                            <div className="sql-section">
                              <button
                                className="sql-toggle"
                                onClick={() => setShowSql(showSql === msg.id ? null : msg.id)}
                              >
                                <span className={`sql-arrow${showSql === msg.id ? ' open' : ''}`}>▶</span>
                                查看生成的 SQL
                              </button>
                              {showSql === msg.id && (
                                <pre className="sql-block">{msg.sql}</pre>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="msg-row msg-assistant">
                <div className="msg-ai">
                  <div className="ai-avatar">🤖</div>
                  <div className="bubble-ai loading-bubble">
                    <span className="dot" /><span className="dot" /><span className="dot" />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* 输入区 */}
        <div className="input-area">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              className="input-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder="询问你的数据，例如：上周每天的营业额是多少？"
              rows={1}
            />
            <div className="input-toolbar">
              <div className="toolbar-left">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFilePick}
                  style={{ display: 'none' }}
                />
                <button
                  className="btn-upload"
                  onClick={() => fileInputRef.current?.click()}
                  title="上传 Excel / CSV"
                >
                  📎
                </button>
                <span className="upload-hint">支持 .xlsx / .xls / .csv · 可拖拽</span>
              </div>
              <button
                className={`btn-send${(!input.trim() || loading) ? ' disabled' : ''}`}
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
              >
                {loading ? '查询中...' : '发送 ↑'}
              </button>
            </div>
          </div>
          <p className="input-hint">Enter 发送 · Shift+Enter 换行</p>
        </div>
      </main>

      {/* ── Modals ── */}
      {saveDialog && (
        <SaveReportDialog
          msg={saveDialog}
          onClose={() => setSaveDialog(null)}
          onSaved={(_report) => {
            setSaveDialog(null)
            fetchReports()
          }}
        />
      )}

      {exportDialog && (
        <ExportTaskDialog
          msg={exportDialog}
          reports={reports}
          onClose={() => setExportDialog(null)}
          onCreated={() => {
            setExportDialog(null)
          }}
        />
      )}

      {showDownloadCenter && (
        <DownloadCenter onClose={() => setShowDownloadCenter(false)} />
      )}

      {dimensionDialog && (
        <DimensionConfirmDialog
          data={dimensionDialog}
          onClose={() => setDimensionDialog(null)}
          onConfirmed={() => {
            setDimensionDialog(null)
            // 维度保存后，在对话里加一条确认消息
            const convId = activeId
            setConversations(prev => prev.map(c => {
              if (c.id !== convId) return c
              const confirmMsg: Message = {
                id: ++msgIdCounter,
                role: 'assistant',
                content: '✅ 自定义维度已保存！后续你在查询时提到相关维度，我会自动按这个定义统计数据。',
              }
              return { ...c, messages: [...c.messages, confirmMsg] }
            }))
          }}
        />
      )}
    </div>
  )
}