import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle, ArrowRight, CalendarDays, Check, ChevronDown,
  Bot, BrainCircuit, CloudSun, Database, Download, Eye, EyeOff, Factory, FileCheck2,
  FileSpreadsheet, Filter, Gauge, Info, KeyRound, LayoutDashboard, Lock, LogOut,
  MapPin, Maximize2, Menu, MessageCircle, Moon, Plus, RotateCcw, Save, Search, Send,
  Settings2, Sparkles, Sun, Thermometer, Trash2, TrendingDown, TrendingUp, Upload,
  Users, X, Zap,
} from 'lucide-react'
import './styles.css'

const EnergyBusinessCharts = lazy(() => import('./EnergyBusinessCharts.jsx'))

const nav = [
  { section: 'ОБЗОР', items: [{ id: 'overview', label: 'Сводка', icon: LayoutDashboard }] },
  { section: 'АНАЛИТИКА', items: [
    { id: 'consumption', label: 'Энергобаланс', icon: Zap },
    { id: 'technicalBalance', label: 'Тех. баланс', icon: FileSpreadsheet },
    { id: 'dailyConsumption', label: 'Ежедневное потребление', icon: CalendarDays },
    { id: 'peaks', label: 'Пики и аномалии', icon: AlertTriangle },
    { id: 'consumers', label: 'Потребители', icon: Users },
    { id: 'forecast', label: 'Прогноз', icon: TrendingUp },
  ]},
  { section: 'ДАННЫЕ', items: [
    { id: 'reconciliation', label: 'Месячная сверка', icon: FileCheck2 },
    { id: 'quality', label: 'Исходные данные', icon: Database },
  ]},
  { section: 'СИСТЕМА', items: [
    { id: 'aiSettings', label: 'ЭнергоПульс AI', icon: Settings2 },
  ]},
]

const pageTitles = {
  overview: ['Сводка', 'Загрузки, проверки и расчёты'],
  consumption: ['Энергобаланс', 'Поступление и расход электроэнергии'],
  technicalBalance: ['Тех. баланс', 'Объекты учёта, показания и расход'],
  dailyConsumption: ['Ежедневное потребление', 'Счётчики и подстанции по дням'],
  peaks: ['Пики и аномалии', 'Суточные превышения и изменения нагрузки'],
  consumers: ['Потребители', 'Объекты нагрузки и погодные регионы'],
  forecast: ['Прогноз', 'Расчёт нагрузки по истории и погоде'],
  reconciliation: ['Месячная сверка', 'Сводки и технический баланс'],
  quality: ['Исходные данные', 'Файлы и протокол проверки'],
  aiSettings: ['ЭнергоПульс AI', 'Подключение и параметры модели'],
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

function periodFromFilename(filename) {
  const value = String(filename || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
  const year = value.match(/\b(20\d{2})\b/)?.[1]
  if (!year) return ''
  const months = [
    ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4],
    ['май', 5], ['мая', 5], ['июн', 6], ['июл', 7],
    ['август', 8], ['сентябр', 9], ['октябр', 10],
    ['ноябр', 11], ['декабр', 12],
  ]
  const month = months.find(([stem]) => value.includes(stem))?.[1]
  return month ? `${year}-${String(month).padStart(2, '0')}` : ''
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
    <button className="desktop-filter"><Database/> Источник <ChevronDown/></button>
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

function daysInPeriod(period) {
  const [year, month] = String(period || '').split('-').map(Number)
  if (!year || !month) return 0
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function buildDailySignals(daily) {
  const values = daily.map(item => Number(item.value || 0)).filter(Number.isFinite)
  const controlLimit = percentile(values, .9)
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
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
      direction: delta >= 0 ? 'Рост' : 'Снижение',
    }
  }).filter(item => Math.abs(item.deltaPct) >= .05 || item.value >= controlLimit)

  return {
    controlLimit,
    average,
    events: changes
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
      .slice(0, 5),
  }
}

const PEAK_SEGMENTS = [
  { id: 'all', label: 'Все' },
  { id: 'koa', label: 'КОА' },
  { id: 'external', label: 'Субпотребители' },
]

function EmptyState({ title, text, actionLabel = 'Нужны данные', onAction }) {
  return <div className="recon-note">
    <AlertTriangle/>
    <div>
      <b>{title}</b>
      <p>{text}</p>
    </div>
    <button type="button" onClick={onAction} disabled={!onAction}>{actionLabel} <ArrowRight/></button>
  </div>
}

function AnalyticsBlockedState({ files, onOpenQuality, onDeleteInvalid, deletingImportIds = [] }) {
  const [issuesByBatch, setIssuesByBatch] = useState({})

  useEffect(() => {
    let active = true
    const ids = files.map(item => item.id).filter(Boolean)
    if (!ids.length) {
      setIssuesByBatch({})
      return undefined
    }
    ;(async () => {
      const entries = await Promise.all(ids.map(async id => {
        const issues = await fetchImportIssues(id).catch(() => [])
        return [id, issues]
      }))
      if (active) setIssuesByBatch(Object.fromEntries(entries))
    })()
    return () => { active = false }
  }, [files.map(item => item.id).join(',')])

  const totalRows = files.reduce((sum, item) => sum + Number(item.total_rows || 0), 0)

  return <section className="analytics-blocked">
    <div className="analytics-blocked-hero">
      <span><AlertTriangle/></span>
      <div>
        <small>РАСЧЁТЫ ПРИОСТАНОВЛЕНЫ</small>
        <h2>Аналитика недоступна: не все обязательные файлы прошли проверку</h2>
        <p>{analyticsBlockReason(files)} Чтобы не показать неполную или неверную картину, графики и KPI временно скрыты.</p>
      </div>
    </div>
    <div className="analytics-blocked-summary">
      <div><b>{fmt(files.length)}</b><span>файлов требуют исправления</span></div>
      <div><b>{fmt(totalRows)}</b><span>строк не участвуют в аналитике</span></div>
      <div><b>0</b><span>расчётов построено по неполной пачке</span></div>
    </div>
    <Card title="Что мешает построить аналитику" subtitle="Конкретные ошибки ETL по обязательным файлам">
      <div className="analytics-blocked-list">
        {files.map(file => {
          const issues = issuesByBatch[file.id] || []
          const reason = formatValidationReason(file, issues)
          const details = formatValidationDetails(file, issues)
          return <article key={file.id}>
            <FileSpreadsheet/>
            <div>
              <b>{file.original_filename}</b>
              <p>{reason}</p>
              <small>{details}</small>
            </div>
            <div className="analytics-blocked-row-actions">
              <Status value="С ошибкой"/>
              <button
                type="button"
                onClick={() => onDeleteInvalid?.(file)}
                disabled={deletingImportIds.includes(file.id)}
                title="Удалить файл, не прошедший валидацию"
              >
                <Trash2/> {deletingImportIds.includes(file.id) ? 'Удаляем…' : 'Удалить'}
              </button>
            </div>
          </article>
        })}
      </div>
      <div className="analytics-blocked-action">
        <p>Исправьте перечисленные файлы или загрузите версию в поддерживаемом шаблоне. После успешной проверки аналитика откроется автоматически.</p>
        <div>
          <a
            className="export"
            href="/templates/energopulse-daily-summary-template.xlsx"
            download="Шаблон ежедневной сводки ЭнергоПульс.xlsx"
          >
            <Download/> Скачать Excel-шаблон
          </a>
          <button type="button" className="export primary" onClick={onOpenQuality}>Открыть исходные данные <ArrowRight/></button>
        </div>
      </div>
    </Card>
  </section>
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
    return 'Не указан адрес сервиса данных. Проверьте VITE_API_BASE_URL в Render.'
  }
  if (/API is unreachable/i.test(errorText)) {
    return 'Нет связи с сервисом данных. Проверьте запуск API в Render.'
  }
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(errorText)) {
    return 'Не удалось загрузить историю файлов.'
  }
  return 'Что-то пошло не так. Повторите попытку.'
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
    request.onerror = () => reject(new Error('Не удалось загрузить файл. Проверьте соединение и повторите попытку.'))
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
  return 'Обрабатывается'
}

function isImportReady(batch) {
  return batch
    && batch.dataset_kind !== 'unknown'
    && Number(batch.error_count || 0) === 0
    && ['ready_to_publish', 'published', 'uploaded'].includes(batch.status)
}

function isCriticalImportIssue(batch) {
  return Boolean(batch)
    && (
      batch.dataset_kind === 'unknown'
      || Number(batch.error_count || 0) > 0
      || ['needs_review', 'failed', 'rejected'].includes(batch.status)
    )
}

function mapDatasetKind(kind) {
  if (kind === 'technical_balance') return 'Технический баланс'
  if (kind === 'daily_summary') return 'Ежедневная сводка'
  if (kind === 'commercial_consumption') return 'Акт потребления'
  return 'Тип не определён'
}

function mapIssueRule(rule) {
  const labels = {
    EMPTY_FILE: 'Пустой файл',
    NO_SHEETS: 'Нет листов',
    UNSUPPORTED_EXTENSION: 'Неподдерживаемый формат',
    UNSUPPORTED_DATASET_FORMAT: 'Шаблон не распознан',
    MISSING_DEPENDENCY: 'Сервис не готов к обработке',
  }
  return labels[rule] || 'Дополнительная проверка'
}

function mapIssueMessage(issue) {
  const messages = {
    EMPTY_FILE: 'В загруженном файле нет строк, доступных для чтения.',
    NO_SHEETS: 'В книге нет доступных листов.',
    UNSUPPORTED_EXTENSION: 'Формат файла не поддерживается.',
    UNSUPPORTED_DATASET_FORMAT: 'Структура файла не соответствует поддерживаемым шаблонам.',
    MISSING_DEPENDENCY: 'Сервис пока не готов к обработке этого формата.',
  }
  return messages[issue.rule_code] || issue.message
}

async function fetchImportIssues(batchId) {
  const response = await apiFetch(`/api/v1/imports/${batchId}/issues`)
  if (!response.ok) return []
  return parseJsonResponse(response)
}

async function deleteImportBatch(batchId) {
  const response = await apiFetch(`/api/v1/imports/${batchId}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить файл'))
  return parseJsonResponse(response)
}

function formatValidationReason(batch, issues = []) {
  const primaryIssue = issues.find(issue => issue.severity === 'error') || issues[0]
  if (primaryIssue) return mapIssueMessage(primaryIssue)
  if (batch?.dataset_kind === 'unknown') return 'Структура файла не соответствует поддерживаемым шаблонам.'
  if (Number(batch?.error_count || 0) > 0) return 'Файл содержит ошибки проверки.'
  return ''
}

function formatValidationDetails(batch, issues = []) {
  const primaryIssue = issues.find(issue => issue.severity === 'error') || issues[0]
  if (primaryIssue) {
    const location = [
      primaryIssue.sheet_name ? `лист «${primaryIssue.sheet_name}»` : '',
      primaryIssue.row_index ? `строка ${primaryIssue.row_index}` : '',
    ].filter(Boolean).join(', ')
    return [
      `ETL-правило: ${mapIssueRule(primaryIssue.rule_code)} (${primaryIssue.rule_code}).`,
      location ? `Место: ${location}.` : '',
      `Детали: ${primaryIssue.message || mapIssueMessage(primaryIssue)}`,
    ].filter(Boolean).join('\n')
  }
  if (batch?.dataset_kind === 'unknown') {
    return 'ETL не смог сопоставить структуру книги с поддерживаемыми шаблонами: ежедневная сводка с листами DD.MM или технический баланс.'
  }
  return 'Подробности ошибки ETL недоступны.'
}

function analyticsBlockReason(files) {
  const unknownCount = files.filter(item => item.dataset_kind === 'unknown').length
  if (unknownCount === files.length) {
    return 'Часть обязательных файлов не соответствует поддерживаемому шаблону ETL.'
  }
  return 'В обязательных исходных файлах есть ошибки проверки.'
}

function consumerKey(name) {
  return String(name || '').trim().casefold?.() || String(name || '').trim().toLowerCase()
}

function mappingForConsumer(mappings, consumer) {
  return mappings[consumer.id]
    || mappings[consumerKey(consumer.name)]
    || mappings[consumer.name]
    || 'aktobe'
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
        .map(item => ({ ...item, id: item.id || consumerKey(item.name) }))
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
    if (!hasImports) return undefined

    const refreshVisibleConsumers = () => {
      if (document.visibilityState === 'visible') loadConsumers()
    }
    window.addEventListener('focus', refreshVisibleConsumers)
    document.addEventListener('visibilitychange', refreshVisibleConsumers)
    return () => {
      window.removeEventListener('focus', refreshVisibleConsumers)
      document.removeEventListener('visibilitychange', refreshVisibleConsumers)
    }
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

  const removeImport = batchId => {
    setImports(current => current.filter(item => item.id !== batchId))
  }

  const loadImports = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/v1/imports')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await parseJsonResponse(response)
      setImports(data)
      return data
    } catch (err) {
      setError(err.message || 'Ошибка загрузки')
      throw err
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadImports().catch(() => {})
  }, [])

  return { imports, loading, error, reload: loadImports, mergeImports, removeImport }
}

function OverviewAIForecastSection({ brief, loading, error, onOpenForecast, onRetry }) {
  if (loading && !brief) {
    return <section className="overview-ai-forecast loading">
      <div className="overview-ai-head">
        <span><BrainCircuit/></span>
        <div>
          <small>AI ПРОГНОЗ</small>
          <h3>AI анализирует прогноз и риски затрат</h3>
          <p>Секция появится, если в данных достаточно истории для доказуемого вывода.</p>
        </div>
      </div>
      <div className="overview-ai-loader"><i/><i/><i/></div>
    </section>
  }
  if (error && !brief) {
    return <section className="overview-ai-forecast loading error">
      <div className="overview-ai-head">
        <span><BrainCircuit/></span>
        <div>
          <small>AI ПРОГНОЗ</small>
          <h3>AI сводка временно недоступна</h3>
          <p>Данные для прогноза есть, но запрос к AI не завершился. Можно повторить без перезагрузки страницы.</p>
        </div>
      </div>
      <button type="button" className="overview-ai-retry" onClick={onRetry}>Повторить</button>
    </section>
  }
  if (!brief) return null

  const sections = (brief.sections || []).filter(section => section?.title && section?.detail)
  const weatherSection = sections.find(section => /погод|температур|осад|ветер/i.test(`${section.title} ${section.value} ${section.detail}`))
  const primarySections = [
    sections[0],
    weatherSection && weatherSection !== sections[0] ? weatherSection : sections[1],
  ].filter(Boolean)
  const detailSections = sections.filter(section => !primarySections.includes(section))
  const firstAction = brief.actions?.[0]
  const detailsPreview = detailSections[0]?.value
    || firstAction?.title
    || brief.confidence?.label
    || 'Ограничения и действия'
  const detailsText = detailSections[0]?.detail
    || firstAction?.detail
    || brief.confidence?.basis
    || brief.caveat
  const sectionIcon = section => (/погод|температур|осад|ветер/i.test(`${section.title} ${section.value} ${section.detail}`)
    ? CloudSun
    : ({
    positive: Check,
    warning: Gauge,
    critical: AlertTriangle,
    neutral: Sparkles,
  }[section.tone] || Sparkles))
  const statusLabel = {
    ready: 'Готово к планированию',
    watch: 'Нужно наблюдение',
    limited: 'Ограниченная надёжность',
  }[brief.status] || 'AI прогноз'
  const statusHint = {
    ready: 'Сигнал устойчивый, можно использовать как рабочий ориентир.',
    watch: 'Есть полезный ориентир, но часть факторов нужно держать под контролем.',
    limited: 'Вывод ограничен качеством или полнотой данных.',
  }[brief.status] || 'AI-оценка по текущим данным.'

  return <section className={`overview-ai-forecast ${brief.status || 'watch'}`}>
    <header className="overview-ai-head">
      <span><BrainCircuit/></span>
      <div>
        <small>AI ПРОГНОЗ</small>
        <p>{statusHint}</p>
        <h3>{formatInsightText(brief.headline)}</h3>
      </div>
      <b className={`ai-status-pill ${brief.status || 'watch'}`}>{statusLabel}</b>
    </header>
    <div className="overview-ai-cubes">
      {primarySections.map((section, index) => {
        const Icon = sectionIcon(section)
        return <article className={`overview-ai-cube ${section.tone || 'neutral'}`} key={`${section.title}-${index}`}>
          <span><Icon/></span>
          <div>
            <em>{formatInsightLabel(section.title)}</em>
            <strong>{formatInsightValue(section.value)}</strong>
            <p>{formatInsightText(section.detail)}</p>
          </div>
        </article>
      })}
      <details className="overview-ai-cube overview-ai-details">
        <summary>
          <span><Info/></span>
          <div>
            <em>ДЕТАЛИ AI-ОЦЕНКИ</em>
            <strong>{formatInsightValue(detailsPreview)}</strong>
            <p>{formatInsightText(detailsText)}</p>
          </div>
          <ChevronDown/>
        </summary>
        <div className="overview-ai-detail-body">
          {!!detailSections.length && <div className="overview-ai-panel">
            <small>ДОП. ИНСАЙТЫ</small>
            {detailSections.map((section, index) => <p key={`${section.title}-${index}`}><Sparkles/> <span><b>{formatInsightText(section.title)}</b>{formatInsightText(section.detail)}</span></p>)}
          </div>}
          {!!brief.actions?.length && <div className="overview-ai-panel actions">
            <small>ДЕЙСТВИЯ</small>
            {brief.actions.map((action, index) => <p key={`${action.title}-${index}`}><Check/> <span><b>{formatInsightText(action.title)}</b>{formatInsightText(action.detail)}</span></p>)}
          </div>}
          <div className="overview-ai-panel">
            <small>НАДЁЖНОСТЬ</small>
            <p><Info/> <span><b>{brief.confidence?.label || 'Надёжность'}</b>{formatInsightText(brief.confidence?.basis || brief.caveat)}</span></p>
            {brief.caveat && <p><AlertTriangle/> <span>{formatInsightText(brief.caveat)}</span></p>}
          </div>
        </div>
      </details>
      <button type="button" className="overview-ai-cube overview-ai-open" onClick={onOpenForecast}>
        <span><ArrowRight/></span>
        <div>
          <em>ПЕРЕХОД</em>
          <strong>Открыть прогноз</strong>
          <p>Сценарии, диапазон и структура расчёта.</p>
        </div>
      </button>
    </div>
  </section>
}

function Overview({ onOpenUpload, onOpenQuality, onOpenResult, onOpenDaily, onOpenForecast, importsState }) {
  const { imports, error, reload } = importsState
  const [aiForecast, setAiForecast] = useState(null)
  const [aiForecastLoading, setAiForecastLoading] = useState(false)
  const [aiForecastError, setAiForecastError] = useState(false)
  const [aiForecastReloadKey, setAiForecastReloadKey] = useState(0)
  const totalRows = imports.reduce((sum, item) => sum + item.total_rows, 0)
  const totalWarnings = imports.reduce((sum, item) => sum + item.warning_count, 0)
  const totalErrors = imports.reduce((sum, item) => sum + item.error_count, 0)
  const lastBatch = imports[0]
  const hasImports = imports.length > 0
  const hasTechnicalBalance = imports.some(item => item.dataset_kind === 'technical_balance')
  const hasEnergyBalance = imports.some(item =>
    item.dataset_kind === 'technical_balance'
    && item.accepted_rows > 0
    && ['ready_to_publish', 'published'].includes(item.status)
  )
  const hasDailyData = imports.some(item =>
    item.dataset_kind === 'daily_summary'
    && item.accepted_rows > 0
    && ['ready_to_publish', 'published'].includes(item.status)
  )
  const readyTechnicalBalanceCount = imports.filter(item =>
    item.dataset_kind === 'technical_balance'
    && item.accepted_rows > 0
    && ['ready_to_publish', 'published'].includes(item.status)
  ).length
  const canRequestAiForecast = !error && hasEnergyBalance && readyTechnicalBalanceCount >= 3
  const importsFingerprint = imports.map(item => `${item.id}:${item.status}:${item.accepted_rows}`).join('|')
  const overviewTodayParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Aqtobe',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((map, item) => {
    map[item.type] = item.value
    return map
  }, {})
  const overviewTodayKey = `${overviewTodayParts.year}-${overviewTodayParts.month}-${overviewTodayParts.day}`
  const aiForecastCacheKey = `energy-overview-ai-forecast-v5:${overviewTodayKey}:${importsFingerprint}`
  const readyFiles = imports.filter(item => item.status === 'published' || item.status === 'ready_to_publish').length
  const needsAttention = imports.filter(item => item.error_count > 0 || ['needs_review', 'failed', 'rejected'].includes(item.status)).length
  const metric = value => error ? '—' : fmt(value)
  const metricNote = note => error ? 'нет связи с сервисом данных' : note
  const heroTitle = error
    ? 'Нет связи с сервером'
    : hasEnergyBalance && hasDailyData
      ? 'Расчёты выполнены'
      : hasEnergyBalance
        ? 'Энергобаланс готов'
        : hasDailyData
          ? 'Суточные данные загружены'
          : hasTechnicalBalance
            ? 'Техбаланс не прошёл проверку'
            : 'Нет загруженных данных'
  const heroText = error
    ? 'Загрузки и расчёты недоступны.'
    : hasEnergyBalance && hasDailyData
      ? 'Доступны энергобаланс, пики и прогноз.'
      : hasEnergyBalance
        ? 'Пики и аномалии появятся после загрузки ежедневной сводки.'
      : hasDailyData
          ? `Доступны суточная динамика и пики. ${hasTechnicalBalance ? 'В техбалансе есть замечания.' : 'Для структуры потребления нужен техбаланс.'}`
          : hasTechnicalBalance
            ? 'Исправьте замечания или загрузите новую версию файла.'
            : 'Загрузите ежедневную сводку или технический баланс.'
  const healthTitle = error
    ? 'Проверка недоступна'
    : hasImports
      ? totalErrors
        ? 'Найдены замечания'
        : 'Проверка пройдена'
      : 'Ожидаем первую загрузку'
  const healthDetails = error
    ? [{ label: '', value: 'Показатели появятся после восстановления соединения.' }]
    : hasImports
      ? [
        { label: 'Последняя загрузка', value: `${fmtDateTime(lastBatch?.created_at)} по вашему времени` },
        { label: 'Проверено строк', value: fmt(totalRows) },
        { label: 'Ошибок', value: fmt(totalErrors) },
        { label: 'Предупреждений', value: fmt(totalWarnings) },
      ]
      : [{ label: '', value: 'Результатов проверки пока нет.' }]

  useEffect(() => {
    if (!canRequestAiForecast) {
      setAiForecast(null)
      setAiForecastLoading(false)
      setAiForecastError(false)
      return undefined
    }
    try {
      const cached = JSON.parse(localStorage.getItem(aiForecastCacheKey) || 'null')
      if (cached?.content) {
        setAiForecast(cached.content)
        setAiForecastLoading(false)
        setAiForecastError(false)
        return undefined
      }
    } catch {
      localStorage.removeItem(aiForecastCacheKey)
    }
    let active = true
    setAiForecastLoading(true)
    setAiForecastError(false)
    apiFetch('/api/v1/ai/overview-forecast')
      .then(async response => {
        if (!response.ok) throw new Error(await readApiError(response, 'AI прогноз недоступен'))
        return parseJsonResponse(response)
      })
      .then(data => {
        if (!active) return
        const content = data?.available ? data.content : null
        setAiForecast(content)
        setAiForecastError(false)
        if (content) {
          localStorage.setItem(aiForecastCacheKey, JSON.stringify({
            content,
            cached_at: new Date().toISOString(),
          }))
        }
      })
      .catch(() => {
        if (!active) return
        setAiForecast(null)
        setAiForecastError(true)
      })
      .finally(() => {
        if (active) setAiForecastLoading(false)
      })
    return () => {
      active = false
    }
  }, [canRequestAiForecast, aiForecastCacheKey, aiForecastReloadKey])

  return <>
    <div className="hero-row">
      <div><h2>Данные</h2><p>Загрузки, проверка и расчёты.</p></div>
    </div>
    <div className={`overview-hero ${error ? 'is-offline' : hasImports ? 'is-live' : 'is-empty'}`}>
      <div className="overview-hero-copy">
        <span className="eyebrow">РАСЧЁТЫ</span>
        <h3>{heroTitle}</h3>
        <p>{heroText}</p>
        {!error && <div className="overview-capabilities">
          <button
            type="button"
            className={`overview-capability ${hasDailyData ? 'ready' : 'waiting'}`}
            onClick={hasDailyData ? onOpenDaily : onOpenUpload}
          >
            <span><TrendingUp/></span>
            <div>
              <small>ПИКИ И АНОМАЛИИ</small>
              <b>{hasDailyData ? 'Открыть' : 'Нет ежедневной сводки'}</b>
              <p>{hasDailyData ? 'Пики и изменения по дням' : 'Загрузить суточные данные'}</p>
            </div>
            {hasDailyData ? <ArrowRight/> : <Upload/>}
          </button>
          <button
            type="button"
            className={`overview-capability ${hasImports ? 'ready' : 'waiting'}`}
            onClick={hasImports ? ()=>onOpenResult(lastBatch.id) : onOpenUpload}
          >
            <span><Zap/></span>
            <div>
              <small>ЭНЕРГОБАЛАНС</small>
              <b>{hasEnergyBalance ? 'Открыть' : hasImports ? 'Предварительный расчёт' : 'Нет данных'}</b>
              <p>{hasEnergyBalance ? 'КОА и внешние потребители' : hasImports ? 'По загруженным файлам' : 'Загрузить исходный файл'}</p>
            </div>
            {hasImports ? <ArrowRight/> : <Upload/>}
          </button>
        </div>}
        {error && <div className="overview-hero-actions">
          <button className="hero-primary" type="button" onClick={reload}>Проверить соединение <ArrowRight/></button>
        </div>}
      </div>
      <div className="overview-hero-panel">
        <small>ПРОТОКОЛ ЗАГРУЗКИ</small>
        <b>{healthTitle}</b>
        {!error && !hasImports && <button type="button" className="overview-upload-cta" onClick={onOpenUpload}>
          <Upload/> Загрузить файлы
        </button>}
        <div className="overview-hero-metrics">
          <span><strong>{metric(imports.length)}</strong> файлов</span>
          <span><strong>{metric(readyFiles)}</strong> готовы</span>
          <span><strong>{metric(needsAttention > 0 ? needsAttention : totalErrors)}</strong> с замечаниями</span>
        </div>
        <details className="overview-protocol-details">
          <summary>Детали проверки <ChevronDown/></summary>
          <div className="overview-health-lines">
            {healthDetails.map(item => <div key={`${item.label}-${item.value}`}>
              {item.label && <span>{item.label}</span>}
              <strong>{item.value}</strong>
            </div>)}
          </div>
        </details>
      </div>
    </div>
    {canRequestAiForecast && (aiForecastLoading || aiForecast || aiForecastError) && <OverviewAIForecastSection
      brief={aiForecast}
      loading={aiForecastLoading}
      error={aiForecastError}
      onOpenForecast={onOpenForecast}
      onRetry={() => setAiForecastReloadKey(key => key + 1)}
    />}
    <div className="kpi-grid">
      <KpiCard icon={Database} label="Всего файлов" value={metric(imports.length)} unit="" note={metricNote('в журнале загрузок')} />
      <KpiCard icon={FileCheck2} label="Прошли проверку" value={metric(readyFiles)} unit="" note={metricNote('готовы к расчёту')} tone="blue" />
      <KpiCard icon={Zap} label="Обработано строк" value={metric(totalRows)} unit="" note={metricNote('по всем файлам')} tone="yellow" />
      <KpiCard icon={AlertTriangle} label="Ошибки в данных" value={metric(totalErrors)} unit="" note={metricNote(totalErrors ? 'откройте замечания' : 'ошибок не найдено')} tone="red" />
    </div>
    {error && <div className="dashboard-grid">
      <Card className="span-12" title="Как продолжить">
        <div className="upload-status-note">
          <Database/>
          <div>
            <b>{friendlyApiError(error)}</b>
            <p>После восстановления соединения загрузки и показатели появятся автоматически.</p>
          </div>
          <button onClick={reload}>Проверить соединение <ArrowRight/></button>
        </div>
        <div className="journey-list wide">
          <div><b>1</b><div><strong>Добавьте файл</strong><p>Подойдут `.xlsx`, `.xls` и `.csv`.</p></div></div>
          <div><b>2</b><div><strong>Проверьте качество</strong><p>Система покажет ошибки и предупреждения по строкам.</p></div></div>
          <div><b>3</b><div><strong>Откройте аналитику</strong><p>Готовые данные сразу попадут в энергобаланс и прогноз.</p></div></div>
        </div>
      </Card>
    </div>}
    {!error && !hasImports && <div className="dashboard-grid">
      <Card className="span-7" title="Порядок работы">
        <div className="journey-list wide">
          <div><b>1</b><div><strong>Загрузка</strong><p>Техбаланс или ежедневная сводка в формате Excel.</p></div></div>
          <div><b>2</b><div><strong>Проверка</strong><p>Контроль структуры, формул и показаний.</p></div></div>
          <div><b>3</b><div><strong>Расчёт</strong><p>Энергобаланс, пики, расхождения и прогноз.</p></div></div>
        </div>
      </Card>
      <Card className="span-5" title="Журнал и проверка">
        <div className="readiness-grid single-column">
          <ReadinessCard icon={FileCheck2} eyebrow="ЖУРНАЛ" title="История загрузок" text="Файл, дата, статус и число обработанных строк." />
          <ReadinessCard icon={AlertTriangle} eyebrow="ПРОВЕРКА" title="Замечания" text="Лист, строка и причина ошибки." tone="blue" />
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
      <KpiCard icon={Database} label="Готовые файлы" value={fmt(imports.filter(item => item.status === 'published' || item.status === 'ready_to_publish').length)} unit="" note="доступны для анализа" />
      <KpiCard icon={AlertTriangle} label="Расчёт" value="0" unit="" note="ещё не настроен" tone="yellow" />
      <KpiCard icon={FileCheck2} label="История" value="0" unit="" note="нужны дополнительные периоды" tone="blue" />
    </div>
    <Card title={title} subtitle="Раздел откроется, когда появятся нужные данные">
      <EmptyState title="Пока недостаточно данных" text={text}/>
    </Card>
  </>
}

function ReconciliationPage({ importsState, onOpenQuality }) {
  const { imports, loading } = importsState
  const readyImports = imports.filter(item =>
    item.accepted_rows > 0 && ['ready_to_publish', 'published'].includes(item.status)
  )
  const rowsByPeriod = readyImports.reduce((map, item) => {
    const period = periodFromFilename(item.original_filename)
    if (!period) return map
    const current = map.get(period) || { period, technical: [], daily: [] }
    if (item.dataset_kind === 'technical_balance') current.technical.push(item)
    if (item.dataset_kind === 'daily_summary') current.daily.push(item)
    map.set(period, current)
    return map
  }, new Map())
  const rows = Array.from(rowsByPeriod.values()).sort((a, b) => b.period.localeCompare(a.period))
  const readyRows = rows.filter(item => item.technical.length && item.daily.length)
  const missingDailyRows = rows.filter(item => item.technical.length && !item.daily.length)
  const missingTechnicalRows = rows.filter(item => !item.technical.length && item.daily.length)
  const unknownPeriodFiles = readyImports.filter(item =>
    ['technical_balance', 'daily_summary'].includes(item.dataset_kind) && !periodFromFilename(item.original_filename)
  )
  const readyText = readyRows.length
    ? `Можно сверить ${readyRows.map(item => fmtMonthYear(item.period)).join(', ')}.`
    : 'Для сверки нужен один месяц, где есть и техбаланс, и ежедневная сводка.'
  const missingText = [
    missingDailyRows.length ? `Ежедневная сводка: ${missingDailyRows.map(item => fmtMonthYear(item.period)).join(', ')}.` : '',
    missingTechnicalRows.length ? `Техбаланс: ${missingTechnicalRows.map(item => fmtMonthYear(item.period)).join(', ')}.` : '',
    unknownPeriodFiles.length ? `Не удалось определить месяц у ${fmt(unknownPeriodFiles.length)} файлов.` : '',
  ].filter(Boolean).join(' ')

  if (loading && !imports.length) {
    return <div className="result-loading"><span/><b>Проверяем данные для месячной сверки…</b></div>
  }

  return <>
    <div className="page-actions">
      <div/>
      <button className="export" type="button" onClick={onOpenQuality}><Upload/> Загрузить данные</button>
    </div>
    <div className="kpi-grid three">
      <KpiCard icon={FileSpreadsheet} label="Техбалансы" value={fmt(readyImports.filter(item => item.dataset_kind === 'technical_balance').length)} unit="" note="готовые файлы" />
      <KpiCard icon={CalendarDays} label="Ежедневные сводки" value={fmt(readyImports.filter(item => item.dataset_kind === 'daily_summary').length)} unit="" note="готовые файлы" tone="blue" />
      <KpiCard icon={FileCheck2} label="Можно сверить" value={fmt(readyRows.length)} unit="" note="месяцев с парой файлов" tone={readyRows.length ? 'green' : 'yellow'} />
    </div>
    <Card
      title={readyRows.length ? 'Месячная сверка готова' : 'Пока недостаточно данных'}
      subtitle={readyRows.length ? readyText : 'Ниже показано, какого файла не хватает для каждого месяца'}
      action={<Status value={readyRows.length ? 'В норме' : 'В работе'}/>}
    >
      <div className="reconciliation-detail">
        <div className="reconciliation-requirement">
          <Info/>
          <div>
            <b>Что нужно для расчёта</b>
            <p>Для одного месяца нужна пара: технический баланс и ежедневная сводка за тот же месяц. Если месяц есть только в одном типе файла, расхождение посчитать нельзя.</p>
            {missingText && <strong>{missingText}</strong>}
          </div>
        </div>
        <div className="data-table reconciliation-detail-table">
          <div className="tr th"><span>Месяц</span><span>Техбаланс</span><span>Ежедневная сводка</span><span>Что сделать</span><span>Статус</span></div>
          {rows.length ? rows.map(item => {
            const hasTechnical = item.technical.length > 0
            const hasDaily = item.daily.length > 0
            const action = hasTechnical && hasDaily
              ? 'Данные сопоставимы'
              : hasTechnical
                ? `Загрузить ежедневную сводку за ${fmtMonthYear(item.period)}`
                : `Загрузить техбаланс за ${fmtMonthYear(item.period)}`
            return <div className="tr" key={item.period}>
              <span className="file-name">{fmtMonthYear(item.period)}</span>
              <span>{hasTechnical ? item.technical[0].original_filename : '—'}</span>
              <span>{hasDaily ? item.daily[0].original_filename : '—'}</span>
              <span>{action}</span>
              <span><Status value={hasTechnical && hasDaily ? 'В норме' : 'В работе'}/></span>
            </div>
          }) : <div className="tr"><span>—</span><span>Нет готового техбаланса</span><span>Нет готовой ежедневной сводки</span><span>Загрузить оба файла за один месяц</span><span><Status value="В работе"/></span></div>}
        </div>
        {!!unknownPeriodFiles.length && <div className="reconciliation-unknown">
          <b>Файлы без распознанного месяца</b>
          <p>Переименуйте файл так, чтобы в названии были месяц и год, например: `Тех. баланс за март 2026.xls` или `Ежедневная сводка потребления — март 2026.xlsx`.</p>
          {unknownPeriodFiles.slice(0, 4).map(item => <span key={item.id}>{item.original_filename}</span>)}
        </div>}
      </div>
    </Card>
  </>
}

function DailyEnergyBalance({ result, onOpenQuality }) {
  const daily = result.daily_series || []
  const kpis = result.kpis || {}
  const dailySignals = buildDailySignals(daily)
  const total = daily.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const average = daily.length ? total / daily.length : 0
  const peakDay = kpis.peak_day || daily.reduce(
    (peak, item) => Number(item.value || 0) > Number(peak?.value || 0) ? item : peak,
    null
  )
  const firstDate = daily[0]?.date
  const lastDate = daily[daily.length - 1]?.date
  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
    : '—'
  const periodLabel = firstDate && lastDate
    ? `${dateLabel(firstDate)} — ${dateLabel(lastDate)}`
    : 'доступный период'
  const attentionCount = Number(kpis.negative_intervals || 0) + Number(kpis.incomplete_intervals || 0)

  return <>
    <section className="energy-brief partial">
      <div className="energy-brief-copy">
        <span className="energy-kicker">ЕЖЕДНЕВНАЯ СВОДКА · {periodLabel}</span>
        <h2>Расчёт по суточным данным</h2>
        <p>Рассчитаны контролируемый вход и суточный профиль. Структура потребления доступна после загрузки техбаланса.</p>
      </div>
      <div className="energy-brief-signal">
        <small>ОХВАТ ДАННЫХ</small>
        <strong className="up">{fmt(daily.length)}</strong>
        <span>дней в оперативном балансе</span>
      </div>
    </section>

    <div className="energy-kpis">
      <article>
        <div><span className="energy-kpi-icon total"><Zap/></span><small>КОНТРОЛИРУЕМЫЙ ВХОД</small></div>
        <strong>{fmt(total)}</strong>
        <span>кВт·ч за период</span>
        <p>Сумма значений за выбранный период</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon own"><Gauge/></span><small>СРЕДНЕЕ ЗА ДЕНЬ</small></div>
        <strong>{fmt(average)}</strong>
        <span>кВт·ч</span>
        <p>Среднее потребление в сутки</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon external"><TrendingUp/></span><small>ПИКОВЫЙ ДЕНЬ</small></div>
        <strong>{fmt(peakDay?.value)}</strong>
        <span>кВт·ч · {dateLabel(peakDay?.date)}</span>
        <p>Наибольшее суточное потребление</p>
      </article>
      <article className={attentionCount ? 'attention' : ''}>
        <div><span className="energy-kpi-icon quality"><AlertTriangle/></span><small>КАЧЕСТВО ДАННЫХ</small></div>
        <strong>{fmt(attentionCount)}</strong>
        <span>замечаний</span>
        <p>Отрицательные значения и пропуски</p>
      </article>
    </div>

    <div className="dashboard-grid energy-grid">
      <Card
        className="span-8 energy-chart-card"
        title="Дневная нагрузка"
        subtitle={`${fmt(daily.length)} дней · контролируемый вход`}
      >
        <div className="energy-chart daily-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим дневной профиль…</div>}>
            <EnergyBusinessCharts kind="daily" data={daily} peakDay={peakDay} controlLimit={dailySignals.controlLimit}/>
          </Suspense>
        </div>
        <div className="load-signal-summary">
          <div><small>ПОРОГ ПИКОВОГО ДНЯ</small><b>{fmt(dailySignals.controlLimit)} кВт·ч</b></div>
          <p>{dailySignals.events.length
            ? `${fmt(dailySignals.events.length)} заметных изменений нагрузки за период.`
            : 'Резких изменений относительно предыдущего дня не найдено.'}</p>
        </div>
      </Card>
      <Card className="span-4 energy-upgrade-card" title="Технический баланс" subtitle="Структура потребления и месячная сверка">
        <div className="energy-upgrade-icon"><FileSpreadsheet/></div>
        <h3>Техбаланс не загружен</h3>
        <p>Файл нужен для расчёта КОА, внешнего потребления, линий 35 кВ и месячной сверки.</p>
        <ul>
          <li><Check/> КОА и внешние потребители</li>
          <li><Check/> Структура по направлениям</li>
          <li><Check/> Сверка дневных и месячных итогов</li>
        </ul>
        <button type="button" className="quality-link" onClick={onOpenQuality}><Upload/> Загрузить техбаланс <ArrowRight/></button>
      </Card>
    </div>
  </>
}

function SourceDashboard({ kind, hasImports, onOpenQuality }) {
  const config = kind === 'technical'
    ? {
        endpoint: '/api/v1/dashboards/technical-balance',
        datasetKind: 'technical_balance',
        emptyTitle: 'Технический баланс ещё не загружен',
        loading: 'Собираем технический баланс…',
        chartTitle: 'Крупнейшие объекты учёта',
        chartSubtitle: 'Ранжирование пересчитанного расхода',
      }
    : {
        endpoint: '/api/v1/dashboards/daily-consumption',
        datasetKind: 'daily_summary',
        emptyTitle: 'Ежедневная сводка ещё не загружена',
        loading: 'Собираем ежедневное потребление…',
        chartTitle: 'Общий расход по счётчикам',
        chartSubtitle: 'Суммарное потребление за последний месяц',
      }
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(hasImports)
  const [error, setError] = useState('')
  const [tableSearchQuery, setTableSearchQuery] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [selectedPoint, setSelectedPoint] = useState('')
  const [periodsByKind, setPeriodsByKind] = useState({})

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const response = await apiFetch('/api/v1/filters')
        if (!response.ok) return
        const data = await parseJsonResponse(response)
        if (active) setPeriodsByKind(data.periods_by_kind || {})
      } catch {
        // period selector degrades to "latest only"; not fatal
      }
    })()
    return () => { active = false }
  }, [hasImports])

  // Not `imports[].period_start`: many existing batches predate that column
  // being populated and would read as undated. `/api/v1/filters` resolves
  // the period the same way the dashboards do (workbook header, then
  // filename fallback), so it stays correct even for those rows.
  const periodOptions = [...(periodsByKind[config.datasetKind] || [])].sort().reverse()

  useEffect(() => {
    if (selectedPeriod && periodOptions.length && !periodOptions.includes(selectedPeriod)) {
      setSelectedPeriod('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodOptions.join(',')])

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
        const suffix = selectedPeriod ? `?period=${encodeURIComponent(selectedPeriod)}` : ''
        const response = await apiFetch(`${config.endpoint}${suffix}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await parseJsonResponse(response)
        if (active) setResult(data)
      } catch (err) {
        if (active) setError(err.message || 'Ошибка загрузки')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [hasImports, config.endpoint, selectedPeriod])

  if (!hasImports) {
    return <Card title={config.emptyTitle}>
      <EmptyState title="Нужен исходный файл" text="Загрузите данные, чтобы построить этот дэшборд." actionLabel="Загрузить данные" onAction={onOpenQuality}/>
    </Card>
  }
  if (loading) return <div className="result-loading"><span/><b>{config.loading}</b></div>
  if (error || !result?.table?.length) {
    return <Card title="Дэшборд недоступен">
      <EmptyState title="Нет данных для отображения" text="Проверьте тип и состояние загруженного файла." actionLabel="Открыть загрузки" onAction={onOpenQuality}/>
    </Card>
  }

  const kpis = result.kpis || {}
  const periodLabel = fmtMonthYear(result.meta?.period)
  const totalValue = Number(kpis.total_kwh || 0)
  const peakLabel = kpis.peak_day?.date || '—'
  const mlnValue = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0) / 1_000_000)
  const isTechnical = kind === 'technical'
  const rankingSeries = isTechnical
    ? (result.series || [])
    : (result.series || []).map(item => ({
      ...item,
      object_name: item.name,
      name: item.meter_number ? `№ ${item.meter_number}` : item.name,
    }))
  const visibleBreakdowns = result.breakdowns || []
  const catalogResolved = kpis.catalog_points_resolved
  const catalogTotal = kpis.catalog_points_total
  const pointOptions = visibleBreakdowns.filter(item => (item.sources || []).length > 0)
  const selectedPointSourceNames = selectedPoint
    ? new Set((pointOptions.find(item => item.id === selectedPoint)?.sources || []).map(source => source.name))
    : null
  const byPoint = item => !selectedPointSourceNames || selectedPointSourceNames.has(item.substation)
  const normalizedTableSearchQuery = tableSearchQuery.trim().toLocaleLowerCase('ru-RU')
  const tableRows = (result.table || [])
    .filter(byPoint)
    .filter(item => !normalizedTableSearchQuery || [
      item.name,
      item.meter_number,
      item.meter_type,
      item.substation,
      item.coefficient,
      item.days,
      item.value,
      item.row,
      item.meter_number_source,
      item.consumption_source,
    ].some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(normalizedTableSearchQuery)))
  const hasTableSearch = Boolean(normalizedTableSearchQuery)
  const hasPointFilter = Boolean(selectedPoint)

  return <>
    <div className="page-actions peak-page-actions">
      <div className="peak-filter-bar">
        <label><span>Период</span><div className="period-select-wrap peak-select-wrap"><CalendarDays/><select value={selectedPeriod} onChange={event => setSelectedPeriod(event.target.value)}>
          <option value="">Последний период</option>
          {periodOptions.map(period => <option key={period} value={period}>{fmtMonthYear(period)}</option>)}
        </select><ChevronDown/></div></label>
        <label><span>Точка</span><div className="period-select-wrap peak-select-wrap"><Factory/><select value={selectedPoint} onChange={event => setSelectedPoint(event.target.value)}>
          <option value="">Все точки</option>
          {pointOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select><ChevronDown/></div></label>
      </div>
      {loading && <span className="filter-loading">Обновляем…</span>}
    </div>
    <section className="source-dashboard-hero">
      <div>
        <span>{isTechnical ? 'ТЕХНИЧЕСКИЙ БАЛАНС' : 'ЕЖЕДНЕВНОЕ ПОТРЕБЛЕНИЕ'} · {String(periodLabel || 'последний период').toUpperCase()}</span>
        <h2>{result.insight}</h2>
        <p>{result.meta?.filename}</p>
      </div>
      <strong>{mlnValue(totalValue)}<small>млн кВт·ч</small></strong>
    </section>
    <div className="kpi-grid four source-kpis">
      {isTechnical ? <>
        <KpiCard icon={Zap} label="Общий вход" value={mlnValue(kpis.total_kwh)} unit="млн кВт·ч" note={periodLabel}/>
        <KpiCard icon={Factory} label="Казахойл" value={mlnValue(kpis.own_kwh)} unit="млн кВт·ч" note="собственное потребление" tone="green"/>
        <KpiCard icon={Users} label="Внешние" value={mlnValue(kpis.external_kwh)} unit="млн кВт·ч" note="сторонние потребители" tone="yellow"/>
        <KpiCard icon={Database} label="Основные точки" value={fmt(catalogResolved)} unit={catalogTotal ? `/ ${fmt(catalogTotal)}` : ''} note="найдено в загруженном файле" tone="blue"/>
      </> : <>
        <KpiCard icon={CalendarDays} label="Дней" value={fmt(kpis.days)} unit="" note={periodLabel}/>
        <KpiCard icon={Gauge} label="Счётчиков" value={fmt(kpis.objects)} unit="" note="в рейтинге месяца" tone="blue"/>
        <KpiCard icon={Zap} label="Нагрузка точек" value={mlnValue(kpis.total_kwh)} unit="млн кВт·ч" note="сумма доступных показаний" tone="green"/>
        <KpiCard icon={TrendingUp} label="Пиковый день" value={peakLabel} unit="" note={`${fmt(kpis.peak_day?.value)} кВт·ч`} tone="yellow"/>
      </>}
    </div>
    <div className="dashboard-grid source-dashboard-grid">
      <Card className="span-7 energy-chart-card" title={config.chartTitle} subtitle={config.chartSubtitle}>
        <div className="energy-chart source-ranking-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим рейтинг…</div>}>
            <EnergyBusinessCharts kind="outgoing" data={rankingSeries.filter(byPoint).slice(0, 15)}/>
          </Suspense>
        </div>
      </Card>
      <Card
        className="span-5 energy-chart-card"
        title="Распределение по основным точкам"
        subtitle={`Каталог точек Алибекмола и Кожасай · найдено ${fmt(catalogResolved)} из ${fmt(catalogTotal)}`}
      >
        <div className="energy-chart groups-chart">
          <Suspense fallback={<div className="result-chart-fallback">Собираем подстанции…</div>}>
            <EnergyBusinessCharts kind="external" data={visibleBreakdowns.filter(item => item.value > 0)}/>
          </Suspense>
        </div>
        <p className="catalog-breakdown-note">
          Значения в кВт·ч, не проценты от общего входа: точка и её дочерние линии/счётчики считаются вместе,
          поэтому суммировать доли между точками нельзя (см. план раздела 3.3).
        </p>
        <div className="energy-composition-summary external-groups-legend">
          {visibleBreakdowns.map((item, index) => <div key={item.id || item.name} className={item.resolved === false ? 'catalog-unresolved' : ''}>
            <span style={{ background: chartPalette[index % chartPalette.length] }}/>
            <small title={(item.sources || []).map(source => source.name).join(', ') || undefined}>{item.name}</small>
            <b>{item.resolved === false && !item.value ? 'нет данных' : `${mlnValue(item.value)} млн кВт·ч`}</b>
          </div>)}
        </div>
      </Card>
      <Card
        className="span-12"
        title={isTechnical ? 'Таблица объектов' : 'Таблица потребления'}
        subtitle={hasTableSearch || hasPointFilter
          ? `Найдено ${fmt(tableRows.length)} из ${fmt(result.table?.length || 0)}`
          : (isTechnical ? 'Номер прибора, подстанция и рассчитанный расход' : 'Номер прибора, источник колонок и рассчитанный расход')}
        action={<label className="source-table-search" aria-label={isTechnical ? 'Поиск объектов' : 'Поиск потребления'}>
          <Search/>
          <input
            type="search"
            value={tableSearchQuery}
            onChange={event => setTableSearchQuery(event.target.value)}
            placeholder={isTechnical ? 'Поиск объектов' : 'Поиск'}
          />
        </label>}
      >
        <div className="data-table source-dashboard-table">
          <div className="tr th"><span>Наименование</span><span>№ ПУ</span><span>{isTechnical ? 'Подстанция' : 'Источник данных'}</span><span>Расход</span><span>{isTechnical ? 'Коэффициент' : 'Дней'}</span></div>
          {tableRows.slice(0, 80).map(item => <div className="tr" key={item.id}>
            <span className="file-name">{item.name}</span>
            <span className="source-meter-cell"><b>{item.meter_number || '—'}</b>{!isTechnical && <small>{item.meter_number_source || 'Столбец C'}</small>}</span>
            <span className={!isTechnical ? 'source-meter-cell' : ''}>{isTechnical ? (item.substation || '—') : <><b>{item.consumption_source || 'Расчёт: (G - F) × E'}</b><small>{item.substation || 'Подстанция не указана'}</small></>}</span>
            <span>{fmt(item.value)} кВт·ч</span>
            <span>{fmt(isTechnical ? item.coefficient : item.days)}</span>
          </div>)}
          {!tableRows.length && <div className="tr"><span>—</span><span>{hasTableSearch ? 'Поиск не нашёл объектов' : 'Объекты не найдены'}</span><span>—</span><span>—</span><span>—</span></div>}
        </div>
      </Card>
    </div>
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
    return <Card title="Энергобаланс пока пуст">
      <EmptyState
        title="Добавьте первый набор данных"
        text="Энергобаланс откроется по ежедневной сводке, техническому балансу или другому распознанному энергетическому файлу."
        actionLabel="Загрузить данные"
        onAction={onOpenQuality}
      />
    </Card>
  }

  if (loading) {
    return <div className="result-loading"><span/><b>Собираем энергобаланс…</b></div>
  }

  if (error) {
    return <Card title="Не удалось построить энергобаланс">
      <EmptyState title="Не удалось прочитать доступные данные" text="Откройте загрузки, проверьте состояние файлов и повторите попытку." actionLabel="Открыть загрузки" onAction={onOpenQuality}/>
    </Card>
  }

  if (result?.daily_series?.length && !result?.monthly_series?.length) {
    return <DailyEnergyBalance result={result} onOpenQuality={onOpenQuality}/>
  }

  if (!result?.monthly_series?.length) {
    return <section className="energy-data-pending">
      <div><Database/><span><small>РАСЧЁТ НЕ ВЫПОЛНЕН</small><h2>Энергетический ряд не распознан</h2><p>Проверьте тип файла и протокол обработки.</p></span></div>
      <button type="button" onClick={onOpenQuality}>Открыть протокол <ArrowRight/></button>
    </section>
  }

  const {
    meta, kpis, monthly_series: monthly, daily_series: daily,
    external_substations: externalSubstations = [],
    top_external_consumers: topExternal, reconciliation, data_quality: quality,
    insight, warnings,
  } = result
  const mln = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0) / 1_000_000)
  const energyAmount = value => {
    const numeric = Math.abs(Number(value || 0))
    if (numeric > 0 && numeric < 10_000) return `${fmt(value)} кВт·ч`
    return `${mln(value)} млн кВт·ч`
  }
  const mlnOrDash = value => value === null || value === undefined ? '—' : mln(value)
  const percent = value => new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0))
  const percentWithFloor = value => {
    const numeric = Number(value || 0)
    if (numeric > 0 && numeric < .001) return '<0,1%'
    return percent(numeric)
  }
  const signedPercent = value => `${Number(value || 0) >= 0 ? '+' : '−'}${percent(Math.abs(Number(value || 0)))}`
  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${value}T00:00:00`))
    : '—'
  const periodLabel = formatPeriodRange(monthly)
  const latestPeriodLabel = fmtMonthYear(meta.latest_period) || meta.latest_label
  const topExternalTotal = topExternal.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const externalSubstationsTotal = externalSubstations.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const monthlyComposition = monthly.slice(-3)
  const dailySignals = buildDailySignals(daily)
  const hasDailySeries = daily.length > 0
  const anomalySummary = dailySignals.events.length
    ? `${fmt(dailySignals.events.length)} заметных изменений: ${dailySignals.events.filter(item => item.delta > 0).length} повышений и ${dailySignals.events.filter(item => item.delta < 0).length} спадов относительно предыдущего дня.`
    : 'Резких спадов и повышений относительно предыдущего дня не найдено.'
  const hasMonthlyChange = kpis.mom_change !== null && kpis.mom_change !== undefined
  const hasReconciliationData = reconciliation.some(item => Number(item.days || 0) > 0)
  const dailyPeriods = [...new Set(daily.map(item => String(item.period || '').trim()).filter(Boolean))].sort()
  const monthlyPeriods = monthly.map(item => String(item.period || '').trim()).filter(Boolean)
  const missingReconciliationPeriods = reconciliation
    .filter(item => !Number(item.days || 0))
    .map(item => item.label || fmtMonthYear(item.period) || item.period)
  const reconciliationEmptyTitle = dailyPeriods.length
    ? 'Сводка загружена за другие месяцы'
    : 'Нет ежедневной сводки'
  const reconciliationEmptyText = dailyPeriods.length
    ? `Найдены суточные данные за ${dailyPeriods.map(fmtMonthYear).join(', ')}, а энергобаланс рассчитан за ${monthlyPeriods.map(fmtMonthYear).join(', ')}. Для сверки загрузите ежедневные сводки за ${missingReconciliationPeriods.join(', ')}.`
    : 'Сверка появится после загрузки суточных данных за эти месяцы.'

  return <>
    <section className="energy-brief">
      <div className="energy-brief-copy">
        <span className="energy-kicker">ЭНЕРГОБАЛАНС · {periodLabel}</span>
        <h2>{insight}</h2>
        <p>Потребление пересчитано по показаниям и разделено между КОА и внешними потребителями.</p>
      </div>
      <div className="energy-brief-signal">
        <small>ДИНАМИКА ЗА МЕСЯЦ</small>
        <strong className={Number(kpis.mom_change || 0) >= 0 ? 'up' : 'down'}>{hasMonthlyChange ? signedPercent(kpis.mom_change) : '—'}</strong>
        <span>к предыдущему месяцу</span>
      </div>
    </section>

    <div className="energy-kpis three">
      <article>
        <div><span className="energy-kpi-icon total"><Zap/></span><small>ОБЩЕЕ ПОТРЕБЛЕНИЕ · {latestPeriodLabel}</small></div>
        <strong>{mln(kpis.total_kwh)}</strong>
        <span>млн кВт·ч</span>
        <p>Расчёт по исходным показаниям</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon own"><Factory/></span><small>СОБСТВЕННОЕ · КОА</small></div>
        <strong>{mln(kpis.own_kwh)}</strong>
        <span>млн кВт·ч · {percent(kpis.own_share)}</span>
        <p>Потребление объектов КОА</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon external"><Database/></span><small>ВНЕШНИЕ ПОТРЕБИТЕЛИ</small></div>
        <strong>{mln(kpis.external_kwh)}</strong>
        <span>млн кВт·ч · {percent(kpis.external_share)}</span>
        <p>Передано сторонним организациям</p>
      </article>
    </div>

    <div className="dashboard-grid energy-grid">
      <Card
        className="span-5 energy-chart-card energy-chart-row-primary"
        title="Структура потребления"
        subtitle="КОА и внешние потребители за три последних месяца"
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
        subtitle={hasDailySeries ? `${fmt(kpis.coverage_days)} дней · контролируемый вход` : 'Нет ежедневной сводки для суточного ряда'}
        action={hasDailySeries ? <div className="chart-card-actions">
          <div className="peak-chip"><span/> Пик {dateLabel(kpis.peak_day?.date)} · {fmt(kpis.peak_day?.value)} кВт·ч</div>
          <button className="chart-expand-btn" type="button" onClick={() => setFullscreenChart('daily')} title="Открыть график на весь экран" aria-label="Открыть график на весь экран"><Maximize2/></button>
        </div> : <div className="peak-chip neutral"><span/> Суточный ряд не найден</div>}
      >
        {hasDailySeries ? <>
          <div className="energy-chart daily-chart">
            <Suspense fallback={<div className="result-chart-fallback">Строим дневной профиль…</div>}>
              <EnergyBusinessCharts kind="daily" data={daily} peakDay={kpis.peak_day} controlLimit={dailySignals.controlLimit}/>
            </Suspense>
          </div>
          <div className="load-signal-summary">
            <div><small>ПОРОГ ПИКОВОГО ДНЯ</small><b>{fmt(dailySignals.controlLimit)} кВт·ч</b></div>
            <p>{anomalySummary} Дни выше этого уровня считаются пиковыми.</p>
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
        </> : <div className="daily-load-missing">
          <AlertTriangle/>
          <div>
            <small>ПОЧЕМУ НЕТ ГРАФИКА</small>
            <h3>В загруженном файле есть итоги за месяц, но нет разбивки по дням</h3>
            <p>Чтобы показать дневную нагрузку, загрузите ежедневную сводку за этот же месяц. После загрузки график появится автоматически.</p>
          </div>
          <button type="button" onClick={onOpenQuality}>Открыть загрузки <ArrowRight/></button>
        </div>}
      </Card>
      {hasDailySeries && fullscreenChart === 'daily' && <div className="chart-fullscreen" role="dialog" aria-modal="true" aria-label="Дневная нагрузка" onClick={() => setFullscreenChart(null)}>
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
        className="span-5 energy-chart-card energy-chart-row-secondary"
        title={`Внешнее потребление · ${latestPeriodLabel}`}
        subtitle="Распределение по подстанциям Казахойла"
      >
        <div className="energy-chart groups-chart">
          <Suspense fallback={<div className="result-chart-fallback">Группируем подстанции…</div>}>
            <EnergyBusinessCharts kind="external" data={externalSubstations}/>
          </Suspense>
        </div>
        <div className="energy-composition-summary external-groups-legend">
          {externalSubstations.map((item, index) => <div key={item.name}>
            <span style={{ background: chartPalette[index % chartPalette.length] }}/>
            <small>{item.name}</small>
            <b>{externalSubstationsTotal ? percentWithFloor(Number(item.value || 0) / externalSubstationsTotal) : '—'} <em>{energyAmount(item.value)}</em></b>
          </div>)}
        </div>
      </Card>

      <Card
        className="span-7 energy-chart-row-secondary"
        title="Крупнейшие потребители"
        subtitle="Рейтинг по объёму внешнего потребления"
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
        title="Сверка данных"
        subtitle="Ежедневные сводки и технический баланс"
      >
        {hasReconciliationData ? <div className="energy-reconciliation">
          {reconciliation.map(item => {
            const hasDaily = Number(item.days || 0) > 0
            const isAlert = hasDaily && item.difference_pct != null && Math.abs(Number(item.difference_pct || 0)) > .03
            return <div key={item.period}>
              <span className={`recon-month ${isAlert ? 'alert' : ''}`}>{item.label}</span>
              <span><small>{hasDaily ? 'Сводка' : 'Сводка не загружена'}</small><b>{mlnOrDash(item.daily_kwh)}{hasDaily ? ' млн' : ''}</b></span>
              <span><small>Месяц</small><b>{mln(item.monthly_kwh)} млн</b></span>
              <strong className={isAlert ? 'alert' : ''}>{hasDaily && item.difference_pct != null ? signedPercent(item.difference_pct) : '—'}</strong>
            </div>
          })}
        </div> : <EmptyState title={reconciliationEmptyTitle} text={reconciliationEmptyText}/>}
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
  const [calculablePeriods, setCalculablePeriods] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [selectedStation, setSelectedStation] = useState('')
  const [segment, setSegment] = useState('all')

  useEffect(() => {
    if (!hasImports) {
      setResult(null)
      setLoading(false)
      setCalculablePeriods([])
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
          const dailyPeriods = (data.daily_series || [])
            .filter(item => Number(item.value || 0) > 0)
            .map(item => String(item.period || item.date?.slice(0, 7) || ''))
            .filter(period => /^\d{4}-\d{2}$/.test(period))
          setCalculablePeriods(current => Array.from(new Set(selectedPeriod
            ? [...current, ...dailyPeriods]
            : dailyPeriods)).sort())
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
    if (selectedPeriod && calculablePeriods.length && !calculablePeriods.includes(selectedPeriod)) {
      setSelectedPeriod('')
    }
  }, [calculablePeriods, selectedPeriod])

  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${value}T00:00:00`))
    : '—'
  const periodOptions = Array.from(new Set(calculablePeriods))
    .sort()
    .slice(-12)
    .reverse()

  if (!hasImports) {
    return <Card title="Пики ещё не рассчитаны">
      <EmptyState title="Нужен дневной ряд" text="Загрузите технический баланс и ежедневную сводку, чтобы увидеть пиковые дни и резкие изменения."/>
    </Card>
  }

  if (loading && !result) {
    return <div className="result-loading"><span/><b>Ищем пики и резкие изменения…</b></div>
  }

  if (error || !result?.daily_series?.length) {
    return <Card title="Не удалось рассчитать пики">
      <EmptyState title="Дневной ряд недоступен" text="Проверьте загруженные файлы и повторите попытку."/>
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
  const shareByPeriod = new Map(
    (result.monthly_series || []).map(item => [String(item.period), {
      own: Number(item.own_share ?? 1),
      external: Number(item.external_share ?? 0),
    }]),
  )
  const segmentShare = (period) => {
    if (segment === 'all') return 1
    const share = shareByPeriod.get(String(period))
    if (!share) return segment === 'koa' ? 1 : 0
    return segment === 'koa' ? share.own : share.external
  }
  const filteredDailySeries = periodDailySeries.map(item => ({
    ...item,
    value: stationValue(item) * segmentShare(item.period || String(item.date || '').slice(0, 7)),
  }))
  const dailySignals = buildDailySignals(filteredDailySeries)
  const coveredPeriods = Array.from(new Set(filteredDailySeries.map(item => item.period || String(item.date || '').slice(0, 7))))
  const expectedDays = coveredPeriods.reduce((sum, period) => sum + daysInPeriod(period), 0)
  const coveragePercent = expectedDays ? filteredDailySeries.length / expectedDays : null
  const peakDay = filteredDailySeries.length
    ? filteredDailySeries.reduce((peak, item) => Number(item.value || 0) > Number(peak.value || 0) ? item : peak, filteredDailySeries[0])
    : null
  const selectedPeriodLabel = selectedPeriod ? fmtMonthYear(selectedPeriod) : 'весь период'
  const selectedStationLabel = selectedStation
    ? stationOptions.find(item => item.id === selectedStation)?.name || 'выбранная площадка'
    : 'все площадки'
  const riseCount = dailySignals.events.filter(item => item.delta > 0).length
  const fallCount = dailySignals.events.filter(item => item.delta < 0).length
  const qualityKpis = result.kpis || {}
  const attentionCount = Number(qualityKpis.negative_intervals || 0) + Number(qualityKpis.incomplete_intervals || 0)
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
        <div className="peak-segment-toggle" role="group" aria-label="Сегмент">
          {PEAK_SEGMENTS.map(item => <button
            key={item.id}
            type="button"
            className={segment === item.id ? 'active' : ''}
            onClick={() => setSegment(item.id)}
          >{item.label}</button>)}
        </div>
      </div>
      {loading && <span className="filter-loading">Обновляем…</span>}
      <button className="export" type="button" onClick={exportPeaks}><Download/> Скачать</button>
    </div>
    <p className="peak-segment-note">
      {segment === 'all'
        ? 'Показан общий контролируемый вход без разделения на КОА и субпотребителей.'
        : `Значения оценены по доле ${segment === 'koa' ? 'КОА' : 'субпотребителей'} за соответствующий месяц технического баланса — прямого суточного разреза по субпотребителям в исходных данных нет.`}
    </p>
    <section className="peak-signal-strip">
      <article className="peak-signal-primary">
        <span><Zap/></span>
        <small>ПИКОВАЯ НАГРУЗКА{segment !== 'all' ? ` · ${PEAK_SEGMENTS.find(item => item.id === segment)?.label}` : ''}</small>
        <b>{dateLabel(peakDay?.date)}</b>
        <strong>{fmt(peakDay?.value)} кВт·ч</strong>
      </article>
      <article className="peak-signal-secondary">
        <small>СРЕДНЕЕ ЗА ДЕНЬ</small>
        <div className="peak-signal-value"><b>{fmt(dailySignals.average)}</b><strong>кВт·ч</strong></div>
        <p>среднее по {fmt(filteredDailySeries.length)} дням выбранного периода и сегмента</p>
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
        <small>ПОРОГ ПИКОВОГО ДНЯ</small>
        <div className="peak-signal-value"><b>{fmt(dailySignals.controlLimit)}</b><strong>кВт·ч</strong></div>
        <p>дни выше этого уровня считаются пиковыми</p>
      </article>
      <article
        className={`peak-signal-secondary data-completeness ${attentionCount ? 'attention' : ''}`}
        title={`Загружено дневных строк: ${fmt(filteredDailySeries.length)} из ${fmt(expectedDays)} ожидаемых по календарю выбранного периода (${coveredPeriods.filter(Boolean).map(fmtMonthYear).join(', ') || '—'}).`}
      >
        <small>ПОЛНОТА ДНЕВНЫХ ДАННЫХ</small>
        <div className="peak-signal-value">
          <b>{fmt(filteredDailySeries.length)}{expectedDays ? ` / ${fmt(expectedDays)}` : ''}</b>
          <strong>{coveragePercent != null ? `${(coveragePercent * 100).toFixed(0)}%` : 'дней'}</strong>
        </div>
        <p>факт/ожидание по календарю · {fmt(attentionCount)} замечаний · отрицательные: {fmt(qualityKpis.negative_intervals)} · неполные: {fmt(qualityKpis.incomplete_intervals)}</p>
      </article>
    </section>
    <Card
      className="span-12 energy-chart-card"
      title="Пиковые дни и изменения нагрузки"
      subtitle="Рост и снижение относительно предыдущего дня"
      action={<div className="peak-chip"><span/> Пик {dateLabel(peakDay?.date)}</div>}
    >
      <div className="energy-chart peak-anomaly-chart">
        <Suspense fallback={<div className="result-chart-fallback">Строим дневной профиль…</div>}>
          <EnergyBusinessCharts kind="daily" data={filteredDailySeries} peakDay={peakDay} controlLimit={dailySignals.controlLimit}/>
        </Suspense>
      </div>
      <div className="load-signal-summary wide">
        <div><small>ИТОГ</small><b>{dailySignals.events.length ? `Рост: ${riseCount} · снижение: ${fallCount}` : 'Резких изменений нет'}</b></div>
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
  const [searchQuery, setSearchQuery] = useState('')
  const mappedCount = consumers.filter(item => mappingForConsumer(mappings, item)).length
  const totalValue = consumers.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const progress = consumers.length ? mappedCount / consumers.length : 0
  const percent = value => new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0))
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase('ru-RU')
  const filteredConsumers = normalizedSearchQuery
    ? consumers.filter(item => {
      const regionId = mappingForConsumer(mappings, item)
      const region = WEATHER_REGIONS.find(candidate => candidate.id === regionId)
      return [
        item.name,
        item.company,
        item.substation,
        item.group,
        region?.name,
      ].some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(normalizedSearchQuery))
    })
    : consumers
  const hasConsumerSearch = Boolean(normalizedSearchQuery)
  useEffect(() => {
    if (!consumers.length) return
    setMappings(current => {
      let changed = false
      const next = { ...current }
      consumers.forEach(item => {
        if (mappingForConsumer(next, item)) return
        next[item.id] = 'aktobe'
        next[consumerKey(item.name)] = 'aktobe'
        changed = true
      })
      return changed ? next : current
    })
  }, [consumers, setMappings])
  const setRegion = (consumerId, regionId) => {
    setMappings(current => {
      const next = { ...current }
      const consumer = consumers.find(item => item.id === consumerId)
      if (regionId) {
        next[consumerId] = regionId
        if (consumer) next[consumerKey(consumer.name)] = regionId
      } else {
        delete next[consumerId]
        if (consumer) delete next[consumerKey(consumer.name)]
      }
      return next
    })
  }
  const fillAktobe = () => {
    setMappings(current => consumers.reduce((next, item) => {
      next[item.id] = next[item.id] || 'aktobe'
      next[consumerKey(item.name)] = next[consumerKey(item.name)] || next[item.id] || 'aktobe'
      return next
    }, { ...current }))
  }
  const clearMappings = () => {
    setMappings(current => {
      const next = { ...current }
      consumers.forEach(item => {
        next[item.id] = 'aktobe'
        next[consumerKey(item.name)] = 'aktobe'
      })
      return next
    })
  }

  if (!hasImports) {
    return <Card title="Потребители ещё не найдены">
      <EmptyState title="Нужен технический баланс" text="Загрузите техбаланс — внешние потребители появятся здесь после проверки файла."/>
    </Card>
  }

  if (loading && !consumers.length) {
    return <div className="result-loading"><span/><b>Собираем список потребителей…</b></div>
  }

  if (error && !consumers.length) {
    return <Card title="Не удалось загрузить потребителей">
      <EmptyState title="Нет связи с сервером" text="Проверьте соединение и повторите попытку."/>
    </Card>
  }

  return <>
    <div className="page-actions">
      <div className="consumer-progress">
        <span><Users/></span>
        <div><b>{mappedCount} / {consumers.length}</b><small>потребителей получили погодный регион</small></div>
        <i><em style={{ width: `${Math.round(progress * 100)}%` }}/></i>
      </div>
      <div className="consumer-actions">
        {loading && <span className="filter-loading">Обновляем…</span>}
        <button className="export" type="button" onClick={reload}><Database/> Обновить</button>
        <button className="export" type="button" onClick={fillAktobe} disabled={!consumers.length}><MapPin/> Остальным — Актобе</button>
        <button className="export" type="button" onClick={clearMappings} disabled={!mappedCount}><RotateCcw/> Сбросить на Актобе</button>
      </div>
    </div>
    <div className="kpi-grid three">
      <KpiCard icon={Users} label="Потребители" value={fmt(consumers.length)} unit="" note="из последней доступной сводки" />
      <KpiCard icon={MapPin} label="Регионы назначены" value={Math.round(progress * 100)} unit="%" note={progress === 1 ? 'прогноз готов к расчёту' : 'назначьте регион каждому'} tone={progress === 1 ? 'green' : 'yellow'} />
      <KpiCard icon={Zap} label="Нагрузка точек учёта" value={fmt(totalValue)} unit="кВт·ч" note="сумма доступных показаний" tone="blue" />
    </div>
    <Card
      title="Погодные регионы потребителей"
      subtitle={hasConsumerSearch
        ? `Найдено ${fmt(filteredConsumers.length)} из ${fmt(consumers.length)}`
        : 'Для новых потребителей по умолчанию используется Актюбинская область'}
      action={<label className="consumer-search" aria-label="Поиск потребителей">
        <Search/>
        <input
          type="search"
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder="Поиск"
        />
      </label>}
    >
      <div className="data-table consumers-table">
        <div className="tr th"><span>Потребитель</span><span>Компания</span><span>Подстанция</span><span>Потребление</span><span>Доля</span><span>Погодный регион</span><span>Состояние</span></div>
        {filteredConsumers.length ? filteredConsumers.map(item => {
          const regionId = mappingForConsumer(mappings, item)
          const region = WEATHER_REGIONS.find(candidate => candidate.id === regionId)
          return <div className="tr" key={item.id}>
            <span className="file-name">{item.name}</span>
            <span>{item.company || '—'}</span>
            <span>{item.substation || item.group || '—'}</span>
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
        }) : <div className="tr"><span>—</span><span>{hasConsumerSearch ? 'Поиск не нашёл потребителей' : 'В отчёте не найдены потребители или объекты нагрузки'}</span><span>—</span><span>—</span><span>—</span><span>—</span><span><Status value="В работе"/></span></div>}
      </div>
    </Card>
  </>
}

function ForecastChartLegend() {
  return <div className="forecast-chart-legend">
    <div className="forecast-legend-group energy">
      <small>ПОТРЕБЛЕНИЕ · ЛЕВАЯ ШКАЛА, кВт·ч</small>
      <div>
        <span className="actual"><i/> Факт</span>
        <span className="forecast"><i/> Прогноз</span>
        <span className="forecast-range"><i/> Ожидаемый диапазон</span>
      </div>
    </div>
    <div className="forecast-legend-group weather">
      <small>ТЕМПЕРАТУРА · ПРАВАЯ ШКАЛА, °C</small>
      <div>
        <span className="weather-actual"><i/> Температура · факт</span>
        <span className="weather-forecast"><i/> Температура · прогноз</span>
        <span className="anomaly"><i/> Аномалия</span>
      </div>
    </div>
  </div>
}

function ForecastPage({ hasImports, consumersState, mappings, forecastReady, onOpenConsumers, onOpenUpload }) {
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
  const [tariffKzt, setTariffKzt] = useState(() => localStorage.getItem('energy-forecast-tariff-kzt') || '')
  const [loading, setLoading] = useState(hasImports)
  const [error, setError] = useState('')
  const consumers = consumersState.consumers || []
  const unmappedConsumers = consumers.filter(item => !mappingForConsumer(mappings, item))
  const selectedConsumers = selectedConsumerIds.length
    ? consumers.filter(item => selectedConsumerIds.includes(item.id))
    : consumers
  const weatherLocations = Array.from(selectedConsumers
    .reduce((byRegion, item) => {
      const region = WEATHER_REGIONS.find(candidate => candidate.id === mappingForConsumer(mappings, item))
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
    localStorage.setItem('energy-forecast-tariff-kzt', tariffKzt)
  }, [tariffKzt])

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
    return <Card title="Прогноз ещё не построен">
      <EmptyState title="Нужна история потребления" text="Загрузите ежедневную сводку хотя бы за один месяц. Технический баланс повысит надёжность расчёта."/>
    </Card>
  }

  if (!forecastReady) {
    if (consumersState.loading && !consumers.length) {
      return <div className="result-loading"><span/><b>Проверяем готовность данных для прогноза…</b></div>
    }
    const mappedCount = consumers.length - unmappedConsumers.length
    return <Card title="Подготовка прогноза" subtitle="Погодные регионы нужны для корректной температурной поправки">
      <div className="forecast-locked">
        <MapPin/>
        <div>
          <b>Осталось назначить погодные регионы</b>
          <p>Готово {mappedCount} из {consumers.length || 0}. Назначьте регион оставшимся потребителям — прогноз сформируется автоматически.</p>
          {!!unmappedConsumers.length && <ul>
            {unmappedConsumers.slice(0, 5).map(item => <li key={item.id}>{item.name}</li>)}
            {unmappedConsumers.length > 5 && <li>и ещё {unmappedConsumers.length - 5}</li>}
          </ul>}
        </div>
        <button type="button" onClick={onOpenConsumers}>Перейти к потребителям <ArrowRight/></button>
      </div>
    </Card>
  }

  if (loading && !result) {
    return <div className="result-loading"><span/><b>Строим прогноз по истории и погоде…</b></div>
  }

  const rawForecast = result
  if (error) {
    return <Card title="Не удалось построить прогноз">
      <EmptyState title="Расчёт не завершён" text={friendlyApiError(error) || error}/>
    </Card>
  }

  if (!rawForecast || rawForecast.status !== 'ready') {
    return <Card title="Прогноз ещё не построен">
      <EmptyState title="Недостаточно данных" text={rawForecast?.message || 'Нужен хотя бы один технический баланс с распознанным месяцем.'}/>
    </Card>
  }

  const mln = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0) / 1_000_000)
  const percent = value => new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0))
  const signedPercent = value => `${Number(value || 0) >= 0 ? '+' : '−'}${percent(Math.abs(Number(value || 0)))}`
  const money = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0))
  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00`))
    : '—'
  const dateKeyInTimezone = (timeZone = 'Asia/Aqtobe') => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).reduce((map, item) => {
      map[item.type] = item.value
      return map
    }, {})
    return `${parts.year}-${parts.month}-${parts.day}`
  }
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
    segments: (rawForecast.segments || []).map(item => ({ ...item, value: Number(item.value || 0) * consumerScale })),
    substations: (rawForecast.substations || []).map(item => ({ ...item, forecast_kwh: Number(item.forecast_kwh || 0) * consumerScale })),
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
  const hasDailyProfile = Number(forecast.source_days || 0) > 0 && combinedSeries.some(item => item.phase === 'actual')
  const totalWeatherAnomalies = Number(forecast.weather?.history_anomaly_days || 0) + Number(forecast.weather?.anomaly_days || 0)
  const signedEnergy = value => `${Number(value || 0) >= 0 ? '+' : '−'}${mln(Math.abs(Number(value || 0)))}`
  const selectedConsumerLabel = selectedConsumerIds.length
    ? `${selectedConsumerIds.length} потребителей · ${mln(selectedConsumerValue)} млн кВт·ч`
    : 'Всё потребление'
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
  const tariff = Number(String(tariffKzt || '').replace(',', '.'))
  const hasTariff = Number.isFinite(tariff) && tariff > 0
  const forecastCost = forecast.forecast_total_kwh * (hasTariff ? tariff : 0)
  const sourceCost = forecast.source_total_kwh * (hasTariff ? tariff : 0)
  const costDelta = forecastCost - sourceCost
  const forecastTimezone = weatherLocations[0]?.timezone || 'Asia/Aqtobe'
  const todayIso = dateKeyInTimezone(forecastTimezone)
  const forecastStartIso = forecast.period ? `${forecast.period}-01` : ''
  const planDays = forecast.period
    ? new Date(Date.UTC(Number(forecast.period.slice(0, 4)), Number(forecast.period.slice(5, 7)), 0)).getUTCDate()
    : 30
  const forecastEndIso = forecast.period ? `${forecast.period}-${String(planDays).padStart(2, '0')}` : ''
  const todayInForecastMonth = Boolean(forecast.period && todayIso >= forecastStartIso && todayIso <= forecastEndIso)
  const forecastIsFuture = Boolean(forecast.period && todayIso < forecastStartIso)
  const forecastIsPast = Boolean(forecast.period && todayIso > forecastEndIso)
  const elapsedDays = forecastIsFuture
    ? 0
    : forecastIsPast
      ? planDays
      : todayInForecastMonth
        ? Number(todayIso.slice(8, 10))
        : 0
  const remainingDays = Math.max(0, planDays - elapsedDays)
  const elapsedShare = planDays ? elapsedDays / planDays : 0
  const todayPlanValue = forecast.forecast_total_kwh * elapsedShare
  const todayPlanLow = forecast.forecast_low_kwh * elapsedShare
  const todayPlanHigh = forecast.forecast_high_kwh * elapsedShare
  const todayPlanLabel = todayInForecastMonth
    ? `Сегодня · ${dateLabel(todayIso)}`
    : forecastIsFuture
      ? `До начала · ${dateLabel(forecastStartIso)}`
      : forecastIsPast
        ? `Месяц завершён · ${dateLabel(forecastEndIso)}`
        : 'Сегодня'
  const planCheckpoints = [25, 50, 75, 100].map(share => {
    const [year, month] = String(forecast.period || '').split('-').map(Number)
    const day = Math.max(1, Math.min(planDays, Math.round(planDays * share / 100)))
    const isoDate = year && month ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
    return {
      share,
      label: isoDate ? dateLabel(isoDate) : `${share}% месяца`,
      value: forecast.forecast_total_kwh * share / 100,
      low: forecast.forecast_low_kwh * share / 100,
      high: forecast.forecast_high_kwh * share / 100,
    }
  })

  return <div className="forecast-page">
    <section className="forecast-command">
      <div className="forecast-command-main">
        <div className="forecast-live"><i/> ПРОГНОЗ ГОТОВ <span>·</span> {String(forecastPeriodLabel).toUpperCase()}</div>
        <div className="forecast-command-value">
          <b>{mln(forecast.forecast_total_kwh)}</b>
          <span>млн<br/>кВт·ч</span>
        </div>
        <div className="forecast-command-context">
          <span className={forecastDeltaPositive ? 'positive' : 'negative'}>
            {forecastDeltaPositive ? <TrendingUp/> : <TrendingDown/>}
            {signedPercent(forecast.expected_change_pct)}
          </span>
          <p>к {sourcePeriodLabel}. В расчёте учтены календарь, погода и заданные события.</p>
        </div>
      </div>
      <div className="forecast-command-side">
        <div className="forecast-confidence-ring" style={{ '--confidence': `${Math.round(Number(forecast.confidence || 0) * 100) * 3.6}deg` }}>
          <div><b>{confidencePercent}</b><small>надёжность</small></div>
        </div>
        <div className="forecast-confidence-copy">
          <span className="forecast-confidence-label">
            Надёжность прогноза
            <button type="button" aria-label="Как рассчитывается надёжность прогноза" aria-describedby="forecast-confidence-tooltip">
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
        <div><small>ОБЪЕКТЫ В РАСЧЁТЕ</small><b>{selectedConsumerLabel}</b></div>
      </div>
      <div className="forecast-scope-chips">
        {consumers.map(item => {
          const active = selectedConsumerIds.includes(item.id)
          const region = WEATHER_REGIONS.find(candidate => candidate.id === mappingForConsumer(mappings, item))
          return <button type="button" key={item.id} className={active ? 'active' : ''} onClick={() => toggleConsumer(item.id)} title={`${region?.name || 'Регион не указан'} · ${fmt(item.value)} кВт·ч`}>
            <span>{item.name}</span>
            {active && <Check/>}
          </button>
        })}
      </div>
      <button type="button" className="forecast-scope-reset" onClick={() => setSelectedConsumerIds([])} disabled={!selectedConsumerIds.length}>Сбросить выбор</button>
    </section>

    <section className="forecast-signal-strip" aria-label="Ключевые факторы прогноза">
      <article>
        <span className="forecast-signal-icon weather"><Thermometer/></span>
        <div><small>ПОГОДА</small><b>{signedEnergy(forecast.weather_effect_kwh)} <em>млн кВт·ч</em></b></div>
        <p>{hasDailyProfile && weatherReady ? `${totalWeatherAnomalies} дней с аномальной погодой` : 'нет дневного профиля'}</p>
      </article>
      <article>
        <span className="forecast-signal-icon event"><Factory/></span>
        <div><small>СОБЫТИЯ</small><b>{signedEnergy(forecast.event_effect_kwh)} <em>млн кВт·ч</em></b></div>
        <p>{adjustments.length ? `${adjustments.length} событий учтено` : 'событий не задано'}</p>
      </article>
      <article>
        <span className="forecast-signal-icon range"><Gauge/></span>
        <div><small>ОЖИДАЕМЫЙ ИТОГ</small><b>{mln(forecast.forecast_low_kwh)}–{mln(forecast.forecast_high_kwh)}</b></div>
        <p>млн кВт·ч</p>
      </article>
    </section>

    <div className="forecast-workspace">
      {hasDailyProfile ? <Card
        className="energy-chart-card combined-forecast-card forecast-main-chart"
        title={`${sourcePeriodLabel} — факт · ${forecastPeriodLabel} — прогноз`}
        subtitle="Потребление и температура по дням"
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
          <p>Прогноз согласован с техбалансом. Красным отмечены дни с аномальной погодой; наведите на дату, чтобы увидеть вклад факторов.</p>
        </div>
      </Card> : <Card
        className="monthly-plan-card forecast-main-chart"
        title={`${forecastPeriodLabel} · месячный план`}
        subtitle="Дневная линия скрыта, пока нет ежедневной сводки"
        action={<button className="forecast-export" type="button" onClick={onOpenUpload}><Upload/> Загрузить сводку</button>}
      >
        <section className="monthly-plan-hero">
          <div>
            <small>БАЗОВЫЙ ПЛАН</small>
            <b>{mln(forecast.forecast_total_kwh)} <em>млн кВт·ч</em></b>
            <p>Это прогноз месячного объёма, а не дневная форма нагрузки. Дневной контроль включится после загрузки ежедневной сводки.</p>
          </div>
          <div className="monthly-plan-range" aria-label="Прогнозный коридор">
            <span>Нижняя граница <b>{mln(forecast.forecast_low_kwh)}</b></span>
            <i><em style={{ left: '18%', width: '64%' }}><strong style={{ left: '50%' }}/></em></i>
            <span>Верхняя граница <b>{mln(forecast.forecast_high_kwh)}</b></span>
          </div>
        </section>
        <div className="monthly-plan-grid">
          <article className="monthly-plan-today">
            <small>{todayPlanLabel}</small>
            <b>{mln(todayPlanValue)} <em>млн кВт·ч</em></b>
            <p>{todayInForecastMonth
              ? `Плановая накопленная траектория на ${elapsedDays}-й день месяца. Осталось ${remainingDays} дней.`
              : forecastIsFuture
                ? `Прогнозный месяц ещё не начался. План стартует ${dateLabel(forecastStartIso)}.`
                : `Прогнозный месяц уже завершён. Для план-факт сравнения нужна ежедневная сводка.`}</p>
            <i aria-hidden="true"><em style={{ width: `${Math.round(elapsedShare * 100)}%` }}/></i>
            <span>коридор {mln(todayPlanLow)}–{mln(todayPlanHigh)} млн кВт·ч</span>
          </article>
          <article className="monthly-plan-tariff">
            <div>
              <small>ЗАТРАТЫ</small>
              <b>{hasTariff ? `${money(forecastCost)} ₸` : 'Нужен тариф'}</b>
              <p>{hasTariff
                ? `${costDelta >= 0 ? '+' : '−'}${money(Math.abs(costDelta))} ₸ к ${sourcePeriodLabel}`
                : `Энергетическая экспозиция: ${signedEnergy(forecast.forecast_total_kwh - forecast.source_total_kwh)} млн кВт·ч к ${sourcePeriodLabel}`}</p>
            </div>
            <label>
              <span>Тариф, ₸/кВт·ч</span>
              <input inputMode="decimal" value={tariffKzt} onChange={event => setTariffKzt(event.target.value)} placeholder="например 28.5"/>
            </label>
          </article>
          <article className="monthly-plan-action">
            <small>КАК ИСПОЛЬЗОВАТЬ</small>
            <b>План-факт трекер</b>
            <p>После загрузки ежедневной сводки система сравнит накопленный факт с этим коридором и покажет, идём выше, ниже или в пределах плана.</p>
            <button type="button" onClick={onOpenUpload}><Upload/> Загрузить ежедневную сводку</button>
          </article>
        </div>
        <div className="monthly-plan-checkpoints">
          {planCheckpoints.map(item => <div key={item.share}>
            <span><b>{item.share}%</b><small>{item.label}</small></span>
            <strong>{mln(item.value)} млн</strong>
            <p>коридор {mln(item.low)}–{mln(item.high)} млн кВт·ч</p>
          </div>)}
        </div>
      </Card>}

      <Card className="forecast-scenario-rail" title="Сценарии" subtitle="Возможный итог при разных условиях">
        <div className="forecast-scenarios">
          {(forecast.scenarios || []).map((item, index) => <article className={`scenario ${item.name === 'Базовый' ? 'primary' : ''}`} key={item.name}>
            <span>{item.name}<small>{signedPercent(item.delta_pct)}</small></span>
            <b>{mln(item.value)}<em>млн кВт·ч</em></b>
            <i style={{ '--scenario-color': chartPalette[index % chartPalette.length] }}/>
          </article>)}
        </div>
        <div className="forecast-rail-divider"><span>Факторы</span></div>
        <div className="forecast-driver-list">
          {(forecast.drivers || []).map(item => <div key={item.label}>
            <span>{item.label}</span>
            <b>{typeof item.value === 'number' ? (Math.abs(item.value) < 1 ? signedPercent(item.value) : fmt(item.value)) : item.value}</b>
          </div>)}
        </div>
      </Card>
    </div>

    <section className="forecast-breakdown-grid" aria-label="Структура прогноза">
      <Card title="Казахойл и внешние потребители" subtitle="Разделение базового прогноза по границе техбаланса">
        <div className="forecast-segment-list">
          {(forecast.segments || []).map((item, index) => <div key={item.id}>
            <span style={{ '--segment-color': chartPalette[index % chartPalette.length] }}><i/></span>
            <div><b>{item.name}</b><small>{percent(item.share)} прогноза</small></div>
            <strong>{mln(item.value)} <small>млн кВт·ч</small></strong>
          </div>)}
        </div>
      </Card>
      <Card title="Прогноз по подстанциям" subtitle="Внешнее потребление, распределённое по последнему техбалансу">
        <div className="forecast-substation-list">
          {(forecast.substations || []).map(item => <div key={item.id}>
            <span><b>{item.name}</b><small>{percent(item.share)} внешнего потребления</small></span>
            <strong>{mln(item.forecast_kwh)} <small>млн кВт·ч</small></strong>
          </div>)}
        </div>
      </Card>
    </section>

    {hasDailyProfile && fullscreenChart && <div className="chart-fullscreen" role="dialog" aria-modal="true" aria-label="Прогноз нагрузки" onClick={() => setFullscreenChart(false)}>
      <section onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <small>ДЕТАЛЬНАЯ ВИЗУАЛИЗАЦИЯ</small>
            <h3>{sourcePeriodLabel}: факт · {forecastPeriodLabel}: прогноз</h3>
            <p>Ожидаемый диапазон {mln(forecast.forecast_low_kwh)}–{mln(forecast.forecast_high_kwh)} млн кВт·ч · надёжность прогноза {confidencePercent}</p>
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
        title="Производственные события"
        subtitle="Остановки, снижение нагрузки и ввод мощности"
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
          : <div className="forecast-adjustment-empty"><Factory/><span>Сейчас рассчитан базовый сценарий без дополнительных событий</span></div>
        }
      </Card>

      <Card className="span-12 forecast-assurance-card" title="Методика и источники" subtitle="Погода, исходные данные и качество расчёта">
        <div className={`forecast-weather-status ${weatherReady ? 'ready' : 'offline'}`}>
          <CloudSun/>
          <div><small>ИСТОЧНИК</small><b>{forecast.weather?.provider || 'Open-Meteo'}</b></div>
          <div><small>ПОГОДНЫЙ РЕГИОН</small><b>{forecast.weather?.location?.name || 'Жанажол'}</b></div>
          <div><small>ОСНОВА РАСЧЁТА</small><b>Температура · {forecast.weather?.model?.observations || 0} наблюдений</b></div>
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
  const currentShare = progress.phase === 'processing' || progress.phase === 'ai'
    ? .94
    : Math.min(1, Number(progress.percent || 0) / 100)
  const overallPercent = isDone
    ? 100
    : Math.round((progress.completed + currentShare) / progress.total * 100)
  const phaseLabel = progress.phase === 'uploading'
    ? `Загружаем файл · ${progress.percent || 0}%`
    : progress.phase === 'processing'
      ? 'Проверяем структуру и данные'
      : progress.phase === 'ai'
        ? 'AI ищет ключевые изменения'
      : isDone
        ? 'Файлы готовы к работе'
        : 'Не удалось завершить загрузку'

  return <aside className={`upload-progress-widget ${progress.phase}`} role="status" aria-live="polite" aria-label="Ход загрузки файлов">
    <div className="upload-progress-head">
      <span className="upload-progress-icon">
        {isDone ? <Check/> : isError ? <AlertTriangle/> : <Upload/>}
      </span>
      <div>
        <small>{isDone ? 'ВСЁ ГОТОВО' : isError ? 'ЗАГРУЗКА НЕ ЗАВЕРШЕНА' : 'ЗАГРУЗКА ФАЙЛОВ'}</small>
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

function UploadValidationDialog({ report, onClose, onDeleteRejected, deletingImportIds = [] }) {
  if (!report) return null
  const accepted = report.results.filter(item => item.status === 'accepted')
  const rejected = report.results.filter(item => item.status === 'rejected')
  const title = rejected.length
    ? 'Проверка файлов завершена с замечаниями'
    : 'Все файлы прошли проверку'

  return <div className="validation-dialog-backdrop" role="presentation">
    <section className="validation-dialog" role="dialog" aria-modal="true" aria-labelledby="validation-dialog-title">
      <header>
        <div className={`validation-dialog-icon ${rejected.length ? 'warning' : 'ok'}`}>
          {rejected.length ? <AlertTriangle/> : <Check/>}
        </div>
        <div>
          <small>РЕЗУЛЬТАТ ЗАГРУЗКИ</small>
          <h3 id="validation-dialog-title">{title}</h3>
          <p>{accepted.length} успешно · {rejected.length} не прошли валидацию</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть результат проверки"><X/></button>
      </header>

      <div className="validation-dialog-body">
        <div className="validation-group">
          <h4><Check/> Успешно загружены</h4>
          {accepted.length ? accepted.map(item => <article key={item.name} className="validation-file ok">
            <FileSpreadsheet/>
            <span><b>{item.name}</b><small>{mapDatasetKind(item.datasetKind)} · {fmt(item.rows)} строк</small></span>
          </article>) : <p className="validation-empty">Нет файлов, прошедших проверку.</p>}
        </div>

        <div className="validation-group">
          <h4><AlertTriangle/> Не прошли валидацию</h4>
          {rejected.length ? rejected.map(item => <article key={item.name} className="validation-file bad">
            <FileSpreadsheet/>
            <span>
              <b>{item.name}</b>
              <small><strong>Что не прошло:</strong> {item.reason}</small>
            </span>
            <div className="validation-file-actions">
              <span className="validation-tooltip-wrap">
                <button type="button" aria-label={`Подробности ошибки ETL для ${item.name}`}>?</button>
                <i role="tooltip">{item.details}</i>
              </span>
              {item.batchId && <button
                type="button"
                className="validation-delete-btn"
                onClick={() => onDeleteRejected?.(item)}
                disabled={deletingImportIds.includes(item.batchId)}
                title="Удалить файл из загрузок"
              >
                <Trash2/> {deletingImportIds.includes(item.batchId) ? 'Удаляем…' : 'Удалить'}
              </button>}
            </div>
          </article>) : <p className="validation-empty">Ошибок формата не найдено.</p>}
        </div>
      </div>

      <footer>
        <button type="button" className="export primary" onClick={onClose}>Понятно</button>
      </footer>
    </section>
  </div>
}

function parseInsightBrief(insight) {
  if (!insight?.content) return null
  try {
    const parsed = JSON.parse(insight.content)
    if (parsed?.headline && Array.isArray(parsed.signals) && parsed.action) return parsed
  } catch {
    // Older saved insights were plain text; keep them readable after the schema upgrade.
  }
  return {
    status: 'watch',
    eyebrow: 'Результат AI-анализа',
    headline: 'Что стоит проверить после загрузки',
    summary: insight.content,
    signals: [],
    action: {
      title: 'Продолжить разбор в AI-чате',
      detail: 'Задайте уточняющий вопрос — контекст последней загрузки уже подключён.',
    },
    confidence: {
      label: 'Предыдущий формат',
      basis: 'Для новых загрузок вывод будет дополнен измеримыми сигналами.',
    },
  }
}

function getInsightPeriodLabel(filename) {
  const value = String(filename || '').toLowerCase()
  const year = value.match(/\b(20\d{2})\b/)?.[1]
  const months = [
    ['январ', 'Январь'], ['феврал', 'Февраль'], ['март', 'Март'],
    ['апрел', 'Апрель'], ['ма[йя]', 'Май'], ['июн', 'Июнь'],
    ['июл', 'Июль'], ['август', 'Август'], ['сентябр', 'Сентябрь'],
    ['октябр', 'Октябрь'], ['ноябр', 'Ноябрь'], ['декабр', 'Декабрь'],
  ]
  const month = months.find(([pattern]) => new RegExp(pattern).test(value))?.[1]
  return [month, year].filter(Boolean).join(' ') || 'Новый период'
}

function formatInsightValue(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^([+-]?\d[\d\s]*(?:[.,]\d+)?)(.*)$/)
  if (!match) return raw
  const numeric = Number(match[1].replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(numeric)) return raw
  const decimals = Math.abs(numeric) >= 1000 ? 1 : 2
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: decimals,
  }).format(numeric)}${match[2]}`
}

function formatInsightText(value) {
  return String(value || '').replace(
    /([+-]?\d(?:[\d ]*\d)?(?:[.,]\d+)?)(?=\s*(?:кВт·ч|МВт·ч|кВт|МВт|%))/g,
    number => formatInsightValue(number)
  )
}

function formatInsightLabel(value) {
  const label = String(value || '').trim()
  if (/^Суточное потребление,\s*пик месяца$/i.test(label)) return 'Пик потребления'
  if (/^Суточное потребление,\s*конец периода$/i.test(label)) return 'Конец периода'
  if (/^Суточное потребление,\s*(локальный )?минимум/i.test(label)) return 'Минимум периода'
  return label
}

function removeRepeatedInsightSentence(headline, summary) {
  const sentences = String(summary || '').match(/[^.!?]+[.!?]?/g) || []
  if (sentences.length < 2) return summary
  const stems = value => new Set(
    String(value || '')
      .toLowerCase()
      .match(/[а-яё]{5,}/g)
      ?.map(word => word.slice(0, 5)) || []
  )
  const headlineStems = stems(headline)
  const firstStems = stems(sentences[0])
  const overlap = [...headlineStems].filter(stem => firstStems.has(stem)).length
  if (overlap < Math.min(2, headlineStems.size)) return summary
  return sentences.slice(1).join(' ').trim()
}

function ImportIntelligenceBrief({ insight, notice, sourceImport, onDismiss, onOpenChat, onOpenIntegrations, onOpenData }) {
  const dataActionLabel = sourceImport?.dataset_kind === 'daily_summary'
    ? 'Открыть пики и динамику'
    : 'Открыть энергобаланс'

  if (!insight) {
    return <section className="import-ready-receipt">
      <span className="import-ready-icon"><Check/></span>
      <div>
        <small>ЗАГРУЗКА ЗАВЕРШЕНА</small>
        <h3>Файл готов к анализу</h3>
        <p>{notice}</p>
      </div>
      <div className="import-ready-actions">
        <button type="button" className="quiet" onClick={onOpenData}>{dataActionLabel}</button>
        <button type="button" onClick={onOpenIntegrations}><Settings2/> Подключить AI</button>
      </div>
      <button className="brief-dismiss" type="button" onClick={onDismiss} aria-label="Закрыть результат"><X/></button>
    </section>
  }

  const brief = parseInsightBrief(insight)
  const statusMeta = {
    stable: { label: 'Критичных отклонений нет', icon: Check },
    watch: { label: 'Есть что проверить', icon: Info },
    risk: { label: 'Требуется действие', icon: AlertTriangle },
  }[brief.status] || { label: 'Есть что проверить', icon: Info }
  const StatusIcon = statusMeta.icon
  const sourceType = sourceImport?.dataset_kind ? mapDatasetKind(sourceImport.dataset_kind) : 'Новый набор данных'
  const sourcePeriod = getInsightPeriodLabel(sourceImport?.original_filename)
  const supportingSummary = removeRepeatedInsightSentence(brief.headline, brief.summary)

  return <section className={`import-intelligence-brief ${brief.status || 'watch'}`}>
    <div className="brief-accent" aria-hidden="true"/>
    <header className="brief-header">
      <div className="brief-identity">
        <span><BrainCircuit/></span>
        <div className="brief-source">
          <small>AI-разбор</small>
          <div className="brief-source-meta">
            <span>{sourceType}</span>
            <i aria-hidden="true"/>
            <span>{sourcePeriod}</span>
          </div>
        </div>
      </div>
      <div className="brief-header-actions">
        <div className="brief-status"><StatusIcon/> {statusMeta.label}</div>
        <button className="brief-dismiss" type="button" onClick={onDismiss} aria-label="Закрыть AI-разбор"><X/></button>
      </div>
    </header>

    <div className="brief-conclusion">
      <small>Главное</small>
      <h3>{brief.headline}</h3>
      {supportingSummary && <p>{formatInsightText(supportingSummary)}</p>}
    </div>

    {brief.signals.length > 0 && <div className="brief-signals">
      {brief.signals.map((signal, index) => <article className={signal.tone || 'neutral'} key={`${signal.label}-${index}`}>
        <small>{formatInsightLabel(signal.label)}</small>
        <strong>{formatInsightValue(signal.value)}</strong>
        <p>{formatInsightText(signal.context)}</p>
      </article>)}
    </div>}

    <footer className="brief-footer">
      <div className="brief-next-step">
        <span><ArrowRight/></span>
        <div>
          <small>Следующий шаг</small>
          <b>{brief.action.title}</b>
          <p>{formatInsightText(brief.action.detail)}</p>
        </div>
      </div>
      <div className="brief-confidence">
        <small>Надёжность вывода · {brief.confidence.label}</small>
        <p>{brief.confidence.basis}</p>
      </div>
      <div className="brief-actions">
        <button type="button" className="quiet" onClick={onOpenData}>{dataActionLabel}</button>
        <button type="button" onClick={onOpenChat}><MessageCircle/> Задать вопрос AI</button>
      </div>
    </footer>
  </section>
}

function Quality({
  importsState,
  onUploadComplete,
  onUploadSettled,
  onDeleteInvalidImport,
  deletingImportIds = [],
  onOpenChat,
  onOpenIntegrations,
}) {
  const inputRef = useRef(null)
  const { imports, loading, error, reload, mergeImports } = importsState
  const [issues, setIssues] = useState([])
  const [selectedBatchId, setSelectedBatchId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [toast, setToast] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [aiInsight, setAiInsight] = useState(null)
  const [aiNotice, setAiNotice] = useState('')
  const [lastUploadedBatchId, setLastUploadedBatchId] = useState(null)
  const [uploadValidationReport, setUploadValidationReport] = useState(null)

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
    setAiInsight(null)
    setAiNotice('')
    setLastUploadedBatchId(null)
    setPreviewError('')
    setUploadValidationReport(null)
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
      const acceptedBatches = []
      const rejectedBatches = []
      const validationResults = []
      for (const [index, file] of files.entries()) {
        setUploadProgress(current => ({
          ...current,
          phase: 'uploading',
          completed: index,
          currentIndex: index,
          currentName: file.name,
          percent: 0,
        }))
        try {
          const batch = await uploadImportFile(file, update => {
            setUploadProgress(current => ({ ...current, ...update }))
          })
          uploadedBatches.push(batch)
          mergeImports([batch])
          const issueDetails = (!isImportReady(batch) || Number(batch.error_count || 0) > 0)
            ? await fetchImportIssues(batch.id).catch(() => [])
            : []
          if (isImportReady(batch)) {
            acceptedBatches.push(batch)
            validationResults.push({
              status: 'accepted',
              name: batch.original_filename,
              datasetKind: batch.dataset_kind,
              rows: batch.total_rows,
            })
          } else {
            rejectedBatches.push(batch)
            validationResults.push({
              status: 'rejected',
              batchId: batch.id,
              name: batch.original_filename,
              datasetKind: batch.dataset_kind,
              rows: batch.total_rows,
              reason: formatValidationReason(batch, issueDetails),
              details: formatValidationDetails(batch, issueDetails),
            })
          }
        } catch (fileError) {
          validationResults.push({
            status: 'rejected',
            name: file.name,
            datasetKind: 'unknown',
            rows: 0,
            reason: fileError.message || 'Файл не удалось загрузить.',
            details: fileError.message || 'Файл не удалось загрузить в ETL-процесс.',
          })
        }
        setUploadProgress(current => ({ ...current, completed: index + 1 }))
      }

      const lastBatch = acceptedBatches[acceptedBatches.length - 1]
      setLastUploadedBatchId(lastBatch?.id || null)
      setUploadValidationReport({ results: validationResults })
      const rejectedCount = validationResults.filter(item => item.status === 'rejected').length
      onUploadSettled?.({ uploadedBatches, acceptedBatches, rejectedBatches, validationResults })
      setToast(rejectedCount
        ? `${acceptedBatches.length} файлов прошли проверку, ${rejectedCount} требуют внимания`
        : acceptedBatches.length === 1
          ? `${lastBatch.original_filename} готов к работе`
          : `${acceptedBatches.length} файлов готовы к работе`
      )
      if (uploadedBatches.length) {
        mergeImports(uploadedBatches)
      }
      await reload().catch(() => {})
      setAiNotice('')
      if (rejectedCount > 0) {
        setAiNotice('')
      } else if (!lastBatch) {
        setAiNotice('')
      } else try {
        const aiSettingsResponse = await apiFetch('/api/v1/ai/settings')
        const aiSettings = aiSettingsResponse.ok ? await parseJsonResponse(aiSettingsResponse) : null
        if (!aiSettings?.has_api_key) {
          setAiNotice('Показатели и прогноз уже обновлены. Подключите ЭнергоПульс AI, если нужен дополнительный разбор.')
        } else {
          setUploadProgress(current => ({ ...current, phase: 'ai', completed: files.length }))
          const insightResponse = await apiFetch(`/api/v1/imports/${lastBatch.id}/ai-insight`, {
            method: 'POST',
          })
          if (!insightResponse.ok) {
            const message = await readApiError(insightResponse)
            if (insightResponse.status === 409) {
              setAiNotice('Файл готов к работе. ЭнергоПульс AI можно подключить позже в одноимённом разделе.')
            } else {
              setAiNotice(`Файл обработан, но AI-разбор не готов: ${message}`)
            }
          } else {
            setAiInsight(await parseJsonResponse(insightResponse))
          }
        }
      } catch (insightError) {
        setAiNotice('Файл обработан, показатели обновлены. AI можно подключить позже.')
      }
      setUploadProgress(current => ({ ...current, phase: 'done', completed: files.length, percent: 100 }))
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
  const resultImport = imports.find(item => item.id === (aiInsight?.batch_id || lastUploadedBatchId))
  const selectedImport = imports.find(item => item.id === selectedBatchId)
  const handleDeleteInvalidImport = async item => {
    const batchId = Number(item?.batchId || item?.id || item)
    if (!batchId) return
    const deleted = await onDeleteInvalidImport?.(item)
    if (!deleted) return
    setUploadValidationReport(current => current
      ? { ...current, results: current.results.filter(result => result.batchId !== batchId) }
      : current
    )
    if (selectedBatchId === batchId) {
      setSelectedBatchId(null)
      setIssues([])
    }
    if (lastUploadedBatchId === batchId) {
      setLastUploadedBatchId(null)
      setAiInsight(null)
      setAiNotice('')
    }
  }
  const displayedIssues = issues.map(issue => ({
    sheet: issue.sheet_name || 'n/a',
    file: selectedImport?.original_filename || 'n/a',
    field: mapIssueRule(issue.rule_code),
    issue: mapIssueMessage(issue),
    row: issue.row_index || '—',
    state: issue.severity === 'error' ? 'Открыта' : issue.severity === 'warning' ? 'В работе' : 'Исправлена',
  }))

  return <>
    <div className="page-actions">
      <div/>
      <input ref={inputRef} data-upload-picker type="file" accept=".csv,.xlsx,.xls" multiple hidden onChange={onFileChange}/>
      <button className="export primary" onClick={openPicker} disabled={uploading}>
        <Upload/> {uploading ? 'Загрузка…' : 'Загрузить файлы'}
      </button>
    </div>
    {toast && <div className="toast"><Check/> {toast} <button onClick={()=>setToast('')}><X/></button></div>}
    {previewError && <div className="toast" style={{ background: '#b42318' }}><AlertTriangle/> {previewError} <button onClick={()=>setPreviewError('')}><X/></button></div>}
    <UploadProgressWidget progress={uploadProgress} onClose={() => setUploadProgress(null)}/>
    <UploadValidationDialog
      report={uploadValidationReport}
      onClose={() => setUploadValidationReport(null)}
      onDeleteRejected={handleDeleteInvalidImport}
      deletingImportIds={deletingImportIds}
    />
    {(aiInsight || aiNotice) && <ImportIntelligenceBrief
      insight={aiInsight}
      notice={aiNotice}
      sourceImport={resultImport}
      onDismiss={() => { setAiInsight(null); setAiNotice('') }}
      onOpenChat={onOpenChat}
      onOpenIntegrations={onOpenIntegrations}
      onOpenData={() => {
        onUploadComplete(resultImport?.dataset_kind)
      }}
    />}
    {historyUnavailable && <Card title="Как загрузить данные" className="upload-empty-state">
      <div className="journey-list wide">
        <div><b>1</b><div><strong>Выберите файл</strong><p>Подойдут `.xlsx`, `.xls` и `.csv`.</p></div></div>
        <div><b>2</b><div><strong>Дождитесь проверки</strong><p>Система прочитает структуру, строки и формулы.</p></div></div>
        <div><b>3</b><div><strong>Откройте результат</strong><p>Увидите готовность файла и точные замечания, если они есть.</p></div></div>
      </div>
    </Card>}
    {!historyUnavailable && <>
    <div className="dq-score"><div className="score-ring"><b>{score}</b><span>из 100</span></div><div><small>КАЧЕСТВО ДАННЫХ</small><h2>{imports.length ? 'Данные проверены' : 'Добавьте первый файл'}</h2><p>{imports.length ? `Обработано ${fmt(totalRows)} строк в ${imports.length} файлах` : 'Поддерживаются .xlsx, .xls и .csv'}</p></div><div className="dq-metrics"><span><b>{fmt(totalRows)}</b>Строк</span><span><b>{totalWarnings + totalErrors}</b>Замечаний</span><span><b>{successfulImports} / {imports.length}</b>Готово</span></div></div>
    <div className="kpi-grid three">
      <KpiCard icon={Database} label="Обработано строк" value={fmt(totalRows)} unit="" note="по всем файлам"/>
      <KpiCard icon={AlertTriangle} label="Замечания" value={String(totalWarnings + totalErrors)} unit="" note={totalWarnings + totalErrors ? 'откройте список' : 'замечаний нет'} tone="yellow"/>
      <KpiCard icon={FileCheck2} label="Готовы к расчёту" value={`${successfulImports} / ${imports.length}`} unit="" note="проверка завершена" tone="blue"/>
    </div>
    <Card title="История загрузок" subtitle="Файлы и результаты проверки">
      <div className="data-table dq-table import-history-table">
        <div className="tr th"><span>№</span><span>Файл</span><span>Тип данных</span><span>Состояние</span><span>Строк</span><span>Замечания</span><span>Действия</span></div>
        {imports.length ? imports.map(item => <div
          className={`tr ${selectedBatchId===item.id?'selected':''}`}
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={()=>loadPreview(item.id)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') loadPreview(item.id)
          }}
        >
          <span>{item.id}</span>
          <span className="file-name">{item.original_filename}</span>
          <span>{mapDatasetKind(item.dataset_kind)}</span>
          <span><Status value={mapBatchStatus(item.status)}/></span>
          <span>{fmt(item.total_rows)}</span>
          <span>{item.error_count}</span>
          <span>
            {isCriticalImportIssue(item) ? <button
              type="button"
              className="row-delete-btn"
              onClick={event => {
                event.stopPropagation()
                handleDeleteInvalidImport(item)
              }}
              disabled={deletingImportIds.includes(item.id)}
              title="Удалить файл, не прошедший валидацию"
            >
              <Trash2/> {deletingImportIds.includes(item.id) ? 'Удаляем…' : 'Удалить'}
            </button> : <small className="row-action-muted">—</small>}
          </span>
        </div>) : <div className="tr"><span>—</span><span>История загрузок появится после первого файла</span><span>—</span><span>—</span><span>—</span><span>—</span><span>—</span></div>}
      </div>
    </Card>
    <Card
      title="Замечания"
      subtitle={selectedBatchId ? selectedImport?.original_filename : 'Выберите файл'}
      action={selectedImport && isCriticalImportIssue(selectedImport) ? <button
        type="button"
        className="row-delete-btn"
        onClick={() => handleDeleteInvalidImport(selectedImport)}
        disabled={deletingImportIds.includes(selectedImport.id)}
        title="Удалить файл, не прошедший валидацию"
      >
        <Trash2/> {deletingImportIds.includes(selectedImport.id) ? 'Удаляем…' : 'Удалить файл'}
      </button> : null}
    >
      <div className="data-table dq-table">
        <div className="tr th"><span>Лист</span><span>Файл</span><span>Правило</span><span>Проблема</span><span>Строка</span><span>Состояние</span></div>
        {loading ? <div className="tr"><span>…</span><span>Проверяем</span><span>—</span><span>Загружаем результат проверки</span><span>—</span><span><Status value="В работе"/></span></div> : displayedIssues.length ? displayedIssues.map((item, index) => <div className="tr" key={index}><span>{item.sheet}</span><span className="file-name">{item.file}</span><span><code>{item.field}</code></span><span>{item.issue}</span><span>{item.row}</span><span><Status value={item.state}/></span></div>) : <div className="tr"><span>—</span><span>{selectedBatchId ? 'Замечаний нет' : 'Выберите файл'}</span><span>—</span><span>{selectedBatchId ? 'Файл прошёл проверку' : 'Здесь появятся результаты проверки'}</span><span>—</span><span><Status value="В норме"/></span></div>}
      </div>
    </Card>
    </>}
  </>
}

function OnboardingJourney({ open, onClose, onOpenUpload, onOpenIntegrations }) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return <div className="onboarding-backdrop" role="presentation">
    <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <button className="onboarding-close" type="button" onClick={onClose} aria-label="Закрыть быстрый старт"><X/></button>
      <div className="onboarding-signal"><span><Zap/></span><i/><i/><i/></div>
      <div className="onboarding-heading">
        <small>ЭНЕРГОПУЛЬС · БЫСТРЫЙ СТАРТ</small>
        <h2 id="onboarding-title">Загрузка<br/><em>исходных данных</em></h2>
        <p>Поддерживаются технические балансы и ежедневные сводки в форматах .xlsx, .xls и .csv.</p>
      </div>
      <div className="onboarding-route">
        <article className="active">
          <span><FileSpreadsheet/></span>
          <small>01 · ЗАГРУЗКА</small>
          <b>Выберите файлы</b>
          <p>Один или несколько отчётных периодов.</p>
          <i>Около минуты</i>
        </article>
        <ArrowRight/>
        <article>
          <span><Database/></span>
          <small>02 · ПРОВЕРКА</small>
          <b>Проверка файлов</b>
          <p>Структура, формулы и исходные показания.</p>
          <i>Автоматически</i>
        </article>
        <ArrowRight/>
        <article className="optional">
          <span><Sparkles/></span>
          <small>03 · AI-РАЗБОР</small>
          <b>AI-анализ</b>
          <p>Дополнительный разбор загруженных данных.</p>
          <i>По желанию</i>
        </article>
      </div>
      <div className="onboarding-proof">
        <div><Check/><span><b>Расчёты без AI</b><small>Проверка файлов, энергобаланс и прогноз</small></span></div>
        <div><BrainCircuit/><span><b>Контекст AI</b><small>Загрузки, качество данных, энергобаланс и прогноз</small></span></div>
        <div><Lock/><span><b>Параметры ЭнергоПульс AI</b><small>API-ключ, модель и системная инструкция</small></span></div>
      </div>
      <footer>
        <button className="onboarding-skip" type="button" onClick={onClose}>Открыть сводку</button>
        <button className="onboarding-integrate" type="button" onClick={onOpenIntegrations}><Settings2/> Подключить ЭнергоПульс AI</button>
        <button className="onboarding-start" type="button" onClick={onOpenUpload}><Upload/> Загрузить файлы <ArrowRight/></button>
      </footer>
    </section>
  </div>
}

function AISettingsPage({ onOpenChat, onRestartOnboarding }) {
  const [settingsState, setSettingsState] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const response = await apiFetch('/api/v1/ai/settings')
      if (!response.ok) throw new Error(await readApiError(response))
      setSettingsState(await parseJsonResponse(response))
    } catch (err) {
      setError(err.message || 'Не удалось загрузить настройки AI')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const updateField = (field, value) => {
    setSettingsState(current => ({ ...current, [field]: value }))
    setNotice('')
  }

  const saveSettings = async event => {
    event.preventDefault()
    if (!settingsState) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await apiFetch('/api/v1/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey.trim() || null,
          skill_prompt: settingsState.skill_prompt,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      setSettingsState(await parseJsonResponse(response))
      setApiKey('')
      setNotice('Настройки сохранены. Новый промпт применится к следующему ответу.')
    } catch (err) {
      setError(err.message || 'Не удалось сохранить настройки AI')
    } finally {
      setSaving(false)
    }
  }

  const clearKey = async () => {
    if (!settingsState || !window.confirm('Удалить сохранённый API-ключ ЭнергоПульс AI?')) return
    setSaving(true)
    try {
      const response = await apiFetch('/api/v1/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clear_api_key: true,
          skill_prompt: settingsState.skill_prompt,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      setSettingsState(await parseJsonResponse(response))
      setApiKey('')
      setNotice('Сохранённый ключ удалён.')
    } catch (err) {
      setError(err.message || 'Не удалось удалить ключ')
    } finally {
      setSaving(false)
    }
  }

  if (!settingsState) {
    return <Card className="ai-settings-loading">
      <BrainCircuit/><b>{error || 'Открываем настройки AI…'}</b>
      {error && <button onClick={load}>Повторить</button>}
    </Card>
  }

  return <div className="ai-settings-page">
    <section className="ai-settings-hero">
      <div>
        <span><BrainCircuit/></span>
        <div><small>ЭНЕРГОПУЛЬС AI</small><h2>Настройки подключения</h2><p>Ключ, модель и системная инструкция.</p></div>
      </div>
      <div className={`ai-key-state ${settingsState.has_api_key ? 'ready' : 'missing'}`}>
        <i/><span><small>ПОДКЛЮЧЕНИЕ</small><b>{settingsState.has_api_key ? 'AI подключён' : 'ЭнергоПульс AI не подключён'}</b></span>
      </div>
    </section>
    <button className="onboarding-restart" type="button" onClick={onRestartOnboarding}><Zap/> Показать быстрый старт</button>

    <form className="ai-settings-grid" onSubmit={saveSettings}>
      <Card className="ai-settings-card" title="Подключение ЭнергоПульс AI" subtitle="Ключ хранится на сервере и не передаётся обратно в браузер">
        <label className="ai-field">
          <span>API-ключ ЭнергоПульс AI</span>
          <div className="ai-secret-input">
            <KeyRound/>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              placeholder={settingsState.masked_api_key || 'sk-proj-…'}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey(value => !value)} aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}>
              {showKey ? <EyeOff/> : <Eye/>}
            </button>
          </div>
        </label>
        <p className="ai-field-note">{settingsState.has_api_key
          ? `Сейчас активен ${settingsState.masked_api_key}. Оставьте поле пустым, чтобы не менять ключ.`
          : 'Добавьте ключ проекта, чтобы получать AI-разбор после загрузки и задавать вопросы данным.'}</p>
        {settingsState.has_api_key && <button className="ai-text-danger" type="button" onClick={clearKey}>Удалить сохранённый ключ</button>}
      </Card>

      <Card className="ai-prompt-card" title="Системная инструкция" subtitle="Роль, ограничения и формат ответа">
        <textarea
          value={settingsState.skill_prompt}
          onChange={event => updateField('skill_prompt', event.target.value)}
          spellCheck="false"
        />
        <div className="ai-prompt-footer">
          <span>{settingsState.skill_prompt.length} символов · для AI-разбора и чата</span>
          <button type="button" onClick={() => updateField('skill_prompt', settingsState.skill_prompt.trim())}><RotateCcw/> Удалить пробелы</button>
        </div>
      </Card>

      <div className="ai-settings-actions">
        <div>
          {notice && <span className="ai-save-notice ok"><Check/> {notice}</span>}
          {error && <span className="ai-save-notice error"><AlertTriangle/> {error}</span>}
        </div>
        <button className="ai-test-button" type="button" onClick={onOpenChat}><MessageCircle/> Открыть чат</button>
        <button className="ai-save-button" type="submit" disabled={saving}><Save/> {saving ? 'Сохраняем…' : 'Сохранить настройки'}</button>
      </div>
    </form>
  </div>
}

function ChatMarkdown({ content }) {
  return <div className="chat-message chat-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
      }}
    >
      {String(content || '')}
    </ReactMarkdown>
  </div>
}

function AIChat({ forcedOpen, onOpenChange, onOpenSettings }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [context, setContext] = useState(null)
  const [settingsState, setSettingsState] = useState(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [booting, setBooting] = useState(false)
  const [error, setError] = useState('')
  const messagesRef = useRef(null)

  const isOpen = open || forcedOpen
  const setIsOpen = value => {
    setOpen(value)
    onOpenChange?.(value)
  }

  const loadWorkspace = async () => {
    setBooting(true)
    setError('')
    try {
      const [messagesResponse, contextResponse, settingsResponse] = await Promise.all([
        apiFetch('/api/v1/ai/messages?limit=30'),
        apiFetch('/api/v1/ai/context'),
        apiFetch('/api/v1/ai/settings'),
      ])
      if (!messagesResponse.ok) throw new Error(await readApiError(messagesResponse))
      if (!contextResponse.ok) throw new Error(await readApiError(contextResponse))
      if (!settingsResponse.ok) throw new Error(await readApiError(settingsResponse))
      const [nextMessages, nextContext, nextSettings] = await Promise.all([
        parseJsonResponse(messagesResponse),
        parseJsonResponse(contextResponse),
        parseJsonResponse(settingsResponse),
      ])
      setMessages(nextMessages)
      setContext(nextContext)
      setSettingsState(nextSettings)
    } catch (err) {
      setError(err.message || 'Не удалось загрузить AI-чат')
    } finally {
      setBooting(false)
    }
  }

  useEffect(() => {
    if (isOpen) loadWorkspace()
  }, [isOpen])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async (event, suggestedMessage) => {
    event?.preventDefault?.()
    const message = String(suggestedMessage || input).trim()
    if (!message || loading) return
    setInput('')
    setError('')
    setMessages(current => [...current, { id: `user-${Date.now()}`, role: 'user', content: message }])
    setLoading(true)
    try {
      const response = await apiFetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const payload = await parseJsonResponse(response)
      setMessages(current => [...current, payload.message])
    } catch (err) {
      setError(err.message || 'AI не смог ответить')
    } finally {
      setLoading(false)
    }
  }

  const clearHistory = async () => {
    if (!window.confirm('Очистить историю AI-чата? Загруженные файлы и AI-разборы останутся.')) return
    const response = await apiFetch('/api/v1/ai/messages', { method: 'DELETE' })
    if (response.ok) setMessages([])
  }

  const imports = context?.latest_imports || []
  const forecast = context?.energy_dashboard?.forecast || {}
  const suggestions = [
    'Что изменилось в последнем периоде?',
    'Какие данные нужно проверить?',
    'Что повлияет на следующий прогноз?',
  ]

  if (!isOpen) {
    return <button className="q-fab ai-fab" onClick={() => setIsOpen(true)} aria-label="Открыть AI-чат" title="Открыть AI-чат"><MessageCircle/><i><Sparkles/></i></button>
  }

  return <aside className="q-panel ai-chat-panel" aria-label="AI-аналитик">
    <header>
      <div><span><BrainCircuit/></span><div><b>ЭнергоПульс AI</b><small><i/> Готов к анализу</small></div></div>
      <div className="ai-chat-head-actions">
        <button onClick={clearHistory} title="Очистить историю"><Trash2/></button>
        <button onClick={() => setIsOpen(false)} title="Закрыть"><X/></button>
      </div>
    </header>
    <div className="ai-context-strip">
      <span><Database/><b>{imports.length}</b> файлов в контексте</span>
      <span><TrendingUp/><b>{fmtMonthYear(forecast.period) || '—'}</b> период прогноза</span>
      <span><Gauge/><b>{forecast.confidence != null ? `${Math.round(forecast.confidence * 100)}%` : '—'}</b> надёжность</span>
    </div>
    <div className="q-messages" ref={messagesRef}>
      {booting && <div className="ai-system-message"><BrainCircuit/><p>Собираю загрузки, энергобаланс и прогноз…</p></div>}
      {!booting && !messages.length && <div className="ai-system-message"><Sparkles/><p>
        Я вижу {imports.length ? `${imports.length} файлов` : 'ваши файлы'}, показатели качества и прогноз на {fmtMonthYear(forecast.period) || 'следующий период'}. Спросите об изменениях, рисках или следующем действии.
      </p></div>}
      {messages.map(message => <div key={message.id} className={message.role === 'user' ? 'user' : 'assistant'}>
        {message.role !== 'user' && <Bot/>}
        {message.role === 'user'
          ? <div className="chat-message user-message">{message.content}</div>
          : <ChatMarkdown content={message.content}/>}
      </div>)}
      {loading && <div className="assistant ai-thinking"><Bot/><div className="chat-message"><i/><i/><i/></div></div>}
      {error && <div className="ai-chat-error"><AlertTriangle/><p>{error}</p></div>}
      {!settingsState?.has_api_key && !booting && <div className="ai-chat-key-warning"><KeyRound/><span><b>Подключите ЭнергоПульс AI</b><small>Файлы и аналитика уже работают. Ключ нужен только для AI-разбора и чата.</small></span><button onClick={onOpenSettings}>Подключить</button></div>}
    </div>
    <div className="q-suggestions">
      {suggestions.map(item => <button key={item} onClick={event => sendMessage(event, item)} disabled={loading || !settingsState?.has_api_key}>{item}</button>)}
    </div>
    <form onSubmit={sendMessage}>
      <input value={input} onChange={event => setInput(event.target.value)} placeholder="Спросите о потреблении, качестве данных или прогнозе…" disabled={!settingsState?.has_api_key}/>
      <button type="submit" disabled={loading || !input.trim() || !settingsState?.has_api_key}><Send/></button>
    </form>
  </aside>
}

function Sidebar({ page, setPage, mobile, setMobile, backendState, onResetAllData, resetting, hasDailyData, hasConsumerData, analyticsBlocked }) {
  const backendLabel = backendState === 'pending'
    ? 'Синхронизация'
    : backendState === 'offline'
      ? 'Нет соединения'
      : 'Подключено'
  const isLocked = id =>
    !analyticsBlocked && (
    (id === 'peaks' && !hasDailyData)
    || (id === 'consumers' && !hasConsumerData)
    || (id === 'forecast' && !hasConsumerData)
    )
  const lockedTitle = id => {
    if (id === 'peaks') return 'Сначала загрузите ежедневную сводку'
    if (id === 'consumers') return 'Сначала загрузите ежедневную сводку или технический баланс'
    return 'Сначала выполните предыдущий шаг'
  }

  return <aside className={`sidebar ${mobile?'mobile-open':''}`}>
    <div className="logo"><div className="brand-mark"><Zap fill="currentColor"/></div><div><b>ЭнергоПульс</b><span>Казахойл Актобе</span></div><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div>
    <nav>{nav.map(group => <div className="nav-group" key={group.section}><small>{group.section}</small>{group.items.map(({id,label,icon:Icon}) => {
      const locked = isLocked(id)
      return <button key={id} className={page===id?'active':''} disabled={locked} title={locked ? lockedTitle(id) : label} onClick={()=>{setPage(id);setMobile(false)}}><Icon/><span>{label}</span>{locked && <Lock/>}</button>
    })}</div>)}</nav>
    <div className="sidebar-bottom"><div className={`aws-pill ${backendState}`}><span>AWS</span><div><b>QuickSight</b><small><i/> {backendLabel}</small></div></div><button className="sidebar-danger" onClick={onResetAllData} disabled={resetting}><AlertTriangle/> {resetting ? 'Удаляем…' : 'Очистить данные'}</button></div>
  </aside>
}

function AppShell({ dark, setDark }) {
  const [page, setPage] = useState('overview')
  const initialRouteHandled = useRef(false)
  const [mobile, setMobile] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => localStorage.getItem('energy-onboarding-v1') !== 'complete'
  )
  const [resetting, setResetting] = useState(false)
  const [uploadBlockedFiles, setUploadBlockedFiles] = useState([])
  const [deletingImportIds, setDeletingImportIds] = useState([])
  const importsState = useImportsState()
  const hasImports = importsState.imports.length > 0
  const hasEnergyBalanceData = importsState.imports.some(item =>
    item.dataset_kind === 'technical_balance'
    && item.accepted_rows > 0
    && ['ready_to_publish', 'published'].includes(item.status)
  )
  const hasDailyData = importsState.imports.some(item =>
    item.dataset_kind === 'daily_summary'
    && item.accepted_rows > 0
    && ['ready_to_publish', 'published'].includes(item.status)
  )
  const hasConsumerData = hasEnergyBalanceData || hasDailyData
  const criticalImportFiles = importsState.imports.filter(isCriticalImportIssue)
  const liveImportIds = new Set(importsState.imports.map(item => item.id))
  const activeUploadBlockedFiles = uploadBlockedFiles.filter(item => item.id && liveImportIds.has(item.id))
  const effectiveCriticalImportFiles = criticalImportFiles.length ? criticalImportFiles : activeUploadBlockedFiles
  const analyticsBlocked = effectiveCriticalImportFiles.length > 0
  const blockedAnalyticsPages = new Set([
    'consumption',
    'technicalBalance',
    'dailyConsumption',
    'peaks',
    'consumers',
    'forecast',
    'reconciliation',
  ])
  const consumersState = useConsumersState(hasConsumerData)
  const [consumerMappings, setConsumerMappings] = useConsumerMappings()
  const forecastReady = hasConsumerData && consumersState.consumers.length > 0 && consumersState.consumers.every(item => mappingForConsumer(consumerMappings, item))
  const backendState = importsState.loading ? 'pending' : importsState.error ? 'offline' : 'live'

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  }, [page])

  useEffect(() => {
    if (initialRouteHandled.current || importsState.loading) return
    initialRouteHandled.current = true
    if (hasEnergyBalanceData && !analyticsBlocked) {
      localStorage.setItem('energy-onboarding-v1', 'complete')
      setOnboardingOpen(false)
      setPage(current => current === 'overview' ? 'consumption' : current)
    }
  }, [importsState.loading, hasEnergyBalanceData, analyticsBlocked])

  const openResult = () => setPage('consumption')
  const openUploadPicker = () => {
    flushSync(() => setPage('quality'))
    document.querySelector('[data-upload-picker]')?.click()
  }
  const finishOnboarding = destination => {
    localStorage.setItem('energy-onboarding-v1', 'complete')
    setOnboardingOpen(false)
    if (destination) setPage(destination)
  }

  const resetAllData = async () => {
    if (resetting) return
    const confirmed = window.confirm('Удалить все загруженные файлы, результаты проверки и историю AI? Отменить это действие нельзя.')
    if (!confirmed) return

    setResetting(true)
    try {
      const response = await apiFetch('/api/v1/admin/reset', { method: 'POST' })
      if (!response.ok) {
        throw new Error(await readApiError(response))
      }
      await importsState.reload()
      setConsumerMappings({})
      setUploadBlockedFiles([])
      setPage('quality')
      window.alert('Все данные удалены. Можно начать с новой загрузки.')
    } catch (err) {
      window.alert(err?.message || 'Не удалось очистить данные')
    } finally {
      setResetting(false)
    }
  }
  const deleteInvalidImport = async item => {
    const batchId = Number(item?.batchId || item?.id || item)
    if (!batchId || deletingImportIds.includes(batchId)) return false
    const source = importsState.imports.find(candidate => candidate.id === batchId) || item
    const filename = source?.original_filename || source?.name || `загрузка №${batchId}`
    const confirmed = window.confirm(`Удалить файл «${filename}» и результаты его проверки? Отменить это действие нельзя.`)
    if (!confirmed) return false

    setDeletingImportIds(current => [...current, batchId])
    try {
      await deleteImportBatch(batchId)
      importsState.removeImport(batchId)
      setUploadBlockedFiles(current => current.filter(file => file.id !== batchId))
      const latestImports = await importsState.reload().catch(() => null)
      if (latestImports) {
        const latestBlockedIds = new Set(latestImports.filter(isCriticalImportIssue).map(file => file.id))
        setUploadBlockedFiles(current => current.filter(file => latestBlockedIds.has(file.id)))
      }
      return true
    } catch (err) {
      window.alert(err?.message || 'Не удалось удалить файл')
      return false
    } finally {
      setDeletingImportIds(current => current.filter(id => id !== batchId))
    }
  }
  const analyticsBlockScreen = <AnalyticsBlockedState
    files={effectiveCriticalImportFiles}
    onOpenQuality={() => setPage('quality')}
    onDeleteInvalid={deleteInvalidImport}
    deletingImportIds={deletingImportIds}
  />
  const maybeBlockAnalytics = (id, screen) => analyticsBlocked && blockedAnalyticsPages.has(id)
    ? analyticsBlockScreen
    : screen
  const screens = {
    overview: <Overview
      onOpenUpload={openUploadPicker}
      onOpenQuality={()=>setPage('quality')}
      onOpenResult={openResult}
      onOpenDaily={()=>setPage('peaks')}
      onOpenForecast={()=>setPage('forecast')}
      importsState={importsState}
    />,
    consumption: maybeBlockAnalytics('consumption', <EnergyBusinessDashboard hasImports={hasImports} onOpenQuality={()=>setPage('quality')}/>),
    technicalBalance: maybeBlockAnalytics('technicalBalance', <SourceDashboard kind="technical" hasImports={hasEnergyBalanceData} onOpenQuality={()=>setPage('quality')}/>),
    dailyConsumption: maybeBlockAnalytics('dailyConsumption', <SourceDashboard kind="daily" hasImports={hasDailyData} onOpenQuality={()=>setPage('quality')}/>),
    peaks: maybeBlockAnalytics('peaks', <PeaksAndAnomaliesPage hasImports={hasDailyData}/>),
    consumers: maybeBlockAnalytics('consumers', <ConsumersPage hasImports={hasConsumerData} consumersState={consumersState} mappings={consumerMappings} setMappings={setConsumerMappings}/>),
    forecast: maybeBlockAnalytics('forecast', <ForecastPage hasImports={hasConsumerData} consumersState={consumersState} mappings={consumerMappings} forecastReady={forecastReady} onOpenConsumers={()=>setPage('consumers')} onOpenUpload={openUploadPicker}/>),
    reconciliation: maybeBlockAnalytics('reconciliation', <ReconciliationPage importsState={importsState} onOpenQuality={()=>setPage('quality')}/>),
    quality: <Quality
      importsState={importsState}
      onUploadComplete={() => setPage('consumption')}
      onDeleteInvalidImport={deleteInvalidImport}
      deletingImportIds={deletingImportIds}
      onUploadSettled={({ rejectedBatches }) => {
        setUploadBlockedFiles(rejectedBatches || [])
        if (rejectedBatches?.length) {
          setPage(current => blockedAnalyticsPages.has(current) ? current : 'quality')
        }
      }}
      onOpenChat={() => setChatOpen(true)}
      onOpenIntegrations={() => setPage('aiSettings')}
    />,
    aiSettings: <AISettingsPage
      onOpenChat={() => setChatOpen(true)}
      onRestartOnboarding={() => setOnboardingOpen(true)}
    />,
  }
  const title = pageTitles[page]

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} mobile={mobile} setMobile={setMobile} backendState={backendState} onResetAllData={resetAllData} resetting={resetting} hasDailyData={hasDailyData} hasConsumerData={hasConsumerData} analyticsBlocked={analyticsBlocked}/>
    {mobile&&<div className="scrim" onClick={()=>setMobile(false)}/>}
    <div className="main">
      <header className="topbar"><button className="menu-btn" onClick={()=>setMobile(true)}><Menu/></button><div><h1>{title[0]}</h1><p>{title[1]}</p></div><div className="top-actions"><button className="theme-btn" onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button><button className="logout-btn"><LogOut/> <span>Выйти</span></button></div></header>
      <main className="content">{screens[page]}</main>
    </div>
    <AIChat
      forcedOpen={chatOpen}
      onOpenChange={setChatOpen}
      onOpenSettings={() => {
        setChatOpen(false)
        setPage('aiSettings')
      }}
    />
    <OnboardingJourney
      open={onboardingOpen}
      onClose={() => finishOnboarding()}
      onOpenUpload={() => finishOnboarding('quality')}
      onOpenIntegrations={() => finishOnboarding('aiSettings')}
    />
  </div>
}

function Root() {
  const [dark, setDark] = useState(()=>localStorage.getItem('energy-theme') !== 'light')
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
