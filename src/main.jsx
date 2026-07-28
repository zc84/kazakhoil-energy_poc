import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertTriangle, ArrowRight, CalendarDays, Check, ChevronDown,
  CloudSun, Database, Download, Factory, FileCheck2, FileSpreadsheet, Filter, Gauge,
  Info, LayoutDashboard, Lock, LogOut, MapPin, Maximize2, Menu, Moon, Plus, Sun, Thermometer,
  Trash2, TrendingDown, TrendingUp, Upload, Users, X, Zap,
} from 'lucide-react'
import './styles.css'

const EnergyBusinessCharts = lazy(() => import('./EnergyBusinessCharts.jsx'))

const nav = [
  { section: 'ОБЗОР', items: [{ id: 'overview', label: 'Главная', icon: LayoutDashboard }] },
  { section: 'АНАЛИТИКА', items: [
    { id: 'consumption', label: 'Энергобаланс', icon: Zap },
    { id: 'peaks', label: 'Пики и аномалии', icon: AlertTriangle },
    { id: 'consumers', label: 'Потребители', icon: Users },
    { id: 'forecast', label: 'Прогнозирование', icon: TrendingUp },
  ]},
  { section: 'ДАННЫЕ', items: [
    { id: 'reconciliation', label: 'Месячная сверка', icon: FileCheck2 },
    { id: 'quality', label: 'Загрузка файлов', icon: Database },
  ]},
]

const pageTitles = {
  overview: ['Главная', 'Оперативное состояние данных, загрузок и готовности анализа'],
  consumption: ['Энергобаланс', 'Потребление, структура нагрузки и сверка источников'],
  peaks: ['Пики и аномалии', 'Резкие изменения нагрузки, контрольные уровни и пиковые дни'],
  consumers: ['Потребители', 'Привязка сторонних потребителей к погодным регионам'],
  forecast: ['Прогнозирование', 'Прогноз нагрузки, погодные факторы и сценарии мощности'],
  reconciliation: ['Месячная сверка', 'Сравнение ежедневных сводок с техническим балансом'],
  quality: ['Загрузка файлов', 'Загрузка исходных файлов и подробная проверка структуры'],
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
const WEATHER_REGIONS = [
  { id: 'aktobe', name: 'Актюбинская область', apiName: 'Aktobe Region', latitude: 50.28, longitude: 57.21, timezone: 'Asia/Aqtobe' },
  { id: 'atyrau', name: 'Атырауская область', apiName: 'Atyrau Region', latitude: 47.09, longitude: 51.92, timezone: 'Asia/Atyrau' },
  { id: 'mangystau', name: 'Мангистауская область', apiName: 'Mangystau Region', latitude: 43.65, longitude: 51.16, timezone: 'Asia/Aqtau' },
  { id: 'west-kazakhstan', name: 'Западно-Казахстанская область', apiName: 'West Kazakhstan Region', latitude: 51.23, longitude: 51.37, timezone: 'Asia/Oral' },
  { id: 'kostanay', name: 'Костанайская область', apiName: 'Kostanay Region', latitude: 53.22, longitude: 63.63, timezone: 'Asia/Qostanay' },
  { id: 'north-kazakhstan', name: 'Северо-Казахстанская область', apiName: 'North Kazakhstan Region', latitude: 54.88, longitude: 69.16, timezone: 'Asia/Almaty' },
  { id: 'akmola', name: 'Акмолинская область', apiName: 'Akmola Region', latitude: 53.28, longitude: 69.38, timezone: 'Asia/Almaty' },
  { id: 'pavlodar', name: 'Павлодарская область', apiName: 'Pavlodar Region', latitude: 52.29, longitude: 76.97, timezone: 'Asia/Almaty' },
  { id: 'karaganda', name: 'Карагандинская область', apiName: 'Karaganda Region', latitude: 49.80, longitude: 73.10, timezone: 'Asia/Almaty' },
  { id: 'ulytau', name: 'область Ұлытау', apiName: 'Ulytau Region', latitude: 47.80, longitude: 67.71, timezone: 'Asia/Almaty' },
  { id: 'abay', name: 'область Абай', apiName: 'Abai Region', latitude: 50.41, longitude: 80.25, timezone: 'Asia/Almaty' },
  { id: 'east-kazakhstan', name: 'Восточно-Казахстанская область', apiName: 'East Kazakhstan Region', latitude: 49.95, longitude: 82.61, timezone: 'Asia/Almaty' },
  { id: 'zhetysu', name: 'область Жетісу', apiName: 'Zhetysu Region', latitude: 45.02, longitude: 78.37, timezone: 'Asia/Almaty' },
  { id: 'almaty-region', name: 'Алматинская область', apiName: 'Almaty Region', latitude: 43.88, longitude: 77.07, timezone: 'Asia/Almaty' },
  { id: 'zhambyl', name: 'Жамбылская область', apiName: 'Zhambyl Region', latitude: 44.03, longitude: 72.75, timezone: 'Asia/Almaty' },
  { id: 'turkistan', name: 'Туркестанская область', apiName: 'Turkistan Region', latitude: 43.30, longitude: 68.24, timezone: 'Asia/Almaty' },
  { id: 'kyzylorda', name: 'Кызылординская область', apiName: 'Kyzylorda Region', latitude: 44.85, longitude: 65.51, timezone: 'Asia/Qyzylorda' },
  { id: 'astana', name: 'Астана', apiName: 'Astana', latitude: 51.17, longitude: 71.43, timezone: 'Asia/Almaty' },
  { id: 'almaty-city', name: 'Алматы', apiName: 'Almaty', latitude: 43.24, longitude: 76.89, timezone: 'Asia/Almaty' },
  { id: 'shymkent', name: 'Шымкент', apiName: 'Shymkent', latitude: 42.32, longitude: 69.59, timezone: 'Asia/Almaty' },
]
const CENTRAL_KAZAKHSTAN_REGION_ID = 'karaganda'
const SMALL_CONSUMER_SHARE_LIMIT = 0.1
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
    return 'Адрес сервиса данных не настроен. Проверьте VITE_API_BASE_URL в Render.'
  }
  if (/API is unreachable/i.test(errorText)) {
    return 'Сервис данных недоступен. Проверьте, что серверная часть запущена в Render.'
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

async function uploadImportFile(file, onProgress) {
  const base = await resolveApiBase()
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)
    request.open('POST', `${base}/api/v1/imports`)
    request.upload.onprogress = event => {
      if (!event.lengthComputable) return
      onProgress({ phase: 'uploading', percent: Math.round(event.loaded / event.total * 100) })
    }
    request.upload.onload = () => onProgress({ phase: 'processing', percent: 100 })
    request.onerror = () => reject(new Error('Не удалось передать файл в сервис данных.'))
    request.onload = async () => {
      const response = new Response(request.responseText, {
        status: request.status,
        headers: { 'Content-Type': request.getResponseHeader('Content-Type') || 'application/json' },
      })
      if (!response.ok) {
        reject(new Error(await readApiError(response)))
        return
      }
      try {
        resolve(await parseJsonResponse(response))
      } catch (error) {
        reject(error)
      }
    }
    request.send(formData)
  })
}

function mapBatchStatus(status) {
  if (status === 'published' || status === 'ready_to_publish' || status === 'uploaded') return 'Загружен'
  if (status === 'needs_review' || status === 'failed' || status === 'rejected') return 'С ошибкой'
  return 'Обработка'
}

function mapDatasetKind(kind) {
  if (kind === 'technical_balance') return 'Технический баланс'
  if (kind === 'daily_summary') return 'Ежедневная сводка'
  return 'Не определён'
}

function mapIssueRule(rule) {
  const labels = {
    EMPTY_FILE: 'Пустой файл',
    NO_SHEETS: 'Нет листов',
    UNSUPPORTED_EXTENSION: 'Неподдерживаемый формат',
    MISSING_DEPENDENCY: 'Сервис не готов к обработке',
  }
  return labels[rule] || 'Дополнительная проверка'
}

function mapIssueMessage(issue) {
  const messages = {
    EMPTY_FILE: 'В загруженном файле нет строк, доступных для чтения.',
    NO_SHEETS: 'В книге нет доступных листов.',
    UNSUPPORTED_EXTENSION: 'Формат файла не поддерживается.',
    MISSING_DEPENDENCY: 'Сервис пока не готов к обработке этого формата.',
  }
  return messages[issue.rule_code] || issue.message
}

function consumerKey(name) {
  return String(name || '').trim().casefold?.() || String(name || '').trim().toLowerCase()
}

function useConsumerMappings() {
  const [mappings, setMappings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('energy-consumer-region-mappings') || '{}')
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem('energy-consumer-region-mappings', JSON.stringify(mappings))
  }, [mappings])

  return [mappings, setMappings]
}

function useConsumersState(hasImports) {
  const [consumers, setConsumers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadConsumers = async () => {
    if (!hasImports) {
      setConsumers([])
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/v1/dashboards/energy-business')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await parseJsonResponse(response)
      setConsumers((data.external_consumers || data.top_external_consumers || [])
        .map(item => ({ ...item, id: consumerKey(item.name) }))
        .filter(item => item.id && item.name))
    } catch (err) {
      setConsumers([])
      setError(err.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConsumers()
  }, [hasImports])

  return { consumers, loading, error, reload: loadConsumers }
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
  const metricNote = note => error ? 'нет подключения к сервису данных' : note
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
          <ReadinessCard icon={FileCheck2} eyebrow="ПОСЛЕ ЗАГРУЗКИ" title="История загруженных файлов" text="На главной странице будут отображаться последние загрузки, состояние обработки и общий объём данных." />
          <ReadinessCard icon={AlertTriangle} eyebrow="ПО РЕЗУЛЬТАТАМ ПРОВЕРКИ" title="Замечания по качеству" text="Будут отображаться строки и поля, требующие дополнительной проверки." tone="blue" />
        </div>
      </Card>
    </div>}
    {!error && hasImports && <div className="dashboard-grid">
      <Card className="span-12" title="Последние загрузки">
        <div className="data-table overview-batches-table">
          <div className="tr th"><span>Файл</span><span>Дата</span><span>Состояние</span><span>Строк</span></div>
          {imports.slice(0, 5).map(item => <div className="tr" key={item.id}><span>{item.original_filename}</span><span>{fmtShortDateTime(item.created_at)}</span><span><Status value={mapBatchStatus(item.status)}/></span><span>{fmt(item.total_rows)}</span></div>)}
        </div>
      </Card>
    </div>}
  </>
}

function PlaceholderPage({ title, text, importsState }) {
  const { imports } = importsState
  return <>
    <div className="page-actions"><FilterBar compact/><button className="export"><Download/> Скачать</button></div>
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
    if (!fullscreenChart) return
    const closeOnEscape = event => {
      if (event.key === 'Escape') setFullscreenChart(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [fullscreenChart])

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
      <button className="export" type="button" onClick={exportPeaks}><Download/> Скачать</button>
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

function ConsumersPage({ hasImports, consumersState, mappings, setMappings }) {
  const { consumers, loading, error, reload } = consumersState
  const mappedCount = consumers.filter(item => mappings[item.id]).length
  const totalValue = consumers.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const progress = consumers.length ? mappedCount / consumers.length : 0
  const percent = value => new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0))
  useEffect(() => {
    if (!consumers.length || totalValue <= 0) return
    setMappings(current => {
      let changed = false
      const next = { ...current }
      consumers.forEach(item => {
        if (next[item.id]) return
        if (Number(item.value || 0) / totalValue >= SMALL_CONSUMER_SHARE_LIMIT) return
        next[item.id] = CENTRAL_KAZAKHSTAN_REGION_ID
        changed = true
      })
      return changed ? next : current
    })
  }, [consumers, totalValue, setMappings])
  const setRegion = (consumerId, regionId) => {
    setMappings(current => {
      const next = { ...current }
      if (regionId) next[consumerId] = regionId
      else delete next[consumerId]
      return next
    })
  }
  const fillAktobe = () => {
    setMappings(current => consumers.reduce((next, item) => {
      next[item.id] = next[item.id] || 'aktobe'
      return next
    }, { ...current }))
  }
  const clearMappings = () => {
    setMappings(current => {
      const next = { ...current }
      consumers.forEach(item => delete next[item.id])
      return next
    })
  }

  if (!hasImports) {
    return <Card title="Потребители пока недоступны">
      <EmptyState title="Нет загруженного отчёта" text="Загрузите технический баланс — после первой загрузки здесь появятся сторонние потребители из отчёта."/>
    </Card>
  }

  if (loading && !consumers.length) {
    return <div className="result-loading"><span/><b>Загружаем потребителей из отчёта…</b></div>
  }

  if (error && !consumers.length) {
    return <Card title="Потребители временно недоступны">
      <EmptyState title="Не удалось получить список" text="Проверьте соединение с сервисом данных и повторите загрузку списка потребителей."/>
    </Card>
  }

  return <>
    <div className="page-actions">
      <div className="consumer-progress">
        <span><Users/></span>
        <div><b>{mappedCount} / {consumers.length}</b><small>потребителей привязано к погодным регионам</small></div>
        <i><em style={{ width: `${Math.round(progress * 100)}%` }}/></i>
      </div>
      <div className="consumer-actions">
        {loading && <span className="filter-loading">Обновляем…</span>}
        <button className="export" type="button" onClick={reload}><Database/> Обновить</button>
        <button className="export" type="button" onClick={fillAktobe} disabled={!consumers.length}><MapPin/> Остальные в Актобе</button>
        <button className="export" type="button" onClick={clearMappings} disabled={!mappedCount}><Trash2/> Очистить</button>
      </div>
    </div>
    <div className="kpi-grid three">
      <KpiCard icon={Users} label="Потребители" value={fmt(consumers.length)} unit="" note="из последнего отчёта" />
      <KpiCard icon={MapPin} label="Готовность регионов" value={Math.round(progress * 100)} unit="%" note={progress === 1 ? 'прогноз разблокирован' : 'нужно заполнить все'} tone={progress === 1 ? 'green' : 'yellow'} />
      <KpiCard icon={Zap} label="Объём потребителей" value={fmt(totalValue)} unit="кВт·ч" note="последний период техбаланса" tone="blue" />
    </div>
    <Card title="Привязка к погодным регионам" subtitle="Выбранный регион определяет координаты для получения погоды из Open-Meteo">
      <div className="data-table consumers-table">
        <div className="tr th"><span>Потребитель</span><span>Группа</span><span>Потребление</span><span>Доля</span><span>Погодный регион</span><span>Состояние</span></div>
        {consumers.length ? consumers.map(item => {
          const regionId = mappings[item.id] || ''
          const region = WEATHER_REGIONS.find(candidate => candidate.id === regionId)
          return <div className="tr" key={item.id}>
            <span className="file-name">{item.name}</span>
            <span>{item.group || 'Прочие'}</span>
            <span>{fmt(item.value)} кВт·ч</span>
            <span>{totalValue ? percent(Number(item.value || 0) / totalValue) : '—'}</span>
            <span>
              <select value={regionId} onChange={event => setRegion(item.id, event.target.value)}>
                <option value="">Выберите регион</option>
                {WEATHER_REGIONS.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </span>
            <span><Status value={region ? 'В норме' : 'В работе'}/></span>
          </div>
        }) : <div className="tr"><span>—</span><span>В отчёте не найдены сторонние потребители</span><span>—</span><span>—</span><span>—</span><span><Status value="В работе"/></span></div>}
      </div>
    </Card>
  </>
}

function ForecastChartLegend() {
  return <div className="forecast-chart-legend">
    <div className="forecast-legend-group energy">
      <small>Потребление · левая шкала, кВт·ч</small>
      <div>
        <span className="actual"><i/> Факт</span>
        <span className="forecast"><i/> Прогноз</span>
        <span className="forecast-range"><i/> Прогнозный коридор</span>
      </div>
    </div>
    <div className="forecast-legend-group weather">
      <small>Погода · правая шкала, °C</small>
      <div>
        <span className="weather-actual"><i/> Температура · факт</span>
        <span className="weather-forecast"><i/> Температура · прогноз</span>
        <span className="anomaly"><i/> Аномалия</span>
      </div>
    </div>
  </div>
}

function ForecastPage({ hasImports, consumersState, mappings, forecastReady, onOpenConsumers }) {
  const [result, setResult] = useState(null)
  const [selectedConsumerIds, setSelectedConsumerIds] = useState([])
  const [fullscreenChart, setFullscreenChart] = useState(false)
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
  const consumers = consumersState.consumers || []
  const selectedConsumers = selectedConsumerIds.length
    ? consumers.filter(item => selectedConsumerIds.includes(item.id))
    : consumers
  const weatherLocations = Array.from(selectedConsumers
    .reduce((byRegion, item) => {
      const region = WEATHER_REGIONS.find(candidate => candidate.id === mappings[item.id])
      if (!region) return byRegion
      const current = byRegion.get(region.id) || {
        id: region.id,
        name: region.name,
        latitude: region.latitude,
        longitude: region.longitude,
        timezone: region.timezone,
        weight: 0,
      }
      current.weight += Number(item.value || 0)
      byRegion.set(region.id, current)
      return byRegion
    }, new Map())
    .values())

  useEffect(() => {
    if (!fullscreenChart) return
    const closeOnEscape = event => {
      if (event.key === 'Escape') setFullscreenChart(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [fullscreenChart])

  useEffect(() => {
    localStorage.setItem('energy-forecast-adjustments', JSON.stringify(adjustments))
  }, [adjustments])

  useEffect(() => {
    if (!hasImports || !forecastReady) {
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
          body: JSON.stringify({ adjustments, weather_locations: weatherLocations }),
        })
        if (!response.ok) throw new Error(await readApiError(response))
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
  }, [hasImports, forecastReady, adjustments, selectedConsumerIds, mappings, consumers])

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

  if (!forecastReady) {
    const mappedCount = consumers.filter(item => mappings[item.id]).length
    return <Card title="Прогнозирование заблокировано">
      <div className="forecast-locked">
        <Lock/>
        <div>
          <b>Сначала привяжите всех потребителей к погодным регионам</b>
          <p>Заполнено {mappedCount} из {consumers.length || 0}. После полной привязки прогноз будет учитывать погоду в выбранных областях.</p>
        </div>
        <button type="button" onClick={onOpenConsumers}>Открыть потребителей <ArrowRight/></button>
      </div>
    </Card>
  }

  if (loading && !result) {
    return <div className="result-loading"><span/><b>Считаем прогноз с погодой и проверяем историю…</b></div>
  }

  const rawForecast = result
  if (error) {
    return <Card title="Прогнозирование временно недоступно">
      <EmptyState title="Ошибка расчёта прогноза" text={friendlyApiError(error) || error}/>
    </Card>
  }

  if (!rawForecast || rawForecast.status !== 'ready') {
    return <Card title="Прогнозирование пока недоступно">
      <EmptyState title="Недостаточно данных" text={rawForecast?.message || 'Нужен хотя бы один технический баланс с распознанным месяцем.'}/>
    </Card>
  }

  const mln = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0) / 1_000_000)
  const percent = value => new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0))
  const signedPercent = value => `${Number(value || 0) >= 0 ? '+' : '−'}${percent(Math.abs(Number(value || 0)))}`
  const selectedConsumerValue = selectedConsumerIds.length
    ? selectedConsumers.reduce((sum, item) => sum + Number(item.value || 0), 0)
    : 0
  const consumerScale = selectedConsumerIds.length && Number(rawForecast.source_total_kwh || 0) > 0
    ? selectedConsumerValue / Number(rawForecast.source_total_kwh || 0)
    : 1
  const scalePoint = item => ({
    ...item,
    actual: item.actual == null ? item.actual : Number(item.actual) * consumerScale,
    value: item.value == null ? item.value : Number(item.value) * consumerScale,
    lower: item.lower == null ? item.lower : Number(item.lower) * consumerScale,
    upper: item.upper == null ? item.upper : Number(item.upper) * consumerScale,
    weather_delta_kwh: Number(item.weather_delta_kwh || 0) * consumerScale,
    event_delta_kwh: Number(item.event_delta_kwh || 0) * consumerScale,
    cumulative: item.cumulative == null ? item.cumulative : Number(item.cumulative) * consumerScale,
  })
  const forecast = {
    ...rawForecast,
    source_total_kwh: Number(rawForecast.source_total_kwh || 0) * consumerScale,
    forecast_total_kwh: Number(rawForecast.forecast_total_kwh || 0) * consumerScale,
    forecast_low_kwh: Number(rawForecast.forecast_low_kwh || 0) * consumerScale,
    forecast_high_kwh: Number(rawForecast.forecast_high_kwh || 0) * consumerScale,
    weather_effect_kwh: Number(rawForecast.weather_effect_kwh || 0) * consumerScale,
    event_effect_kwh: Number(rawForecast.event_effect_kwh || 0) * consumerScale,
    scenarios: (rawForecast.scenarios || []).map(item => ({ ...item, value: Number(item.value || 0) * consumerScale })),
    series: (rawForecast.series || []).map(scalePoint),
    combined_series: (rawForecast.combined_series || rawForecast.series || []).map(scalePoint),
  }
  const confidencePercent = `${Math.round(Number(forecast.confidence || 0) * 100)}%`
  const sourcePeriodLabel = fmtMonthYear(forecast.source_period)
  const forecastPeriodLabel = fmtMonthYear(forecast.period)
  const mainScenario = forecast.scenarios?.find(item => item.name === 'Базовый') || forecast.scenarios?.[1]
  const backtestAccuracy = forecast.backtest?.accuracy
  const weatherReady = forecast.weather?.status === 'ready'
  const combinedSeries = forecast.combined_series || forecast.series || []
  const totalWeatherAnomalies = Number(forecast.weather?.history_anomaly_days || 0) + Number(forecast.weather?.anomaly_days || 0)
  const signedEnergy = value => `${Number(value || 0) >= 0 ? '+' : '−'}${mln(Math.abs(Number(value || 0)))}`
  const selectedConsumerLabel = selectedConsumerIds.length
    ? `${selectedConsumerIds.length} потреб. · ${mln(selectedConsumerValue)} млн кВт·ч базы`
    : 'Все потребление'
  const toggleConsumer = consumerId => {
    setSelectedConsumerIds(current => current.includes(consumerId)
      ? current.filter(id => id !== consumerId)
      : [...current, consumerId])
  }
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

  const forecastDeltaPositive = Number(forecast.expected_change_pct || 0) >= 0

  return <div className="forecast-page">
    <section className="forecast-command">
      <div className="forecast-command-main">
        <div className="forecast-live"><i/> РАСЧЁТ АКТУАЛЕН <span>·</span> {String(forecastPeriodLabel).toUpperCase()}</div>
        <div className="forecast-command-value">
          <b>{mln(forecast.forecast_total_kwh)}</b>
          <span>млн<br/>кВт·ч</span>
        </div>
        <div className="forecast-command-context">
          <span className={forecastDeltaPositive ? 'positive' : 'negative'}>
            {forecastDeltaPositive ? <TrendingUp/> : <TrendingDown/>}
            {signedPercent(forecast.expected_change_pct)}
          </span>
          <p>к {sourcePeriodLabel}. Учтены календарь, погода и операционные события.</p>
        </div>
      </div>
      <div className="forecast-command-side">
        <div className="forecast-confidence-ring" style={{ '--confidence': `${Math.round(Number(forecast.confidence || 0) * 100) * 3.6}deg` }}>
          <div><b>{confidencePercent}</b><small>уверенность</small></div>
        </div>
        <div className="forecast-confidence-copy">
          <span className="forecast-confidence-label">
            Надёжность модели
            <button type="button" aria-label="Как рассчитывается уверенность модели" aria-describedby="forecast-confidence-tooltip">
              <Info/>
            </button>
            <span id="forecast-confidence-tooltip" className="forecast-confidence-tooltip" role="tooltip">
              Составной показатель качества прогноза, а не вероятность точного совпадения. Учитывает глубину истории, полноту дневных данных, связь нагрузки с погодой, ошибку проверки на истории и изменчивость потребления. Диапазон: 40–90%.
            </span>
          </span>
          <small>{backtestAccuracy == null ? 'Проверка на истории будет доступна после накопления данных' : `Точность на исторических данных ${Math.round(backtestAccuracy * 100)}%`}</small>
          <button className="forecast-export" type="button" onClick={exportForecast}><Download/> Скачать таблицу</button>
        </div>
      </div>
    </section>

    <section className="forecast-scope" aria-label="Область прогноза">
      <div className="forecast-scope-label">
        <Filter/>
        <div><small>ОБЛАСТЬ ПРОГНОЗА</small><b>{selectedConsumerLabel}</b></div>
      </div>
      <div className="forecast-scope-chips">
        {consumers.map(item => {
          const active = selectedConsumerIds.includes(item.id)
          const region = WEATHER_REGIONS.find(candidate => candidate.id === mappings[item.id])
          return <button type="button" key={item.id} className={active ? 'active' : ''} onClick={() => toggleConsumer(item.id)} title={`${region?.name || 'Регион не указан'} · ${fmt(item.value)} кВт·ч`}>
            <span>{item.name}</span>
            {active && <Check/>}
          </button>
        })}
      </div>
      <button type="button" className="forecast-scope-reset" onClick={() => setSelectedConsumerIds([])} disabled={!selectedConsumerIds.length}>Все потребители</button>
    </section>

    <section className="forecast-signal-strip" aria-label="Ключевые факторы прогноза">
      <article>
        <span className="forecast-signal-icon weather"><Thermometer/></span>
        <div><small>ПОГОДА</small><b>{signedEnergy(forecast.weather_effect_kwh)} <em>млн кВт·ч</em></b></div>
        <p>{weatherReady ? `${totalWeatherAnomalies} аномальных дней` : 'резервный расчёт'}</p>
      </article>
      <article>
        <span className="forecast-signal-icon event"><Factory/></span>
        <div><small>СОБЫТИЯ</small><b>{signedEnergy(forecast.event_effect_kwh)} <em>млн кВт·ч</em></b></div>
        <p>{adjustments.length ? `${adjustments.length} в сценарии` : 'базовый режим'}</p>
      </article>
      <article>
        <span className="forecast-signal-icon range"><Gauge/></span>
        <div><small>КОРИДОР</small><b>{mln(forecast.forecast_low_kwh)}–{mln(forecast.forecast_high_kwh)}</b></div>
        <p>млн кВт·ч</p>
      </article>
    </section>

    <div className="forecast-workspace">
      <Card
        className="energy-chart-card combined-forecast-card forecast-main-chart"
        title={`${sourcePeriodLabel}: факт · ${forecastPeriodLabel}: прогноз`}
        subtitle="Нагрузка и температура на единой временной шкале"
        action={<div className="chart-card-actions">
          <div className="peak-chip forecast-comparison-chip">
            <span/> {mln(forecast.source_total_kwh)} → {mln(mainScenario?.value)} млн кВт·ч
          </div>
          <button className="chart-expand-btn" type="button" onClick={() => setFullscreenChart(true)} title="Открыть график на весь экран" aria-label="Открыть график прогноза на весь экран"><Maximize2/></button>
        </div>}
      >
        <div className="energy-chart forecast-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим прогноз…</div>}>
            <EnergyBusinessCharts kind="forecast" data={combinedSeries} showWeather/>
          </Suspense>
        </div>
        <ForecastChartLegend/>
        <div className="load-signal-summary wide">
          <div><small>ОЖИДАЕМЫЙ ДИАПАЗОН</small><b>{mln(forecast.forecast_low_kwh)}–{mln(forecast.forecast_high_kwh)} млн кВт·ч</b></div>
          <p>Профиль приведён к границе техбаланса. Красные зоны отмечают погодные аномалии; наведите на день, чтобы увидеть вклад факторов.</p>
        </div>
      </Card>

      <Card className="forecast-scenario-rail" title="Сценарии" subtitle="Границы управленческого решения">
        <div className="forecast-scenarios">
          {(forecast.scenarios || []).map((item, index) => <article className={`scenario ${item.name === 'Базовый' ? 'primary' : ''}`} key={item.name}>
            <span>{item.name}<small>{signedPercent(item.delta_pct)}</small></span>
            <b>{mln(item.value)}<em>млн кВт·ч</em></b>
            <i style={{ '--scenario-color': chartPalette[index % chartPalette.length] }}/>
          </article>)}
        </div>
        <div className="forecast-rail-divider"><span>Факторы модели</span></div>
        <div className="forecast-driver-list">
          {(forecast.drivers || []).map(item => <div key={item.label}>
            <span>{item.label}</span>
            <b>{typeof item.value === 'number' ? (Math.abs(item.value) < 1 ? signedPercent(item.value) : fmt(item.value)) : item.value}</b>
          </div>)}
        </div>
      </Card>
    </div>

    {fullscreenChart && <div className="chart-fullscreen" role="dialog" aria-modal="true" aria-label="Прогноз нагрузки" onClick={() => setFullscreenChart(false)}>
      <section onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <small>ДЕТАЛЬНАЯ ВИЗУАЛИЗАЦИЯ</small>
            <h3>{sourcePeriodLabel}: факт · {forecastPeriodLabel}: прогноз</h3>
            <p>Ожидаемый диапазон {mln(forecast.forecast_low_kwh)}–{mln(forecast.forecast_high_kwh)} млн кВт·ч · уверенность модели {confidencePercent}</p>
          </div>
          <button type="button" onClick={() => setFullscreenChart(false)} aria-label="Закрыть полноэкранный график"><X/></button>
        </header>
        <div className="chart-fullscreen-body forecast-fullscreen-body">
          <div className="forecast-fullscreen-chart">
            <Suspense fallback={<div className="result-chart-fallback">Строим прогноз…</div>}>
              <EnergyBusinessCharts kind="forecast" data={combinedSeries} showWeather/>
            </Suspense>
          </div>
          <ForecastChartLegend/>
        </div>
      </section>
    </div>}

    <div className="dashboard-grid forecast-lower-grid">
      <Card
        className="span-12 forecast-control-card"
        title="Сценарное управление"
        subtitle="Добавьте остановку, ограничение или ввод мощности — прогноз пересчитается автоматически"
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

      <Card className="span-12 forecast-assurance-card" title="Контроль качества модели" subtitle="Источники, полнота и методика расчёта">
        <div className={`forecast-weather-status ${weatherReady ? 'ready' : 'offline'}`}>
          <CloudSun/>
          <div><small>ИСТОЧНИК</small><b>{forecast.weather?.provider || 'Open-Meteo'}</b></div>
          <div><small>МЕСТО ПРОГНОЗА</small><b>{forecast.weather?.location?.name || 'Жанажол'}</b></div>
          <div><small>МОДЕЛЬ НАГРУЗКИ</small><b>Холод и жара · {forecast.weather?.model?.observations || 0} наблюдений</b></div>
          <div><small>СОСТОЯНИЕ</small><b>{weatherReady ? 'Данные получены' : forecast.weather?.message || 'Без погодной поправки'}</b></div>
        </div>
        <details className="forecast-method-details">
          <summary>Как считается прогноз <ChevronDown/></summary>
          <div className="forecast-method">
            {(forecast.method || []).map((item, index) => <div key={item}>
              <b>{index + 1}</b>
              <span>{item}</span>
            </div>)}
          </div>
        </details>
      </Card>
    </div>
  </div>
}

function UploadProgressWidget({ progress, onClose }) {
  if (!progress) return null
  const isDone = progress.phase === 'done'
  const isError = progress.phase === 'error'
  const currentShare = progress.phase === 'processing'
    ? .94
    : Math.min(1, Number(progress.percent || 0) / 100)
  const overallPercent = isDone
    ? 100
    : Math.round((progress.completed + currentShare) / progress.total * 100)
  const phaseLabel = progress.phase === 'uploading'
    ? `Передаём файл · ${progress.percent || 0}%`
    : progress.phase === 'processing'
      ? 'Проверяем структуру и строки'
      : isDone
        ? 'Набор данных готов'
        : 'Загрузка остановлена'

  return <aside className={`upload-progress-widget ${progress.phase}`} role="status" aria-live="polite" aria-label="Ход загрузки набора данных">
    <div className="upload-progress-head">
      <span className="upload-progress-icon">
        {isDone ? <Check/> : isError ? <AlertTriangle/> : <Upload/>}
      </span>
      <div>
        <small>{isDone ? 'ЗАГРУЗКА ЗАВЕРШЕНА' : isError ? 'НУЖНО ВНИМАНИЕ' : 'НОВЫЙ НАБОР ДАННЫХ'}</small>
        <b>{phaseLabel}</b>
      </div>
      {(isDone || isError) && <button type="button" onClick={onClose} aria-label="Закрыть сообщение о загрузке"><X/></button>}
    </div>
    {!isDone && !isError && <div className="upload-progress-file">
      <FileSpreadsheet/>
      <span><b>{progress.currentName}</b><small>Файл {progress.currentIndex + 1} из {progress.total}</small></span>
    </div>}
    {isError && <p>{progress.message}</p>}
    <div className="upload-progress-track" aria-hidden="true"><i style={{ width: `${Math.max(3, overallPercent)}%` }}/></div>
    <div className="upload-progress-meta">
      <span>{progress.completed} из {progress.total} файлов обработано</span>
      <b>{overallPercent}%</b>
    </div>
  </aside>
}

function Quality({ importsState, onUploadComplete }) {
  const inputRef = useRef(null)
  const { imports, loading, error, reload, mergeImports } = importsState
  const [issues, setIssues] = useState([])
  const [selectedBatchId, setSelectedBatchId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
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
    setUploadProgress({
      phase: 'uploading',
      total: files.length,
      completed: 0,
      currentIndex: 0,
      currentName: files[0].name,
      percent: 0,
    })
    try {
      const uploadedBatches = []
      for (const [index, file] of files.entries()) {
        setUploadProgress(current => ({
          ...current,
          phase: 'uploading',
          completed: index,
          currentIndex: index,
          currentName: file.name,
          percent: 0,
        }))
        const batch = await uploadImportFile(file, update => {
          setUploadProgress(current => ({ ...current, ...update }))
        })
        uploadedBatches.push(batch)
        setUploadProgress(current => ({ ...current, completed: index + 1 }))
      }

      const lastBatch = uploadedBatches[uploadedBatches.length - 1]
      setToast(uploadedBatches.length === 1
        ? `Файл ${lastBatch.original_filename} загружен`
        : `Загружено файлов: ${uploadedBatches.length}`
      )
      mergeImports(uploadedBatches)
      await reload().catch(() => {})
      setUploadProgress(current => ({ ...current, phase: 'done', completed: files.length, percent: 100 }))
      if (lastBatch?.id) {
        onUploadComplete(lastBatch.id)
      }
      window.setTimeout(() => setUploadProgress(current => current?.phase === 'done' ? null : current), 1800)
    } catch (err) {
      const message = err.message || 'Ошибка загрузки'
      setPreviewError(message)
      setUploadProgress(current => ({ ...current, phase: 'error', message }))
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
    field: mapIssueRule(issue.rule_code),
    issue: mapIssueMessage(issue),
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
    <UploadProgressWidget progress={uploadProgress} onClose={() => setUploadProgress(null)}/>
    {historyUnavailable && <Card title="Новый файл" className="upload-empty-state">
      <div className="journey-list wide">
        <div><b>1</b><div><strong>Подготовьте файл</strong><p>Используйте файл в формате `.xlsx`, `.xls` или `.csv`.</p></div></div>
        <div><b>2</b><div><strong>Загрузите файл</strong><p>После отправки система начнёт обработку и проверку данных.</p></div></div>
        <div><b>3</b><div><strong>Проверьте результат</strong><p>После завершения обработки будут доступны замечания и состояние файла.</p></div></div>
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
        <div className="tr th"><span>№</span><span>Файл</span><span>Тип данных</span><span>Состояние</span><span>Строк</span><span>Замечания</span></div>
        {imports.length ? imports.map(item => <button className={`tr ${selectedBatchId===item.id?'selected':''}`} key={item.id} onClick={()=>loadPreview(item.id)}><span>{item.id}</span><span className="file-name">{item.original_filename}</span><span>{mapDatasetKind(item.dataset_kind)}</span><span><Status value={mapBatchStatus(item.status)}/></span><span>{fmt(item.total_rows)}</span><span>{item.error_count}</span></button>) : <div className="tr"><span>—</span><span>История загрузок появится после первого файла</span><span>—</span><span>—</span><span>—</span><span>—</span></div>}
      </div>
    </Card>
    <Card title="Замечания по файлу" subtitle={selectedBatchId ? `Файл №${selectedBatchId}` : 'Последние результаты проверки'}>
      <div className="data-table dq-table">
        <div className="tr th"><span>Лист</span><span>Файл</span><span>Правило</span><span>Проблема</span><span>Строка</span><span>Состояние</span></div>
        {loading ? <div className="tr"><span>…</span><span>Загрузка</span><span>—</span><span>Получение результатов проверки</span><span>—</span><span><Status value="В работе"/></span></div> : displayedIssues.length ? displayedIssues.map((item, index) => <div className="tr" key={index}><span>{item.sheet}</span><span className="file-name">{item.file}</span><span><code>{item.field}</code></span><span>{item.issue}</span><span>{item.row}</span><span><Status value={item.state}/></span></div>) : <div className="tr"><span>—</span><span>{selectedBatchId ? 'Для выбранного файла замечаний нет' : 'Файл не выбран'}</span><span>—</span><span>Замечания появятся после завершения проверки</span><span>—</span><span><Status value="В норме"/></span></div>}
      </div>
    </Card>
    </>}
  </>
}

function Sidebar({ page, setPage, mobile, setMobile, backendState, onResetAllData, resetting, hasImports, forecastReady }) {
  const backendLabel = backendState === 'pending'
    ? 'Синхронизация'
    : backendState === 'offline'
      ? 'Нет соединения'
      : 'Подключено'
  const isLocked = id => (id === 'consumers' && !hasImports) || (id === 'forecast' && !forecastReady)

  return <aside className={`sidebar ${mobile?'mobile-open':''}`}>
    <div className="logo"><div className="brand-mark"><Zap fill="currentColor"/></div><div><b>ЭнергоПульс</b><span>Казахойл Актобе</span></div><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div>
    <nav>{nav.map(group => <div className="nav-group" key={group.section}><small>{group.section}</small>{group.items.map(({id,label,icon:Icon}) => {
      const locked = isLocked(id)
      return <button key={id} className={page===id?'active':''} disabled={locked} title={locked ? 'Раздел пока заблокирован' : label} onClick={()=>{setPage(id);setMobile(false)}}><Icon/><span>{label}</span>{locked && <Lock/>}</button>
    })}</div>)}</nav>
    <div className="sidebar-bottom"><div className={`aws-pill ${backendState}`}><span>AWS</span><div><b>QuickSight</b><small><i/> {backendLabel}</small></div></div><button className="sidebar-danger" onClick={onResetAllData} disabled={resetting}><AlertTriangle/> {resetting ? 'Очистка…' : 'Очистить всё'}</button></div>
  </aside>
}

function AppShell({ dark, setDark }) {
  const [page, setPage] = useState('overview')
  const [mobile, setMobile] = useState(false)
  const [resetting, setResetting] = useState(false)
  const importsState = useImportsState()
  const hasImports = importsState.imports.length > 0
  const consumersState = useConsumersState(hasImports)
  const [consumerMappings, setConsumerMappings] = useConsumerMappings()
  const forecastReady = hasImports && consumersState.consumers.length > 0 && consumersState.consumers.every(item => consumerMappings[item.id])
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
      setConsumerMappings({})
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
    consumption: <EnergyBusinessDashboard hasImports={hasImports} onOpenQuality={()=>setPage('quality')}/>,
    peaks: <PeaksAndAnomaliesPage hasImports={hasImports}/>,
    consumers: <ConsumersPage hasImports={hasImports} consumersState={consumersState} mappings={consumerMappings} setMappings={setConsumerMappings}/>,
    forecast: <ForecastPage hasImports={hasImports} consumersState={consumersState} mappings={consumerMappings} forecastReady={forecastReady} onOpenConsumers={()=>setPage('consumers')}/>,
    reconciliation: <PlaceholderPage title="Месячная сверка" text="Раздел будет сравнивать ежедневные сводки с техническим балансом после подготовки итоговых правил сверки." importsState={importsState}/>,
    quality: <Quality importsState={importsState} onUploadComplete={()=>setPage('consumers')}/>,
  }
  const title = pageTitles[page]

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} mobile={mobile} setMobile={setMobile} backendState={backendState} onResetAllData={resetAllData} resetting={resetting} hasImports={hasImports} forecastReady={forecastReady}/>
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
