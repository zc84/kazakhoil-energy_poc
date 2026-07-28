import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertTriangle, ArrowRight, CalendarDays, Check, ChevronDown,
  CloudSun, Database, Download, Factory, FileCheck2, FileSpreadsheet, Filter, Gauge,
  Info, LayoutDashboard, LogOut, Maximize2, Menu, Moon, Plus, Sun, Thermometer,
  Trash2, TrendingDown, TrendingUp, Upload, X, Zap,
} from 'lucide-react'
import './styles.css'

const EnergyBusinessCharts = lazy(() => import('./EnergyBusinessCharts.jsx'))

const nav = [
  { section: 'ОБЗОР', items: [{ id: 'overview', label: 'Главная', icon: LayoutDashboard }] },
  { section: 'АНАЛИТИКА', items: [
    { id: 'consumption', label: 'Энергобаланс', icon: Zap },
    { id: 'peaks', label: 'Пики и аномалии', icon: AlertTriangle },
    { id: 'forecast', label: 'Прогнозирование', icon: Zap },
  ]},
  { section: 'ДАННЫЕ', items: [
    { id: 'reconciliation', label: 'Месячная сверка', icon: FileCheck2 },
    { id: 'quality', label: 'Загрузка файлов', icon: Database },
  ]},
]

const pageTitles = {
  overview: ['Главная', 'Оперативный статус данных, загрузок и готовности анализа'],
  consumption: ['Энергобаланс', 'Потребление, структура нагрузки и сверка источников'],
  peaks: ['Пики и аномалии', 'Резкие изменения нагрузки, контрольные уровни и пиковые дни'],
  forecast: ['Прогнозирование', 'Ожидаемый расход после накопления достаточной истории'],
  reconciliation: ['Месячная сверка', 'Сравнение ежедневных сводок с техническим балансом'],
  quality: ['Загрузка файлов', 'Импорт исходных файлов и детальная проверка структуры'],
}

const PROD_API_BASE = import.meta.env?.VITE_API_BASE_URL
const LOCAL_API_BASE = 'http://127.0.0.1:8000'

function toBaseUrl(value) {
  return String(value || '').replace(/\/$/, '')
}

function deriveRenderApiCandidates() {
  if (typeof window === 'undefined') return []
  const { hostname, protocol } = window.location
  if (!hostname.endsWith('.onrender.com')) return []

  const names = new Set([
    hostname,
    hostname.replace('-poc.onrender.com', '-api.onrender.com'),
    hostname.replace('-energy-poc.onrender.com', '-api.onrender.com'),
    hostname.replace('-energy-poc.onrender.com', '-energy-api.onrender.com'),
    hostname.replace('-web.onrender.com', '-api.onrender.com'),
    hostname.replace('-frontend.onrender.com', '-api.onrender.com'),
    'kazakhoil-api.onrender.com',
  ])

  return Array.from(names).map(name => `${protocol}//${name}`)
}

function deriveLocalApiCandidates() {
  if (typeof window === 'undefined') return []
  const { hostname } = window.location
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return []
  return ['http://127.0.0.1:8000', 'http://localhost:8000']
}

function getApiCandidates() {
  const explicit = toBaseUrl(import.meta.env.PROD
    ? PROD_API_BASE
    : (import.meta.env?.VITE_API_BASE_URL || LOCAL_API_BASE))
  const candidates = [
    explicit,
    ...deriveRenderApiCandidates(),
    ...deriveLocalApiCandidates(),
  ]
    .map(toBaseUrl)
    .filter(Boolean)
  return Array.from(new Set(candidates))
}

let resolvedApiBasePromise

async function resolveApiBase() {
  if (resolvedApiBasePromise) return resolvedApiBasePromise

  resolvedApiBasePromise = (async () => {
    const candidates = getApiCandidates()
    if (!candidates.length) {
      throw new Error('API base URL is not configured (VITE_API_BASE_URL)')
    }

    for (const base of candidates) {
      try {
        const response = await fetch(`${base}/healthz`, { method: 'GET' })
        if (!response.ok) continue
        const payload = await response.json().catch(() => null)
        if (payload?.status === 'ok') return base
      } catch {
        // try next candidate
      }
    }

    throw new Error(`API is unreachable. Checked: ${candidates.join(', ')}`)
  })()

  return resolvedApiBasePromise
}

async function apiFetch(path, options) {
  const base = await resolveApiBase()
  return fetch(`${base}${path}`, options)
}

async function parseJsonResponse(response) {
  const raw = await response.text()
  if (!raw) {
    throw new Error(`HTTP ${response.status}: empty response body`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`HTTP ${response.status}: invalid JSON response`)
  }
}

const fmt = n => new Intl.NumberFormat('ru-RU').format(Number(n || 0))
const fmtValue = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n || 0))
const chartPalette = ['#0d7a5d', '#35a482', '#78bf79', '#a6d653', '#d7df70', '#e8b85c']
const fmtDateTime = value => {
  if (!value) return '—'
  const normalizedValue = typeof value === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
    ? `${value}Z`
    : value
  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}
const fmtShortDateTime = value => {
  if (!value) return '—'
  const normalizedValue = typeof value === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
    ? `${value}Z`
    : value
  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
const fmtMonthYear = value => {
  if (!value) return ''
  const date = new Date(`${value}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(date)
}

function formatPeriodRange(series) {
  const periods = series
    .map(item => String(item.period || ''))
    .filter(period => /^\d{4}-\d{2}$/.test(period))
    .sort()
  if (!periods.length) return ''

  const start = fmtMonthYear(periods[0])
  const end = fmtMonthYear(periods[periods.length - 1])
  if (!start) return ''
  return start === end || !end ? start : `${start} — ${end}`
}

function monthEndDate(period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return ''
  const [year, month] = period.split('-').map(Number)
  const end = new Date(year, month, 0)
  const day = String(end.getDate()).padStart(2, '0')
  return `${period}-${day}`
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map(row => row.map(value => {
      const text = String(value ?? '')
      return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }).join(';'))
    .join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function FilterBar({ compact = false }) {
  return <div className={`filter-bar ${compact ? 'compact' : ''}`}>
    <button><CalendarDays/> Период <ChevronDown/></button>
    <button><Factory/> Площадка <ChevronDown/></button>
    <button className="desktop-filter"><Database/> Источник данных <ChevronDown/></button>
    <button className="icon-only"><Filter/></button>
  </div>
}

function KpiCard({ icon: Icon, label, value, unit, note, tone='green' }) {
  return <div className="kpi-card">
    <div className={`kpi-icon ${tone}`}><Icon/></div>
    <div className="kpi-top"><span>{label}</span></div>
    <div className="kpi-value">{value} <small>{unit}</small></div>
    <div className="kpi-delta"><Check/> <span>{note}</span></div>
  </div>
}

function Card({ title, subtitle, action, children, className='' }) {
  return <section className={`card ${className}`}>
    {(title || action) && <header><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</header>}
    {children}
  </section>
}

function Status({ value }) {
  const cls = value === 'В норме' || value === 'Опубликован' || value === 'Загружен'
    ? 'ok'
    : value === 'Ошибка' || value === 'С ошибкой' || value === 'Открыта'
      ? 'bad'
      : 'work'
  return <span className={`status ${cls}`}>{value}</span>
}

function percentile(values, ratio) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function buildDailySignals(daily) {
  const values = daily.map(item => Number(item.value || 0)).filter(Number.isFinite)
  const controlLimit = percentile(values, .9)
  const changes = daily.slice(1).map((item, index) => {
    const previous = daily[index]
    const previousValue = Number(previous?.value || 0)
    const currentValue = Number(item.value || 0)
    const delta = currentValue - previousValue
    const deltaPct = previousValue ? delta / previousValue : 0
    return {
      date: item.date,
      previousDate: previous?.date,
      value: currentValue,
      delta,
      deltaPct,
      direction: delta >= 0 ? 'Повышение' : 'Спад',
    }
  }).filter(item => Math.abs(item.deltaPct) >= .05 || item.value >= controlLimit)

  return {
    controlLimit,
    events: changes
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
      .slice(0, 5),
  }
}

function EmptyState({ title, text }) {
  return <div className="recon-note">
    <AlertTriangle/>
    <div>
      <b>{title}</b>
      <p>{text}</p>
    </div>
    <button>Ожидает данные <ArrowRight/></button>
  </div>
}

function ReadinessCard({ icon: Icon, eyebrow, title, text, tone = 'green' }) {
  return <article className={`readiness-card ${tone}`}>
    <div className="readiness-icon"><Icon/></div>
    <small>{eyebrow}</small>
    <h3>{title}</h3>
    <p>{text}</p>
  </article>
}

function friendlyApiError(errorText) {
  if (!errorText) return ''
  if (/API base URL is not configured/i.test(errorText)) {
    return 'API URL не настроен. Проверьте VITE_API_BASE_URL в Render.'
  }
  if (/API is unreachable/i.test(errorText)) {
    return 'API недоступен. Проверьте, что backend сервис запущен на Render.'
  }
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(errorText)) {
    return 'История загрузок временно недоступна.'
  }
  return 'Не удалось выполнить операцию. Повторите попытку позже.'
}

async function readApiError(response) {
  const fallback = `HTTP ${response.status}`
  const raw = await response.text().catch(() => '')
  if (!raw) return fallback

  try {
    const payload = JSON.parse(raw)
    if (typeof payload?.detail === 'string') {
      return `${fallback}: ${payload.detail}`
    } else if (Array.isArray(payload?.detail)) {
      return `${fallback}: ${payload.detail.map(item => item?.msg || JSON.stringify(item)).join('; ')}`
    }
    return `${fallback}: ${raw.slice(0, 200)}`
  } catch {
    return `${fallback}: ${raw.slice(0, 200)}`
  }
}

function mapBatchStatus(status) {
  if (status === 'published' || status === 'ready_to_publish' || status === 'uploaded') return 'Загружен'
  if (status === 'needs_review' || status === 'failed' || status === 'rejected') return 'С ошибкой'
  return 'Обработка'
}

function useImportsState() {
  const [imports, setImports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const mergeImports = nextItems => {
    setImports(current => {
      const byId = new Map(current.map(item => [item.id, item]))
      nextItems.forEach(item => byId.set(item.id, item))
      return Array.from(byId.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    })
    setError('')
  }

  const loadImports = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/v1/imports')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await parseJsonResponse(response)
      setImports(data)
    } catch (err) {
      setError(err.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadImports()
  }, [])

  return { imports, loading, error, reload: loadImports, mergeImports }
}

function Overview({ onOpenQuality, onOpenResult, importsState }) {
  const { imports, error, reload } = importsState
  const totalRows = imports.reduce((sum, item) => sum + item.total_rows, 0)
  const totalWarnings = imports.reduce((sum, item) => sum + item.warning_count, 0)
  const totalErrors = imports.reduce((sum, item) => sum + item.error_count, 0)
  const lastBatch = imports[0]
  const hasImports = imports.length > 0
  const readyFiles = imports.filter(item => item.status === 'published' || item.status === 'ready_to_publish').length
  const needsAttention = imports.filter(item => item.error_count > 0 || ['needs_review', 'failed', 'rejected'].includes(item.status)).length
  const metric = value => error ? '—' : fmt(value)
  const metricNote = note => error ? 'нет подключения к API' : note
  const heroTitle = error
    ? 'Данные временно недоступны'
    : hasImports
      ? 'Данные загружены'
      : 'Данных пока нет'
  const heroText = error
    ? 'Не удалось получить сведения о загрузках. Повторите попытку.'
    : hasImports
      ? 'Система пересчитала потребление по показаниям и подготовила управленческий энергобаланс.'
      : 'Загрузите файл, чтобы начать проверку данных.'
  const healthTitle = error
    ? 'Состояние не получено'
    : hasImports
      ? totalErrors
        ? 'Есть замечания к данным'
        : 'Данные прошли проверку'
      : 'Проверка ожидает файл'
  const healthDetails = error
    ? [{ label: '', value: 'Показатели будут доступны после восстановления соединения с сервисом данных.' }]
    : hasImports
      ? [
        { label: 'Последняя загрузка', value: `${fmtDateTime(lastBatch?.created_at)} по вашему времени` },
        { label: 'Проверено строк', value: fmt(totalRows) },
        { label: 'Ошибок', value: fmt(totalErrors) },
        { label: 'Предупреждений', value: fmt(totalWarnings) },
      ]
      : [{ label: '', value: 'После загрузки здесь появится оценка корректности данных.' }]

  return <>
    <div className="hero-row">
      <div><h2>Сводка по данным</h2><p>Готовность загрузок, качество проверки и доступность управленческого анализа.</p></div>
    </div>
    <div className={`overview-hero ${error ? 'is-offline' : hasImports ? 'is-live' : 'is-empty'}`}>
      <div className="overview-hero-copy">
        <span className="eyebrow">СОСТОЯНИЕ ДАННЫХ</span>
        <h3>{heroTitle}</h3>
        <p>{heroText}</p>
        <div className="overview-hero-actions">
          <button className="hero-primary" onClick={hasImports ? ()=>onOpenResult(lastBatch.id) : onOpenQuality}>
            {hasImports ? <ArrowRight/> : <Upload/>} {hasImports ? 'Открыть энергобаланс' : 'Загрузить файл'}
          </button>
        </div>
      </div>
      <div className="overview-hero-panel">
        <small>ПРОВЕРКА ДАННЫХ</small>
        <b>{healthTitle}</b>
        <div className="overview-health-lines">
          {healthDetails.map(item => <div key={`${item.label}-${item.value}`}>
            {item.label && <span>{item.label}</span>}
            <strong>{item.value}</strong>
          </div>)}
        </div>
        <div className="overview-hero-metrics">
          <span><strong>{metric(imports.length)}</strong> файлов</span>
          <span><strong>{metric(readyFiles)}</strong> готовы</span>
          <span><strong>{metric(needsAttention > 0 ? needsAttention : totalErrors)}</strong> с замечаниями</span>
        </div>
      </div>
    </div>
    <div className="kpi-grid">
      <KpiCard icon={Database} label="Загружено файлов" value={metric(imports.length)} unit="" note={metricNote('в журнале загрузок')} />
      <KpiCard icon={FileCheck2} label="Готово к анализу" value={metric(readyFiles)} unit="" note={metricNote('обработка завершена')} tone="blue" />
      <KpiCard icon={Zap} label="Проверено строк" value={metric(totalRows)} unit="" note={metricNote('по загруженным файлам')} tone="yellow" />
      <KpiCard icon={AlertTriangle} label="Замечаний" value={metric(totalErrors)} unit="" note={metricNote('требуют проверки')} tone="red" />
    </div>
    {error && <div className="dashboard-grid">
      <Card className="span-12" title="Порядок работы">
        <div className="upload-status-note">
          <Database/>
          <div>
            <b>{friendlyApiError(error)}</b>
            <p>Показатели будут доступны после восстановления соединения с сервисом данных.</p>
          </div>
          <button onClick={reload}>Повторить подключение <ArrowRight/></button>
        </div>
        <div className="journey-list wide">
          <div><b>1</b><div><strong>Загрузка файла</strong><p>Добавьте файл в формате `.xlsx`, `.xls` или `.csv`.</p></div></div>
          <div><b>2</b><div><strong>Проверка замечаний</strong><p>После загрузки будут показаны результаты проверки данных.</p></div></div>
          <div><b>3</b><div><strong>Переход к следующим разделам</strong><p>После завершения проверки данные можно использовать далее.</p></div></div>
        </div>
      </Card>
    </div>}
    {!error && !hasImports && <div className="dashboard-grid">
      <Card className="span-7" title="Как подготовить данные">
        <div className="journey-list wide">
          <div><b>1</b><div><strong>Загрузка файла</strong><p>Допускаются файлы форматов `.xlsx`, `.xls` и `.csv`.</p></div></div>
          <div><b>2</b><div><strong>Проверка и пересчёт</strong><p>Система проверит структуру и независимо пересчитает расход по показаниям.</p></div></div>
          <div><b>3</b><div><strong>Управленческий анализ</strong><p>Энергобаланс покажет структуру нагрузки, пики и расхождения источников.</p></div></div>
        </div>
      </Card>
      <Card className="span-5" title="Что появится после загрузки">
        <div className="readiness-grid single-column">
          <ReadinessCard icon={FileCheck2} eyebrow="ПОСЛЕ ЗАГРУЗКИ" title="История загруженных файлов" text="На главной странице будут отображаться последние загрузки, статус готовности и общий объём данных." />
          <ReadinessCard icon={AlertTriangle} eyebrow="ПО РЕЗУЛЬТАТАМ ПРОВЕРКИ" title="Замечания по качеству" text="Будут отображаться строки и поля, требующие дополнительной проверки." tone="blue" />
        </div>
      </Card>
    </div>}
    {!error && hasImports && <div className="dashboard-grid">
      <Card className="span-12" title="Последние загрузки">
        <div className="data-table overview-batches-table">
          <div className="tr th"><span>Файл</span><span>Дата</span><span>Статус</span><span>Строк</span></div>
          {imports.slice(0, 5).map(item => <div className="tr" key={item.id}><span>{item.original_filename}</span><span>{fmtShortDateTime(item.created_at)}</span><span><Status value={mapBatchStatus(item.status)}/></span><span>{fmt(item.total_rows)}</span></div>)}
        </div>
      </Card>
    </div>}
  </>
}

function PlaceholderPage({ title, text, importsState }) {
  const { imports } = importsState
  return <>
    <div className="page-actions"><FilterBar compact/><button className="export"><Download/> Экспорт</button></div>
    <div className="kpi-grid three">
      <KpiCard icon={Database} label="Готовые загрузки" value={fmt(imports.filter(item => item.status === 'published' || item.status === 'ready_to_publish').length)} unit="" note="доступны для анализа" />
      <KpiCard icon={AlertTriangle} label="Расчёт раздела" value="0" unit="" note="ожидает подготовку данных" tone="yellow" />
      <KpiCard icon={FileCheck2} label="Исторические ряды" value="0" unit="" note="нужны для точного расчёта" tone="blue" />
    </div>
    <Card title={title} subtitle="Раздел появится после подготовки необходимых рядов данных">
      <EmptyState title="Данные для раздела ещё не готовы" text={text}/>
    </Card>
  </>
}

function EnergyBusinessDashboard({ hasImports, onOpenQuality }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(hasImports)
  const [error, setError] = useState('')
  const [fullscreenChart, setFullscreenChart] = useState(null)
  const [dailySignalsExpanded, setDailySignalsExpanded] = useState(false)

  useEffect(() => {
    if (!hasImports) {
      setResult(null)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const response = await apiFetch('/api/v1/dashboards/energy-business')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await parseJsonResponse(response)
        if (active) setResult(data)
      } catch (err) {
        if (active) setError(err.message || 'Ошибка загрузки')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [hasImports])

  if (!hasImports) {
    return <Card title="Данных пока нет">
      <EmptyState title="Нет данных для энергобаланса" text="Загрузите технический баланс и ежедневную сводку — после обработки экран откроется автоматически."/>
    </Card>
  }

  if (loading) {
    return <div className="result-loading"><span/><b>Готовим визуализацию данных…</b></div>
  }

  if (error || !result?.monthly_series?.length) {
    return <Card title="Энергобаланс пока недоступен">
      <EmptyState title="Данные временно недоступны" text="Вернитесь в раздел качества данных и повторите попытку."/>
    </Card>
  }

  const {
    meta, kpis, monthly_series: monthly, daily_series: daily,
    outgoing_35kv: outgoing, external_groups: externalGroups,
    top_external_consumers: topExternal, reconciliation, data_quality: quality,
    insight, warnings,
  } = result
  const mln = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0) / 1_000_000)
  const percent = value => new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0))
  const signedPercent = value => `${Number(value || 0) >= 0 ? '+' : '−'}${percent(Math.abs(Number(value || 0)))}`
  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${value}T00:00:00`))
    : '—'
  const wordForm = (value, one, few, many) => {
    const number = Math.abs(Number(value || 0)) % 100
    if (number >= 11 && number <= 19) return many
    const last = number % 10
    if (last === 1) return one
    if (last >= 2 && last <= 4) return few
    return many
  }
  const periodLabel = formatPeriodRange(monthly)
  const latestPeriodLabel = fmtMonthYear(meta.latest_period) || meta.latest_label
  const attentionCount = Number(kpis.negative_intervals || 0) + Number(kpis.incomplete_intervals || 0)
  const topExternalTotal = topExternal.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const externalGroupsTotal = externalGroups.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const monthlyComposition = monthly.slice(-3)
  const dailySignals = buildDailySignals(daily)
  const anomalySummary = dailySignals.events.length
    ? `${fmt(dailySignals.events.length)} заметных изменений: ${dailySignals.events.filter(item => item.delta > 0).length} повышений и ${dailySignals.events.filter(item => item.delta < 0).length} спадов относительно предыдущего дня.`
    : 'Резких спадов и повышений относительно предыдущего дня не найдено.'
  const hasMonthlyChange = kpis.mom_change !== null && kpis.mom_change !== undefined

  return <>
    <section className="energy-brief">
      <div className="energy-brief-copy">
        <span className="energy-kicker">ОПЕРАЦИОННЫЙ ЭНЕРГОБАЛАНС · {periodLabel}</span>
        <h2>{insight}</h2>
        <p>Расход пересчитан по показаниям счётчиков и разделён на собственное потребление КОА и внешних потребителей.</p>
      </div>
      <div className="energy-brief-signal">
        <small>ДИНАМИКА ПОТРЕБЛЕНИЯ</small>
        <strong className={Number(kpis.mom_change || 0) >= 0 ? 'up' : 'down'}>{hasMonthlyChange ? signedPercent(kpis.mom_change) : '—'}</strong>
        <span>к предыдущему месяцу</span>
      </div>
    </section>

    <div className="energy-kpis">
      <article>
        <div><span className="energy-kpi-icon total"><Zap/></span><small>ОБЩИЙ ВХОД · {latestPeriodLabel}</small></div>
        <strong>{mln(kpis.total_kwh)}</strong>
        <span>млн кВт·ч</span>
        <p>Независимый пересчёт по исходным показаниям</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon own"><Factory/></span><small>СОБСТВЕННОЕ · КОА</small></div>
        <strong>{mln(kpis.own_kwh)}</strong>
        <span>млн кВт·ч · {percent(kpis.own_share)}</span>
        <p>Общее потребление минус внешние потребители</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon external"><Database/></span><small>ВНЕШНИЕ</small></div>
        <strong>{mln(kpis.external_kwh)}</strong>
        <span>млн кВт·ч · {percent(kpis.external_share)}</span>
        <p>Контролируемая доля внешних потребителей</p>
      </article>
      <article className={attentionCount ? 'attention' : ''}>
        <div><span className="energy-kpi-icon quality"><AlertTriangle/></span><small>КАЧЕСТВО ДНЕВНЫХ ДАННЫХ</small></div>
        <strong>{fmt(kpis.coverage_days)}</strong>
        <span>дней с данными · {fmt(attentionCount)} {wordForm(attentionCount, 'замечание', 'замечания', 'замечаний')}</span>
        <p>Отрицательный расход: {fmt(kpis.negative_intervals)} · неполные интервалы: {fmt(kpis.incomplete_intervals)}</p>
      </article>
    </div>

    <div className="dashboard-grid energy-grid">
      <Card
        className="span-5 energy-chart-card energy-chart-row-primary"
        title="Состав общего потребления"
        subtitle="Последние 3 месяца: КОА и внешние потребители"
      >
        <div className="energy-chart monthly-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим энергобаланс…</div>}>
            <EnergyBusinessCharts kind="monthly" data={monthlyComposition}/>
          </Suspense>
        </div>
        <div className="energy-composition-summary">
          <div><span className="own-dot"/> <small>КОА</small><b>{percent(kpis.own_share)}</b></div>
          <div><span className="external-dot"/> <small>Внешние</small><b>{percent(kpis.external_share)}</b></div>
          <p>Доли показаны для последнего месяца на графике: {latestPeriodLabel}.</p>
        </div>
      </Card>

      <Card
        className="span-7 energy-chart-card energy-chart-row-primary"
        title="Дневная нагрузка"
        subtitle={`${fmt(kpis.coverage_days)} дней · контролируемый вход`}
        action={<div className="chart-card-actions">
          <div className="peak-chip"><span/> Пик {dateLabel(kpis.peak_day?.date)} · {fmt(kpis.peak_day?.value)} кВт·ч</div>
          <button className="chart-expand-btn" type="button" onClick={() => setFullscreenChart('daily')} title="Открыть график на весь экран" aria-label="Открыть график на весь экран"><Maximize2/></button>
        </div>}
      >
        <div className="energy-chart daily-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим дневной профиль…</div>}>
            <EnergyBusinessCharts kind="daily" data={daily} peakDay={kpis.peak_day} controlLimit={dailySignals.controlLimit}/>
          </Suspense>
        </div>
        <div className="load-signal-summary">
          <div><small>КОНТРОЛЬНЫЙ УРОВЕНЬ</small><b>{fmt(dailySignals.controlLimit)} кВт·ч</b></div>
          <p>{anomalySummary} Контрольный уровень показывает границу, выше которой дни считаются пиковыми.</p>
        </div>
        <button
          className={`load-signal-toggle ${dailySignalsExpanded ? 'expanded' : ''}`}
          type="button"
          onClick={() => setDailySignalsExpanded(value => !value)}
        >
          <span>{dailySignals.events.length ? `Изменения нагрузки: ${fmt(dailySignals.events.length)}` : 'Резких изменений нет'}</span>
          <ChevronDown/>
        </button>
        {dailySignalsExpanded && <div className="load-signal-list">
          {dailySignals.events.length ? dailySignals.events.map(item => <div key={`${item.date}-${item.delta}`}>
            <span className={item.delta >= 0 ? 'rise' : 'fall'}>{item.direction}</span>
            <b>{dateLabel(item.date)}</b>
            <small>Контролируемый вход</small>
            <strong>{item.delta >= 0 ? '+' : '−'}{fmt(Math.abs(item.delta))} кВт·ч</strong>
          </div>) : <div>
            <span>Норма</span>
            <b>{latestPeriodLabel}</b>
            <small>Контролируемый вход</small>
            <strong>Без резких изменений</strong>
          </div>}
        </div>}
      </Card>
      {fullscreenChart === 'daily' && <div className="chart-fullscreen" role="dialog" aria-modal="true" aria-label="Дневная нагрузка" onClick={() => setFullscreenChart(null)}>
        <section onClick={event => event.stopPropagation()}>
          <header>
            <div>
              <small>ДЕТАЛЬНАЯ ВИЗУАЛИЗАЦИЯ</small>
              <h3>Дневная нагрузка</h3>
              <p>{fmt(kpis.coverage_days)} дней · пик {dateLabel(kpis.peak_day?.date)} · контрольный уровень {fmt(dailySignals.controlLimit)} кВт·ч</p>
            </div>
            <button type="button" onClick={() => setFullscreenChart(null)} aria-label="Закрыть полноэкранный график"><X/></button>
          </header>
          <div className="chart-fullscreen-body">
            <Suspense fallback={<div className="result-chart-fallback">Строим дневной профиль…</div>}>
              <EnergyBusinessCharts kind="daily" data={daily} peakDay={kpis.peak_day} controlLimit={dailySignals.controlLimit}/>
            </Suspense>
          </div>
        </section>
      </div>}

      <Card
        className="span-7 energy-chart-card energy-chart-row-secondary"
        title={`Расход по линиям 35 кВ · ${latestPeriodLabel}`}
        subtitle="Сравнение направлений одного уровня напряжения"
      >
        <div className="energy-chart outgoing-chart">
          <Suspense fallback={<div className="result-chart-fallback">Считаем направления…</div>}>
            <EnergyBusinessCharts kind="outgoing" data={outgoing}/>
          </Suspense>
        </div>
      </Card>

      <Card
        className="span-5 energy-chart-card energy-chart-row-secondary"
        title={`Внешние потребители · ${latestPeriodLabel}`}
        subtitle="Распределение внешнего потребления по площадкам"
      >
        <div className="energy-chart groups-chart">
          <Suspense fallback={<div className="result-chart-fallback">Группируем площадки…</div>}>
            <EnergyBusinessCharts kind="external" data={externalGroups}/>
          </Suspense>
        </div>
        <div className="energy-composition-summary external-groups-legend">
          {externalGroups.map((item, index) => <div key={item.name}>
            <span style={{ background: chartPalette[index % chartPalette.length] }}/>
            <small>{item.name}</small>
            <b>{externalGroupsTotal ? percent(Number(item.value || 0) / externalGroupsTotal) : '—'}</b>
          </div>)}
        </div>
      </Card>

      <Card
        className="span-7"
        title="Крупнейшие внешние потребители"
        subtitle="Наибольшие объёмы внешнего потребления"
      >
        <div className="energy-ranking">
          {topExternal.map((item, index) => <div key={`${item.name}-${index}`}>
            <b>{String(index + 1).padStart(2, '0')}</b>
            <span><strong>{item.name}</strong><small>{item.group}</small></span>
            <i><em style={{ width: `${Math.max(3, Number(item.value || 0) / Number(topExternal[0]?.value || 1) * 100)}%` }}/></i>
            <strong>{fmt(item.value)}</strong>
            <small>{topExternalTotal ? percent(Number(item.value || 0) / topExternalTotal) : '—'}</small>
          </div>)}
        </div>
      </Card>

      <Card
        className="span-5"
        title="Сверка источников"
        subtitle="Ежедневные сводки против технического баланса"
      >
        <div className="energy-reconciliation">
          {reconciliation.map(item => {
            const isAlert = Math.abs(Number(item.difference_pct || 0)) > .03
            return <div key={item.period}>
              <span className={`recon-month ${isAlert ? 'alert' : ''}`}>{item.label}</span>
              <span><small>Сводка</small><b>{mln(item.daily_kwh)} млн</b></span>
              <span><small>Месяц</small><b>{mln(item.monthly_kwh)} млн</b></span>
              <strong className={isAlert ? 'alert' : ''}>{signedPercent(item.difference_pct)}</strong>
            </div>
          })}
        </div>
        <button className="quality-link" onClick={onOpenQuality}><FileCheck2/> Проверить исходные файлы <ArrowRight/></button>
      </Card>
    </div>

    <section className="energy-method">
      <div><Check/><span><b>Методика</b> `(следующее − текущее) × коэффициент`</span></div>
      <div><AlertTriangle/><span><b>{fmt(quality.formula_mismatches)}</b> расхождений с сохранёнными формулами</span></div>
      {quality.recalculation_difference_kwh != null && <div><FileSpreadsheet/><span>Пересчёт итога: <b>{signedPercent(quality.recalculation_difference_pct)}</b> к значению файла</span></div>}
      <small>{warnings.join(' ')}</small>
    </section>
  </>
}

function PeaksAndAnomaliesPage({ hasImports }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(hasImports)
  const [error, setError] = useState('')
  const [availableFilters, setAvailableFilters] = useState({ periods: [] })
  const [fallbackPeriods, setFallbackPeriods] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [selectedStation, setSelectedStation] = useState('')

  useEffect(() => {
    if (!hasImports) {
      setResult(null)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const params = new URLSearchParams()
        if (selectedPeriod) {
          params.set('date_from', `${selectedPeriod}-01`)
          params.set('date_to', monthEndDate(selectedPeriod))
        }
        const suffix = params.toString() ? `?${params.toString()}` : ''
        const response = await apiFetch(`/api/v1/dashboards/energy-business${suffix}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await parseJsonResponse(response)
        if (active) {
          setResult(data)
          setFallbackPeriods(current => Array.from(new Set([
            ...current,
            ...(data.monthly_series || [])
              .map(item => String(item.period || ''))
              .filter(period => /^\d{4}-\d{2}$/.test(period)),
          ])))
        }
      } catch (err) {
        if (active) setError(err.message || 'Ошибка загрузки')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [hasImports, selectedPeriod])

  useEffect(() => {
    if (!hasImports) return

    let active = true
    ;(async () => {
      try {
        const response = await apiFetch('/api/v1/filters')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await parseJsonResponse(response)
        if (active) setAvailableFilters(data)
      } catch {
        if (active) setAvailableFilters({ periods: [] })
      }
    })()

    return () => {
      active = false
    }
  }, [hasImports])

  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${value}T00:00:00`))
    : '—'
  const periodOptions = Array.from(new Set([...(availableFilters.periods || []), ...fallbackPeriods]))
    .sort()
    .slice(-12)
    .reverse()

  if (!hasImports) {
    return <Card title="Пики и аномалии пока недоступны">
      <EmptyState title="Нет дневного ряда" text="Загрузите технический баланс и ежедневную сводку, чтобы увидеть пики, лимиты и резкие изменения."/>
    </Card>
  }

  if (loading && !result) {
    return <div className="result-loading"><span/><b>Готовим пики и аномалии…</b></div>
  }

  if (error || !result?.daily_series?.length) {
    return <Card title="Пики и аномалии пока недоступны">
      <EmptyState title="Данные временно недоступны" text="Дневной ряд не получен. Повторите попытку после проверки загрузок."/>
    </Card>
  }

  const stationOptions = Array.from(
    (result.daily_series || []).reduce((map, item) => {
      ;(item.sources || []).forEach(source => {
        if (source?.id && source?.name) map.set(source.id, source.name)
      })
      return map
    }, new Map()),
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const periodDailySeries = selectedPeriod
    ? result.daily_series.filter(item => String(item.period || '').startsWith(selectedPeriod) || String(item.date || '').startsWith(selectedPeriod))
    : result.daily_series
  const stationValue = item => {
    const sources = item.sources || []
    if (selectedStation) {
      return Number(sources.find(sourceItem => sourceItem.id === selectedStation)?.value || 0)
    }
    if (sources.length) {
      return sources.reduce((sum, source) => sum + Number(source.value || 0), 0)
    }
    return Number(item.value || 0)
  }
  const filteredDailySeries = periodDailySeries.map(item => ({ ...item, value: stationValue(item) }))
  const dailySignals = buildDailySignals(filteredDailySeries)
  const peakDay = filteredDailySeries.length
    ? filteredDailySeries.reduce((peak, item) => Number(item.value || 0) > Number(peak.value || 0) ? item : peak, filteredDailySeries[0])
    : null
  const selectedPeriodLabel = selectedPeriod ? fmtMonthYear(selectedPeriod) : 'весь период'
  const selectedStationLabel = selectedStation
    ? stationOptions.find(item => item.id === selectedStation)?.name || 'выбранная площадка'
    : 'все площадки'
  const riseCount = dailySignals.events.filter(item => item.delta > 0).length
  const fallCount = dailySignals.events.filter(item => item.delta < 0).length
  const exportPeaks = () => {
    downloadCsv(
      `peaks-anomalies-${selectedPeriod || 'all'}-${selectedStation || 'all-stations'}.csv`,
      [
        ['Дата', 'Площадка', 'Показатель', 'Значение кВт·ч', 'Изменение кВт·ч', 'Изменение %', 'Тип события'],
        ...dailySignals.events.map(item => [
          item.date,
          selectedStationLabel,
          'Контролируемый вход',
          Math.round(item.value),
          Math.round(item.delta),
          `${(item.deltaPct * 100).toFixed(1).replace('.', ',')}%`,
          item.direction,
        ]),
      ],
    )
  }

  return <>
    <div className="page-actions peak-page-actions">
      <div className="peak-filter-bar">
        <label><span>Период</span><div className="period-select-wrap peak-select-wrap"><CalendarDays/><select value={selectedPeriod} onChange={event => setSelectedPeriod(event.target.value)}>
          <option value="">Весь период</option>
          {periodOptions.map(period => <option key={period} value={period}>{fmtMonthYear(period)}</option>)}
        </select><ChevronDown/></div></label>
        <label><span>Площадка</span><div className="period-select-wrap peak-select-wrap"><Factory/><select value={selectedStation} onChange={event => setSelectedStation(event.target.value)}>
          <option value="">Все площадки</option>
          {stationOptions.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
        </select><ChevronDown/></div></label>
      </div>
      {loading && <span className="filter-loading">Обновляем…</span>}
      <button className="export" type="button" onClick={exportPeaks}><Download/> Экспорт</button>
    </div>
    <section className="peak-signal-strip">
      <article className="peak-signal-primary">
        <span><Zap/></span>
        <small>ПИКОВАЯ НАГРУЗКА</small>
        <b>{dateLabel(peakDay?.date)}</b>
        <strong>{fmt(peakDay?.value)} кВт·ч</strong>
      </article>
      <article className="peak-signal-secondary">
        <small>РЕЗКИЕ ИЗМЕНЕНИЯ</small>
        <div className="peak-signal-value"><b>{fmt(dailySignals.events.length)}</b><strong>событий</strong></div>
        <div className="peak-change-breakdown">
          <span className="rise"><TrendingUp/><em>Рост</em><b>{riseCount}</b></span>
          <span className="fall"><TrendingDown/><em>Спад</em><b>{fallCount}</b></span>
        </div>
      </article>
      <article className="peak-signal-secondary">
        <small>КОНТРОЛЬНЫЙ УРОВЕНЬ</small>
        <div className="peak-signal-value"><b>{fmt(dailySignals.controlLimit)}</b><strong>кВт·ч</strong></div>
        <p>уровень, выше которого начинаются пиковые дни</p>
      </article>
    </section>
    <Card
      className="span-12 energy-chart-card"
      title="Пики и аномалии нагрузки"
      subtitle="Даты резких спадов и повышений по контролируемому входу"
      action={<div className="peak-chip"><span/> Пик {dateLabel(peakDay?.date)}</div>}
    >
      <div className="energy-chart peak-anomaly-chart">
        <Suspense fallback={<div className="result-chart-fallback">Строим дневной профиль…</div>}>
          <EnergyBusinessCharts kind="daily" data={filteredDailySeries} peakDay={peakDay} controlLimit={dailySignals.controlLimit}/>
        </Suspense>
      </div>
      <div className="load-signal-summary wide">
        <div><small>ИТОГ ПО ОТКЛОНЕНИЯМ</small><b>{dailySignals.events.length ? `${riseCount} рост · ${fallCount} спад` : 'Без резких изменений'}</b></div>
        <p>{dailySignals.events.length
          ? `Период: ${selectedPeriodLabel}. Площадка: ${selectedStationLabel}. Проверено ${fmt(filteredDailySeries.length)} дней. Найдены даты с заметным изменением нагрузки относительно предыдущего дня.`
          : `Период: ${selectedPeriodLabel}. Площадка: ${selectedStationLabel}. Проверено ${fmt(filteredDailySeries.length)} дней. По дневному ряду нет выраженных скачков относительно предыдущего дня и контрольного уровня.`}</p>
      </div>
      <div className="load-signal-list wide">
        {dailySignals.events.length ? dailySignals.events.map(item => <div key={`${item.date}-${item.delta}`}>
          <span className={item.delta >= 0 ? 'rise' : 'fall'}>{item.direction}</span>
          <b>{dateLabel(item.date)}</b>
          <small>Контролируемый вход</small>
          <strong>{item.delta >= 0 ? '+' : '−'}{fmt(Math.abs(item.delta))} кВт·ч</strong>
        </div>) : <div><span>Норма</span><b>{selectedPeriodLabel}</b><small>Контролируемый вход</small><strong>Без резких изменений</strong></div>}
      </div>
    </Card>
  </>
}

function ForecastPage({ hasImports }) {
  const [result, setResult] = useState(null)
  const [adjustments, setAdjustments] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('energy-forecast-adjustments') || '[]')
    } catch {
      return []
    }
  })
  const [draft, setDraft] = useState({
    name: '',
    kind: 'outage',
    capacity_kw: '',
    utilization_pct: '75',
    start_date: '',
    end_date: '',
  })
  const [loading, setLoading] = useState(hasImports)
  const [error, setError] = useState('')

  useEffect(() => {
    localStorage.setItem('energy-forecast-adjustments', JSON.stringify(adjustments))
  }, [adjustments])

  useEffect(() => {
    if (!hasImports) {
      setResult(null)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const response = await apiFetch('/api/v1/forecasts/energy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adjustments }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await parseJsonResponse(response)
        if (active) setResult(data)
      } catch (err) {
        if (active) setError(err.message || 'Ошибка загрузки')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [hasImports, adjustments])

  useEffect(() => {
    if (!result?.period || draft.start_date) return
    const [year, month] = result.period.split('-').map(Number)
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
    setDraft(current => ({
      ...current,
      start_date: `${result.period}-01`,
      end_date: end,
    }))
  }, [result?.period, draft.start_date])

  if (!hasImports) {
    return <Card title="Прогнозирование пока недоступно">
      <EmptyState title="Нет истории для прогноза" text="Загрузите технический баланс и ежедневную сводку за последний месяц, чтобы построить прогноз."/>
    </Card>
  }

  if (loading && !result) {
    return <div className="result-loading"><span/><b>Считаем прогноз с погодой и проверяем историю…</b></div>
  }

  const forecast = result
  if (error || !forecast || forecast.status !== 'ready') {
    return <Card title="Прогнозирование пока недоступно">
      <EmptyState title="Недостаточно данных" text={forecast?.message || 'Нужен хотя бы один технический баланс с распознанным месяцем.'}/>
    </Card>
  }

  const mln = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0) / 1_000_000)
  const percent = value => new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0))
  const signedPercent = value => `${Number(value || 0) >= 0 ? '+' : '−'}${percent(Math.abs(Number(value || 0)))}`
  const confidencePercent = `${Math.round(Number(forecast.confidence || 0) * 100)}%`
  const sourcePeriodLabel = fmtMonthYear(forecast.source_period)
  const forecastPeriodLabel = fmtMonthYear(forecast.period)
  const mainScenario = forecast.scenarios?.find(item => item.name === 'Базовый') || forecast.scenarios?.[1]
  const backtestAccuracy = forecast.backtest?.accuracy
  const weatherReady = forecast.weather?.status === 'ready'
  const combinedSeries = forecast.combined_series || forecast.series || []
  const totalWeatherAnomalies = Number(forecast.weather?.history_anomaly_days || 0) + Number(forecast.weather?.anomaly_days || 0)
  const signedEnergy = value => `${Number(value || 0) >= 0 ? '+' : '−'}${mln(Math.abs(Number(value || 0)))}`
  const addAdjustment = event => {
    event.preventDefault()
    const capacity = Number(draft.capacity_kw)
    const utilization = Number(draft.utilization_pct) / 100
    if (!draft.name.trim() || capacity <= 0 || utilization <= 0 || !draft.start_date || !draft.end_date) return
    setAdjustments(current => [...current, {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${current.length}`,
      name: draft.name.trim(),
      kind: draft.kind,
      capacity_kw: capacity,
      utilization,
      start_date: draft.start_date,
      end_date: draft.end_date,
    }])
    setDraft(current => ({ ...current, name: '', capacity_kw: '' }))
  }
  const exportForecast = () => {
    downloadCsv(
      `forecast-${forecast.period}.csv`,
      [
        ['Дата', 'Период', 'Факт кВт·ч', 'Прогноз кВт·ч', 'Нижняя граница кВт·ч', 'Верхняя граница кВт·ч', 'Температура °C', 'Источник погоды', 'Погодная поправка кВт·ч', 'События кВт·ч', 'Накопительно кВт·ч'],
        ...combinedSeries.map(item => [
          item.date,
          item.phase === 'actual' ? 'Факт' : 'Прогноз',
          item.actual == null ? '' : Math.round(Number(item.actual)),
          item.value == null ? '' : Math.round(Number(item.value)),
          item.lower == null ? '' : Math.round(Number(item.lower)),
          item.upper == null ? '' : Math.round(Number(item.upper)),
          item.temperature ?? '',
          item.weather_source || '',
          Math.round(Number(item.weather_delta_kwh || 0)),
          Math.round(Number(item.event_delta_kwh || 0)),
          Math.round(Number(item.cumulative || 0)),
        ]),
      ],
    )
  }

  return <>
    <section className="forecast-hero">
      <div>
        <span><TrendingUp/></span>
        <div>
          <small>ПРОГНОЗ НА {String(forecastPeriodLabel).toUpperCase()}</small>
          <b>{mln(forecast.forecast_total_kwh)} млн кВт·ч</b>
          <p>Календарь + история нагрузки + погода + операционные события. База: {sourcePeriodLabel}.</p>
        </div>
      </div>
      <div className="forecast-hero-confidence">
        <div className="forecast-confidence-metric">
          <b>{confidencePercent}</b>
          <span className="forecast-confidence-label">
            уверенность модели
            <button type="button" aria-label="Как рассчитывается уверенность модели" aria-describedby="forecast-confidence-tooltip">
              <Info/>
            </button>
            <span id="forecast-confidence-tooltip" className="forecast-confidence-tooltip" role="tooltip">
              Составной индекс качества прогноза, а не вероятность точного совпадения. Учитывает глубину истории, полноту дневных данных, связь нагрузки с погодой, ошибку бэктеста и волатильность потребления. Диапазон: 40–90%.
            </span>
          </span>
        </div>
        <button className="forecast-export" type="button" onClick={exportForecast}><Download/> Экспорт</button>
      </div>
    </section>

    <div className="kpi-grid">
      <KpiCard icon={Zap} label="Итоговый прогноз" value={mln(forecast.forecast_total_kwh)} unit="млн кВт·ч" note={`${signedPercent(forecast.expected_change_pct)} к последнему месяцу`} />
      <KpiCard icon={Thermometer} label="Влияние погоды" value={signedEnergy(forecast.weather_effect_kwh)} unit="млн кВт·ч" note={weatherReady ? `${totalWeatherAnomalies} аномальных дней на графике` : 'резервный расчёт без погоды'} tone="blue" />
      <KpiCard icon={Factory} label="События мощности" value={signedEnergy(forecast.event_effect_kwh)} unit="млн кВт·ч" note={`${adjustments.length} активных поправок`} tone="yellow" />
      <KpiCard icon={Gauge} label="Точность бэктеста" value={backtestAccuracy == null ? '—' : Math.round(backtestAccuracy * 100)} unit={backtestAccuracy == null ? '' : '%'} note={forecast.backtest?.periods ? `${forecast.backtest.periods} исторических периода` : 'нужно минимум 2 месяца'} tone="green" />
    </div>

    <div className="dashboard-grid">
      <Card
        className="span-12 energy-chart-card combined-forecast-card"
        title={`${sourcePeriodLabel}: факт · ${forecastPeriodLabel}: прогноз`}
        subtitle="Единая временная шкала нагрузки и погоды за два месяца"
        action={<div className="peak-chip forecast-comparison-chip">
          <span/> {sourcePeriodLabel}: {mln(forecast.source_total_kwh)} → {forecastPeriodLabel}: {mln(mainScenario?.value)} млн кВт·ч · {signedPercent(forecast.expected_change_pct)}
        </div>}
      >
        <div className="forecast-chart-legend">
          <span className="actual"><i/> Факт потребления</span>
          <span className="forecast"><i/> Прогноз потребления</span>
          <span className="weather-actual"><i/> Температура · факт</span>
          <span className="weather-forecast"><i/> Температура · прогноз</span>
          <span className="anomaly"><i/> Аномальная погода</span>
        </div>
        <div className="energy-chart forecast-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим прогноз…</div>}>
            <EnergyBusinessCharts kind="forecast" data={combinedSeries}/>
          </Suspense>
        </div>
        <div className="load-signal-summary wide">
          <div><small>ОЖИДАЕМЫЙ ДИАПАЗОН</small><b>{mln(forecast.forecast_low_kwh)}–{mln(forecast.forecast_high_kwh)} млн кВт·ч</b></div>
          <p>Мартовский профиль приведён к общей границе техбаланса. Сплошная синяя температура — известная погода ERA5, фиолетовый пунктир — прогноз API; красные зоны отмечают аномалии.</p>
        </div>
      </Card>

      <Card className="span-12 combined-scenario-card" title="Сценарии месяца" subtitle="Общий расход по техническому балансу">
        <div className="forecast-scenario-layout">
          <div className="scenario-grid forecast-scenarios">
            {(forecast.scenarios || []).map((item, index) => <article className="scenario" key={item.name}>
              <b>{mln(item.value)}</b>
              <span>{item.name}<br/>{signedPercent(item.delta_pct)}</span>
              <i style={{ background: chartPalette[index % chartPalette.length] }}/>
            </article>)}
          </div>
          <div className="forecast-driver-list">
            {(forecast.drivers || []).map(item => <div key={item.label}>
              <span>{item.label}</span>
              <b>{typeof item.value === 'number' ? (Math.abs(item.value) < 1 ? signedPercent(item.value) : fmt(item.value)) : item.value}</b>
            </div>)}
          </div>
        </div>
      </Card>

      <Card
        className="span-12 forecast-control-card"
        title="Операционные поправки"
        subtitle="Датированные изменения установленной мощности пересчитывают прогноз сразу после добавления"
        action={loading && result ? <span className="forecast-recalculating">Пересчёт…</span> : null}
      >
        <form className="forecast-adjustment-form" onSubmit={addAdjustment}>
          <label>
            <span>Событие</span>
            <input value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})} placeholder="Например, ремонт ГПЭС-3"/>
          </label>
          <label>
            <span>Тип влияния</span>
            <select value={draft.kind} onChange={event => setDraft({...draft, kind: event.target.value})}>
              <option value="outage">Остановка</option>
              <option value="derating">Снижение нагрузки</option>
              <option value="addition">Ввод мощности</option>
            </select>
          </label>
          <label>
            <span>Мощность, кВт</span>
            <input type="number" min="1" step="1" value={draft.capacity_kw} onChange={event => setDraft({...draft, capacity_kw: event.target.value})} placeholder="1500"/>
          </label>
          <label>
            <span>Загрузка, %</span>
            <input type="number" min="1" max="100" value={draft.utilization_pct} onChange={event => setDraft({...draft, utilization_pct: event.target.value})}/>
          </label>
          <label>
            <span>Начало</span>
            <input type="date" value={draft.start_date} onChange={event => setDraft({...draft, start_date: event.target.value})}/>
          </label>
          <label>
            <span>Окончание</span>
            <input type="date" value={draft.end_date} onChange={event => setDraft({...draft, end_date: event.target.value})}/>
          </label>
          <button className="forecast-add" type="submit" title="Добавить поправку"><Plus/> Добавить</button>
        </form>
        {adjustments.length > 0
          ? <div className="forecast-adjustment-list">
              {adjustments.map(item => <div key={item.id}>
                <i className={item.kind}/>
                <span><b>{item.name}</b><small>{item.start_date} — {item.end_date}</small></span>
                <strong>{item.kind === 'addition' ? '+' : '−'}{fmt(item.capacity_kw)} кВт · {Math.round(item.utilization * 100)}%</strong>
                <button type="button" title="Удалить поправку" onClick={() => setAdjustments(current => current.filter(candidate => candidate.id !== item.id))}><Trash2/></button>
              </div>)}
            </div>
          : <div className="forecast-adjustment-empty"><Factory/><span>Базовый сценарий без остановок и ввода новых мощностей</span></div>
        }
      </Card>

      <Card className="span-12" title="Погодные данные" subtitle="Источник и качество погодного слоя">
        <div className={`forecast-weather-status ${weatherReady ? 'ready' : 'offline'}`}>
          <CloudSun/>
          <div><small>ИСТОЧНИК</small><b>{forecast.weather?.provider || 'Open-Meteo'}</b></div>
          <div><small>ЛОКАЦИЯ</small><b>{forecast.weather?.location?.name || 'Жанажол'}</b></div>
          <div><small>МОДЕЛЬ НАГРУЗКИ</small><b>HDD / CDD · {forecast.weather?.model?.observations || 0} наблюдений</b></div>
          <div><small>СТАТУС</small><b>{weatherReady ? 'Данные получены' : forecast.weather?.message || 'Без погодной поправки'}</b></div>
        </div>
      </Card>

      <Card className="span-12" title="Как считается прогноз" subtitle="Объяснимая формула и контроль ошибки">
        <div className="forecast-method">
          {(forecast.method || []).map((item, index) => <div key={item}>
            <b>{index + 1}</b>
            <span>{item}</span>
          </div>)}
        </div>
      </Card>
    </div>
  </>
}

function Quality({ importsState, onUploadComplete }) {
  const inputRef = useRef(null)
  const { imports, loading, error, reload, mergeImports } = importsState
  const [issues, setIssues] = useState([])
  const [selectedBatchId, setSelectedBatchId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [previewError, setPreviewError] = useState('')

  const loadPreview = async (batchId, { silent = false } = {}) => {
    setSelectedBatchId(batchId)
    setPreviewError('')
    try {
      const response = await apiFetch(`/api/v1/imports/${batchId}/preview`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const previewData = await parseJsonResponse(response)
      setIssues(previewData.issues)
    } catch (err) {
      if (!silent) {
        setPreviewError(err.message || 'Ошибка загрузки')
      }
      setIssues([])
    }
  }

  useEffect(() => {
    if (imports.length && !selectedBatchId) {
      loadPreview(imports[0].id, { silent: true })
    }
  }, [imports, selectedBatchId])

  const openPicker = () => inputRef.current?.click()

  const onFileChange = async e => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    setPreviewError('')
    try {
      const uploadedBatches = []
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        const response = await apiFetch('/api/v1/imports', { method: 'POST', body: formData })
        if (!response.ok) {
          throw new Error(await readApiError(response))
        }
        const batch = await parseJsonResponse(response)
        uploadedBatches.push(batch)
      }

      const lastBatch = uploadedBatches[uploadedBatches.length - 1]
      setToast(uploadedBatches.length === 1
        ? `Файл ${lastBatch.original_filename} загружен`
        : `Загружено файлов: ${uploadedBatches.length}`
      )
      mergeImports(uploadedBatches)
      await reload().catch(() => {})
      if (lastBatch?.id) {
        onUploadComplete(lastBatch.id)
      }
    } catch (err) {
      setPreviewError(err.message || 'Ошибка загрузки')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const totalRows = imports.reduce((sum, item) => sum + item.total_rows, 0)
  const totalWarnings = imports.reduce((sum, item) => sum + item.warning_count, 0)
  const totalErrors = imports.reduce((sum, item) => sum + item.error_count, 0)
  const successfulImports = imports.filter(item => item.status === 'published' || item.status === 'ready_to_publish').length
  const score = imports.length ? Math.max(0, 100 - totalWarnings * 3 - totalErrors * 10).toFixed(1).replace('.', ',') : '0,0'
  const historyUnavailable = Boolean(error)
  const displayedIssues = issues.map(issue => ({
    sheet: issue.sheet_name || 'n/a',
    file: imports.find(item => item.id === selectedBatchId)?.original_filename || 'n/a',
    field: issue.rule_code,
    issue: issue.message,
    row: issue.row_index || '—',
    state: issue.severity === 'error' ? 'Открыта' : issue.severity === 'warning' ? 'В работе' : 'Исправлена',
  }))

  return <>
    <div className="page-actions">
      <div/>
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" multiple hidden onChange={onFileChange}/>
      <button className="export primary" onClick={openPicker} disabled={uploading}>
        <Upload/> {uploading ? 'Загрузка…' : 'Загрузить файлы'}
      </button>
    </div>
    {toast && <div className="toast"><Check/> {toast} <button onClick={()=>setToast('')}><X/></button></div>}
    {previewError && <div className="toast" style={{ background: '#b42318' }}><AlertTriangle/> {previewError} <button onClick={()=>setPreviewError('')}><X/></button></div>}
    {historyUnavailable && <Card title="Новый файл" className="upload-empty-state">
      <div className="journey-list wide">
        <div><b>1</b><div><strong>Подготовьте файл</strong><p>Используйте файл в формате `.xlsx`, `.xls` или `.csv`.</p></div></div>
        <div><b>2</b><div><strong>Загрузите файл</strong><p>После отправки система начнёт обработку и проверку данных.</p></div></div>
        <div><b>3</b><div><strong>Проверьте результат</strong><p>После завершения обработки будут доступны замечания и статус файла.</p></div></div>
      </div>
    </Card>}
    {!historyUnavailable && <>
    <div className="dq-score"><div className="score-ring"><b>{score}</b><span>из 100</span></div><div><small>ОЦЕНКА КАЧЕСТВА</small><h2>{imports.length ? 'Проверка построена по загруженным файлам' : 'Файлы ещё не загружены'}</h2><p>Проверено {fmt(totalRows)} строк из {imports.length} файлов</p></div><div className="dq-metrics"><span><b>{fmt(totalRows)}</b>Строк</span><span><b>{totalWarnings + totalErrors}</b>Замечаний</span><span><b>{successfulImports} / {imports.length}</b>Готово</span></div></div>
    <div className="kpi-grid three">
      <KpiCard icon={Database} label="Проверено строк" value={fmt(totalRows)} unit="" note="по загруженным файлам"/>
      <KpiCard icon={AlertTriangle} label="Замечаний" value={String(totalWarnings + totalErrors)} unit="" note="требуют проверки" tone="yellow"/>
      <KpiCard icon={FileCheck2} label="Готово" value={`${successfulImports} / ${imports.length}`} unit="" note="файлов обработано" tone="blue"/>
    </div>
    <Card title="Загруженные файлы" subtitle="История обработки файлов">
      <div className="data-table dq-table">
        <div className="tr th"><span>№</span><span>Файл</span><span>Тип данных</span><span>Статус</span><span>Строк</span><span>Замечания</span></div>
        {imports.length ? imports.map(item => <button className={`tr ${selectedBatchId===item.id?'selected':''}`} key={item.id} onClick={()=>loadPreview(item.id)}><span>{item.id}</span><span className="file-name">{item.original_filename}</span><span><code>{item.dataset_kind}</code></span><span><Status value={mapBatchStatus(item.status)}/></span><span>{fmt(item.total_rows)}</span><span>{item.error_count}</span></button>) : <div className="tr"><span>—</span><span>История загрузок появится после первого файла</span><span>—</span><span>—</span><span>—</span><span>—</span></div>}
      </div>
    </Card>
    <Card title="Замечания по файлу" subtitle={selectedBatchId ? `Файл №${selectedBatchId}` : 'Последние результаты проверки'}>
      <div className="data-table dq-table">
        <div className="tr th"><span>Лист</span><span>Файл</span><span>Правило</span><span>Проблема</span><span>Строка</span><span>Статус</span></div>
        {loading ? <div className="tr"><span>…</span><span>Загрузка</span><span>—</span><span>Получение результатов проверки</span><span>—</span><span><Status value="В работе"/></span></div> : displayedIssues.length ? displayedIssues.map((item, index) => <div className="tr" key={index}><span>{item.sheet}</span><span className="file-name">{item.file}</span><span><code>{item.field}</code></span><span>{item.issue}</span><span>{item.row}</span><span><Status value={item.state}/></span></div>) : <div className="tr"><span>—</span><span>{selectedBatchId ? 'Для выбранного файла замечаний нет' : 'Файл не выбран'}</span><span>—</span><span>Замечания появятся после завершения проверки</span><span>—</span><span><Status value="В норме"/></span></div>}
      </div>
    </Card>
    </>}
  </>
}

function Sidebar({ page, setPage, mobile, setMobile, backendState, onResetAllData, resetting }) {
  const backendLabel = backendState === 'pending'
    ? 'Синхронизация'
    : backendState === 'offline'
      ? 'Нет соединения'
      : 'Connected'

  return <aside className={`sidebar ${mobile?'mobile-open':''}`}>
    <div className="logo"><div className="brand-mark"><Zap fill="currentColor"/></div><div><b>ЭнергоПульс</b><span>Казахойл Актобе</span></div><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div>
    <nav>{nav.map(group => <div className="nav-group" key={group.section}><small>{group.section}</small>{group.items.map(({id,label,icon:Icon}) => <button key={id} className={page===id?'active':''} onClick={()=>{setPage(id);setMobile(false)}}><Icon/><span>{label}</span></button>)}</div>)}</nav>
    <div className="sidebar-bottom"><div className={`aws-pill ${backendState}`}><span>AWS</span><div><b>QuickSight</b><small><i/> {backendLabel}</small></div></div><button className="sidebar-danger" onClick={onResetAllData} disabled={resetting}><AlertTriangle/> {resetting ? 'Очистка…' : 'Очистить всё'}</button></div>
  </aside>
}

function AppShell({ dark, setDark }) {
  const [page, setPage] = useState('overview')
  const [mobile, setMobile] = useState(false)
  const [resetting, setResetting] = useState(false)
  const importsState = useImportsState()
  const backendState = importsState.loading ? 'pending' : importsState.error ? 'offline' : 'live'
  const openResult = () => setPage('consumption')

  const resetAllData = async () => {
    if (resetting) return
    const confirmed = window.confirm('Удалить все загрузки, результаты проверки и raw-файлы? Это действие необратимо.')
    if (!confirmed) return

    setResetting(true)
    try {
      const response = await apiFetch('/api/v1/admin/reset', { method: 'POST' })
      if (!response.ok) {
        throw new Error(await readApiError(response))
      }
      await importsState.reload()
      setPage('quality')
      window.alert('Данные очищены. База и raw-файлы сброшены.')
    } catch (err) {
      window.alert(err?.message || 'Не удалось очистить данные')
    } finally {
      setResetting(false)
    }
  }
  const screens = {
    overview: <Overview onOpenQuality={()=>setPage('quality')} onOpenResult={openResult} importsState={importsState}/>,
    consumption: <EnergyBusinessDashboard hasImports={importsState.imports.length > 0} onOpenQuality={()=>setPage('quality')}/>,
    peaks: <PeaksAndAnomaliesPage hasImports={importsState.imports.length > 0}/>,
    forecast: <ForecastPage hasImports={importsState.imports.length > 0}/>,
    reconciliation: <PlaceholderPage title="Месячная сверка" text="Раздел будет сравнивать ежедневные сводки с техническим балансом после подготовки итоговых правил сверки." importsState={importsState}/>,
    quality: <Quality importsState={importsState} onUploadComplete={openResult}/>,
  }
  const title = pageTitles[page]

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} mobile={mobile} setMobile={setMobile} backendState={backendState} onResetAllData={resetAllData} resetting={resetting}/>
    {mobile&&<div className="scrim" onClick={()=>setMobile(false)}/>}
    <div className="main">
      <header className="topbar"><button className="menu-btn" onClick={()=>setMobile(true)}><Menu/></button><div><h1>{title[0]}</h1><p>{title[1]}</p></div><div className="top-actions"><button className="theme-btn" onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button><button className="logout-btn"><LogOut/> <span>Выйти</span></button></div></header>
      <main className="content">{screens[page]}</main>
    </div>
  </div>
}

function Root() {
  const [dark, setDark] = useState(()=>localStorage.getItem('energy-theme')==='dark')
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('energy-theme', dark ? 'dark' : 'light')
  }, [dark])
  return <AppShell dark={dark} setDark={setDark}/>
}

const rootElement = document.getElementById('root')
const reactRoot = globalThis.__ENERGY_PULSE_ROOT__ || createRoot(rootElement)
globalThis.__ENERGY_PULSE_ROOT__ = reactRoot
reactRoot.render(<Root/>)
