import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertTriangle, ArrowRight, Bell, CalendarDays, Check, ChevronDown,
  Database, Download, Factory, FileCheck2, FileSpreadsheet, Filter, LayoutDashboard,
  LogOut, Menu, Moon, Search, Sun, Upload, X, Zap,
} from 'lucide-react'
import './styles.css'

const EnergyBusinessCharts = lazy(() => import('./EnergyBusinessCharts.jsx'))

const nav = [
  { section: 'ОБЗОР', items: [{ id: 'overview', label: 'Главная', icon: LayoutDashboard }] },
  { section: 'АНАЛИТИКА', items: [
    { id: 'consumption', label: 'Энергобаланс', icon: Zap },
    { id: 'peaks', label: 'Пики и лимиты', icon: Zap },
    { id: 'anomalies', label: 'Аномалии', icon: AlertTriangle },
    { id: 'forecast', label: 'Прогнозирование', icon: Zap },
  ]},
  { section: 'ДАННЫЕ', items: [
    { id: 'reconciliation', label: 'Месячная сверка', icon: FileCheck2 },
    { id: 'quality', label: 'Качество данных', icon: Database },
  ]},
]

const pageTitles = {
  overview: ['Главная', 'Здесь видно, готовы ли данные к работе и что делать дальше'],
  consumption: ['Энергобаланс', 'Потребление, структура нагрузки и сверка источников'],
  peaks: ['Пики и лимиты', 'Анализ станет доступен, когда будут готовы интервальные данные'],
  anomalies: ['Аномалии', 'Раздел покажет найденные отклонения после проверки данных'],
  forecast: ['Прогнозирование', 'Прогноз появится, когда накопится достаточная история'],
  reconciliation: ['Месячная сверка', 'Сверка станет доступна после подготовки итоговых данных'],
  quality: ['Качество данных', 'Загрузка файлов, проверка структуры и замечаний'],
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
    hostname.replace('-web.onrender.com', '-api.onrender.com'),
    hostname.replace('-frontend.onrender.com', '-api.onrender.com'),
  ])

  return Array.from(names).map(name => `${protocol}//${name}`)
}

function getApiCandidates() {
  const explicit = toBaseUrl(import.meta.env.PROD
    ? PROD_API_BASE
    : (import.meta.env?.VITE_API_BASE_URL || LOCAL_API_BASE))
  const candidates = [explicit, ...deriveRenderApiCandidates()]
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
  const cls = value === 'В норме' || value === 'Опубликован' ? 'ok' : value === 'Ошибка' || value === 'Открыта' ? 'bad' : 'work'
  return <span className={`status ${cls}`}>{value}</span>
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
  if (status === 'published') return 'Опубликован'
  if (status === 'ready_to_publish') return 'В работе'
  if (status === 'needs_review' || status === 'failed' || status === 'rejected') return 'Ошибка'
  return 'В работе'
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
  const totalErrors = imports.reduce((sum, item) => sum + item.error_count, 0)
  const lastBatch = imports[0]
  const hasImports = imports.length > 0
  const readyFiles = imports.filter(item => item.status === 'published' || item.status === 'ready_to_publish').length
  const needsAttention = imports.filter(item => item.error_count > 0 || ['needs_review', 'failed', 'rejected'].includes(item.status)).length
  const metric = value => error ? '—' : fmt(value)
  const metricNote = note => error ? 'нет подключения к API' : note
  const nextAction = error
    ? 'Повторите попытку через несколько секунд.'
    : hasImports
      ? 'Откройте энергобаланс: месячная структура, дневная нагрузка и сверка источников уже рассчитаны.'
      : 'После загрузки здесь появится краткая сводка.'
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

  return <>
    <div className="hero-row">
      <div><h2>Состояние данных</h2><p>На странице отображаются загруженные файлы, результаты проверки и следующий этап работы.</p></div>
      <FilterBar/>
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
        <small>СЕЙЧАС</small>
        <b>{error ? 'Состояние не получено' : lastBatch ? lastBatch.original_filename : 'Нет загруженных файлов'}</b>
        <p>{nextAction}</p>
        <div className="overview-hero-metrics">
          <span><strong>{metric(imports.length)}</strong> файлов</span>
          <span><strong>{metric(readyFiles)}</strong> готовы</span>
          <span><strong>{metric(needsAttention > 0 ? needsAttention : totalErrors)}</strong> на проверке</span>
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
            <p>Нулевые показатели скрыты до восстановления подключения к import backend.</p>
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
      <Card className="span-7" title="Порядок работы">
        <div className="journey-list wide">
          <div><b>1</b><div><strong>Загрузка файла</strong><p>Допускаются файлы форматов `.xlsx`, `.xls` и `.csv`.</p></div></div>
          <div><b>2</b><div><strong>Проверка и пересчёт</strong><p>Система проверит структуру и независимо пересчитает расход по показаниям.</p></div></div>
          <div><b>3</b><div><strong>Управленческий анализ</strong><p>Энергобаланс покажет структуру нагрузки, пики и расхождения источников.</p></div></div>
        </div>
      </Card>
      <Card className="span-5" title="Результаты загрузки">
        <div className="readiness-grid single-column">
          <ReadinessCard icon={FileCheck2} eyebrow="ПОСЛЕ ЗАГРУЗКИ" title="История загруженных файлов" text="На главной странице будут отображаться последние загрузки, статус готовности и общий объём данных." />
          <ReadinessCard icon={AlertTriangle} eyebrow="ПО РЕЗУЛЬТАТАМ ПРОВЕРКИ" title="Замечания по качеству" text="Будут отображаться строки и поля, требующие дополнительной проверки." tone="blue" />
        </div>
      </Card>
    </div>}
    {!error && hasImports && <div className="dashboard-grid">
      <Card className="span-7" title="Состояние данных">
        <div className="data-table overview-status-table">
          <div className="tr th"><span>Раздел</span><span>Состояние</span><span>Комментарий</span></div>
          <div className="tr"><span>Последние загрузки</span><span><Status value="В норме"/></span><span>{lastBatch ? `Последний файл: ${lastBatch.original_filename}` : 'Файлы пока не загружены'}</span></div>
          <div className="tr"><span>Проверка качества</span><span><Status value={totalErrors ? 'Открыта' : 'В норме'}/></span><span>{totalErrors ? `Найдено замечаний: ${fmt(totalErrors)}` : 'Критичных замечаний не найдено'}</span></div>
          <div className="tr"><span>Готовность данных</span><span><Status value={readyFiles ? 'В норме' : 'В работе'}/></span><span>{readyFiles ? `${fmt(readyFiles)} файл(ов) готовы к анализу` : 'Данные ещё проходят подготовку'}</span></div>
          <div className="tr"><span>Следующий этап</span><span><Status value={readyFiles ? 'В норме' : 'В работе'}/></span><span>{readyFiles ? 'Откройте энергобаланс и проверьте расхождения' : 'Дождитесь завершения обработки'}</span></div>
        </div>
      </Card>
      <Card className="span-5" title="Последние файлы">
        <div className="data-table overview-batches-table">
          <div className="tr th"><span>Файл</span><span>Статус</span><span>Строк</span></div>
          {imports.slice(0, 5).map(item => <div className="tr" key={item.id}><span>{item.original_filename}</span><span><Status value={mapBatchStatus(item.status)}/></span><span>{fmt(item.total_rows)}</span></div>)}
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
      <KpiCard icon={Database} label="Published batches" value={fmt(imports.filter(item => item.status === 'published').length)} unit="" note="реальные import batches" />
      <KpiCard icon={AlertTriangle} label="Предметные данные" value="0" unit="" note="ещё не рассчитаны" tone="yellow" />
      <KpiCard icon={FileCheck2} label="Static rows" value="0" unit="" note="не используются в UI" tone="blue" />
    </div>
    <Card title={title} subtitle="Честное пустое состояние без выдуманных dashboard rows">
      <EmptyState title="Предметные ряды ещё не готовы" text={text}/>
    </Card>
  </>
}

function EnergyBusinessDashboard({ hasImports, onOpenQuality }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(hasImports)
  const [error, setError] = useState('')

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
  const periodLabel = monthly.map(item => item.label).join('–')
  const attentionCount = Number(kpis.negative_intervals || 0) + Number(kpis.incomplete_intervals || 0)
  const topExternalTotal = topExternal.reduce((sum, item) => sum + Number(item.value || 0), 0)

  return <>
    <section className="energy-brief">
      <div className="energy-brief-copy">
        <span className="energy-kicker">ОПЕРАЦИОННЫЙ ЭНЕРГОБАЛАНС · {periodLabel} 2026</span>
        <h2>{insight}</h2>
        <p>Расход пересчитан по показаниям счётчиков. Финансовая оценка скрыта до утверждения границы тарификации.</p>
      </div>
      <div className="energy-brief-signal">
        <small>СИГНАЛ МЕСЯЦА</small>
        <strong className={Number(kpis.mom_change || 0) >= 0 ? 'up' : 'down'}>{signedPercent(kpis.mom_change)}</strong>
        <span>к предыдущему месяцу</span>
      </div>
    </section>

    <div className="energy-kpis">
      <article>
        <div><span className="energy-kpi-icon total"><Zap/></span><small>ОБЩИЙ ВХОД · {meta.latest_label}</small></div>
        <strong>{mln(kpis.total_kwh)}</strong>
        <span>млн кВт·ч</span>
        <p>Независимый пересчёт по исходным показаниям</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon own"><Factory/></span><small>СОБСТВЕННОЕ · КОА</small></div>
        <strong>{mln(kpis.own_kwh)}</strong>
        <span>млн кВт·ч · {percent(kpis.own_share)}</span>
        <p>Общий вход минус сторонние организации</p>
      </article>
      <article>
        <div><span className="energy-kpi-icon external"><Database/></span><small>СТОРОННИЕ</small></div>
        <strong>{mln(kpis.external_kwh)}</strong>
        <span>млн кВт·ч · {percent(kpis.external_share)}</span>
        <p>Контролируемая доля внешних потребителей</p>
      </article>
      <article className={attentionCount ? 'attention' : ''}>
        <div><span className="energy-kpi-icon quality"><AlertTriangle/></span><small>КАЧЕСТВО ПОКРЫТИЯ</small></div>
        <strong>{fmt(kpis.coverage_days)}</strong>
        <span>дней · {fmt(attentionCount)} {wordForm(attentionCount, 'отклонение', 'отклонения', 'отклонений')}</span>
        <p>Отрицательных: {fmt(kpis.negative_intervals)} · неполных: {fmt(kpis.incomplete_intervals)}</p>
      </article>
    </div>

    <div className="dashboard-grid energy-grid">
      <Card
        className="span-5 energy-chart-card"
        title="Из чего складывается общий вход"
        subtitle="КОА и сторонние организации · кВт·ч"
      >
        <div className="energy-chart monthly-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим энергобаланс…</div>}>
            <EnergyBusinessCharts kind="monthly" data={monthly}/>
          </Suspense>
        </div>
        <div className="energy-decision">
          <b>Что решаем</b>
          <span>Контролируем рост общего входа и долю сторонних потребителей.</span>
        </div>
      </Card>

      <Card
        className="span-7 energy-chart-card"
        title="Когда возникает нагрузка"
        subtitle={`${fmt(kpis.coverage_days)} дней · три сопоставимых ввода`}
        action={<div className="peak-chip"><span/> Пик {dateLabel(kpis.peak_day?.date)} · {fmt(kpis.peak_day?.value)} кВт·ч</div>}
      >
        <div className="energy-chart daily-chart">
          <Suspense fallback={<div className="result-chart-fallback">Строим дневной профиль…</div>}>
            <EnergyBusinessCharts kind="daily" data={daily} peakDay={kpis.peak_day}/>
          </Suspense>
        </div>
      </Card>

      <Card
        className="span-7 energy-chart-card"
        title={`Куда уходит энергия по линиям 35 кВ · ${meta.latest_label}`}
        subtitle="Сравнение направлений одного уровня напряжения без двойного счёта"
      >
        <div className="energy-chart outgoing-chart">
          <Suspense fallback={<div className="result-chart-fallback">Считаем направления…</div>}>
            <EnergyBusinessCharts kind="outgoing" data={outgoing}/>
          </Suspense>
        </div>
      </Card>

      <Card
        className="span-5 energy-chart-card"
        title={`Сторонние по площадкам · ${meta.latest_label}`}
        subtitle="Доля в объёме внешних потребителей"
      >
        <div className="energy-chart groups-chart">
          <Suspense fallback={<div className="result-chart-fallback">Группируем площадки…</div>}>
            <EnergyBusinessCharts kind="external" data={externalGroups}/>
          </Suspense>
        </div>
      </Card>

      <Card
        className="span-7"
        title="Крупнейшие сторонние потребители"
        subtitle="Конечные строки без промежуточных итогов"
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
        subtitle="Daily против техбаланса на общей границе трёх вводов"
      >
        <div className="energy-reconciliation">
          {reconciliation.map(item => {
            const isAlert = Math.abs(Number(item.difference_pct || 0)) > .03
            return <div key={item.period}>
              <span className={`recon-month ${isAlert ? 'alert' : ''}`}>{item.label}</span>
              <span><small>Daily</small><b>{mln(item.daily_kwh)} млн</b></span>
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
    <div className="dq-score"><div className="score-ring"><b>{score}</b><span>из 100</span></div><div><small>ОБЩАЯ ОЦЕНКА КАЧЕСТВА</small><h2>{imports.length ? 'Оценка построена по загруженным файлам' : 'Файлы ещё не загружены'}</h2><p>Проверено {fmt(totalRows)} строк из {imports.length} файлов</p></div><div className="dq-metrics"><span><b>{fmt(totalRows)}</b>Строк</span><span><b>{totalWarnings + totalErrors}</b>Замечаний</span><span><b>{successfulImports} / {imports.length}</b>Готово</span></div></div>
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
    ? 'Connecting'
    : backendState === 'offline'
      ? 'Unavailable'
      : 'Local environment'

  return <aside className={`sidebar ${mobile?'mobile-open':''}`}>
    <div className="logo"><div className="brand-mark"><Zap fill="currentColor"/></div><div><b>ЭнергоПульс</b><span>Казахойл Актобе</span></div><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div>
    <nav>{nav.map(group => <div className="nav-group" key={group.section}><small>{group.section}</small>{group.items.map(({id,label,icon:Icon}) => <button key={id} className={page===id?'active':''} onClick={()=>{setPage(id);setMobile(false)}}><Icon/><span>{label}</span></button>)}</div>)}</nav>
    <div className="sidebar-bottom"><div className={`aws-pill ${backendState}`}><span>API</span><div><b>Import backend</b><small><i/> {backendLabel}</small></div></div><button className="export primary" onClick={onResetAllData} disabled={resetting}><AlertTriangle/> {resetting ? 'Очистка…' : 'Очистить всё'}</button><button><LogOut/> Закрыть сессию</button></div>
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
    peaks: <PlaceholderPage title="Пики и лимиты" text="Пиковые нагрузки и лимиты нельзя показывать без реальных интервалов и правил агрегации, поэтому экран ожидает предметные данные." importsState={importsState}/>,
    anomalies: <PlaceholderPage title="Аномалии" text="Экран должен перейти на реальные validation/anomaly records после реализации semantic layer." importsState={importsState}/>,
    forecast: <PlaceholderPage title="Прогнозирование" text="Фиктивные прогнозные точки и доверительные интервалы удалены. Прогноз появится только после загрузки исторических рядов и backtest." importsState={importsState}/>,
    reconciliation: <PlaceholderPage title="Месячная сверка" text="Фиктивная сверка daily/monthly удалена. Реальная сверка должна строиться из daily_summary и technical_balance после предметного ETL." importsState={importsState}/>,
    quality: <Quality importsState={importsState} onUploadComplete={openResult}/>,
  }
  const title = pageTitles[page]

  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} mobile={mobile} setMobile={setMobile} backendState={backendState} onResetAllData={resetAllData} resetting={resetting}/>
    {mobile&&<div className="scrim" onClick={()=>setMobile(false)}/>}
    <div className="main">
      <header className="topbar"><button className="menu-btn" onClick={()=>setMobile(true)}><Menu/></button><div><h1>{title[0]}</h1><p>{title[1]}</p></div><div className="top-actions"><button className="search-btn"><Search/><span>Поиск</span><kbd>⌘ K</kbd></button><button className="search-btn" onClick={resetAllData} disabled={resetting}>{resetting ? 'Очистка…' : 'Сброс данных'}</button><button className="theme-btn" onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button><button className="bell"><Bell/><i/></button><div className="profile"><span>LO</span><div><b>Локальная сессия</b><small>frontend theme only</small></div><ChevronDown/></div></div></header>
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
