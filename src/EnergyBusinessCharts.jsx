import React from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  LineChart, Pie, PieChart, ReferenceDot, ReferenceLine, ReferenceArea, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'

const palette = {
  own: '#0d7a5d',
  external: '#a6d653',
  line: '#008b68',
  peak: '#d94f5c',
  actual: '#244f68',
  temperatureActual: '#d8891f',
  temperatureForecast: '#7651bd',
  lowerBound: '#c09324',
  bars: ['#0d7a5d', '#35a482', '#78bf79', '#a6d653', '#d7df70', '#e8b85c'],
}

const fmt = value => new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
}).format(Number(value || 0))

const compact = value => new Intl.NumberFormat('ru-RU', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(Number(value || 0))

const shortDate = value => new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
}).format(new Date(`${value}T00:00:00`))

function EnergyTooltip({ active, payload, label, date = false }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload || {}
  return <div className="energy-tooltip">
    <b>{date ? shortDate(label) : label}</b>
    {payload.filter(item => item.dataKey !== 'weatherMarkerY').map(item => <span key={item.dataKey} style={{ '--series-color': item.color }}>
      <i/> {item.name}: <strong>{fmt(item.value)} кВт·ч</strong>
    </span>)}
    {date && point.temperature != null && <div className="energy-tooltip-weather">
      <b>{weatherSymbol(point.weather_code)} {Number(point.temperature).toFixed(1)} °C</b>
      <span>{Number(point.precipitation || 0).toFixed(1)} мм · ветер {Number(point.wind_speed || 0).toFixed(0)} км/ч</span>
      {point.weather_anomaly && <strong>{point.weather_anomaly_label}</strong>}
      <small>Погода {signedCompact(point.weather_delta_kwh)} кВт·ч · события {signedCompact(point.event_delta_kwh)} кВт·ч</small>
    </div>}
  </div>
}

const weatherSymbol = code => {
  const value = Number(code)
  if (value >= 95) return '⚡'
  if (value >= 71) return '❄'
  if (value >= 51) return '☂'
  if (value >= 2) return '☁'
  return '☀'
}

const signedCompact = value => `${Number(value || 0) >= 0 ? '+' : '−'}${compact(Math.abs(Number(value || 0)))}`

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload || {}
  return <div className="energy-tooltip forecast-tooltip">
    <b>{shortDate(label)} · {point.phase === 'actual' ? 'факт' : 'прогноз'}</b>
    {point.actual != null && <span style={{ '--series-color': palette.actual }}>
      <i/> Факт по техбалансу: <strong>{fmt(point.actual)} кВт·ч</strong>
    </span>}
    {point.actual_metered != null && <small>Контрольные вводы: {fmt(point.actual_metered)} кВт·ч</small>}
    {point.value != null && <span style={{ '--series-color': palette.line }}>
      <i/> Прогноз нагрузки: <strong>{fmt(point.value)} кВт·ч</strong>
    </span>}
    {point.lower != null && <small>Коридор: {fmt(point.lower)}–{fmt(point.upper)} кВт·ч</small>}
    {point.temperature != null && <div className="energy-tooltip-weather">
      <b>{weatherSymbol(point.weather_code)} {Number(point.temperature).toFixed(1)} °C</b>
      <span>{Number(point.precipitation || 0).toFixed(1)} мм · ветер {Number(point.wind_speed || 0).toFixed(0)} км/ч</span>
      <small>{point.phase === 'actual' ? 'Историческая погода' : 'Прогноз погоды'} · {point.weather_source}</small>
      {point.weather_anomaly && <strong>{point.weather_anomaly_label}</strong>}
      {point.phase === 'forecast' && <small>Погода {signedCompact(point.weather_delta_kwh)} кВт·ч · события {signedCompact(point.event_delta_kwh)} кВт·ч</small>}
    </div>}
  </div>
}

function MonthlyBalance({ data }) {
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
      <CartesianGrid stroke="var(--grid)" vertical={false}/>
      <XAxis dataKey="label" axisLine={false} tickLine={false}/>
      <YAxis tickFormatter={compact} axisLine={false} tickLine={false} width={50}/>
      <Tooltip content={<EnergyTooltip/>}/>
      <Bar dataKey="own_kwh" name="КОА" stackId="balance" fill={palette.own} radius={[0, 0, 0, 0]}/>
      <Bar dataKey="external_kwh" name="Внешние" stackId="balance" fill={palette.external} radius={[6, 6, 0, 0]}/>
    </BarChart>
  </ResponsiveContainer>
}

function DailyLoad({ data, peakDay, controlLimit }) {
  const maxValue = data.reduce((max, item) => Math.max(max, Number(item.value || 0)), 0)
  const yMax = maxValue > 0 ? maxValue * 1.5 : 'auto'

  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 10, right: 24, bottom: 0, left: 18 }}>
      <defs>
        <linearGradient id="dailyEnergyFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.line} stopOpacity=".28"/>
          <stop offset="100%" stopColor={palette.line} stopOpacity=".02"/>
        </linearGradient>
      </defs>
      <CartesianGrid stroke="var(--grid)" vertical={false}/>
      <XAxis
        dataKey="date"
        tickFormatter={shortDate}
        axisLine={false}
        tickLine={false}
        minTickGap={28}
      />
      <YAxis domain={[0, yMax]} tickFormatter={compact} axisLine={false} tickLine={false} width={50}/>
      <Tooltip content={<EnergyTooltip date/>}/>
      {controlLimit && <ReferenceArea
        y1={controlLimit}
        y2={Math.max(controlLimit, peakDay?.value || controlLimit)}
        fill={palette.peak}
        fillOpacity={0.06}
      />}
      {controlLimit && <ReferenceLine
        y={controlLimit}
        stroke={palette.peak}
        strokeDasharray="6 4"
        label={{ value: 'Контрольный уровень', position: 'insideTopLeft', fill: palette.peak, fontSize: 10 }}
      />}
      {peakDay?.date && <ReferenceLine
        x={peakDay.date}
        stroke={palette.peak}
        strokeDasharray="4 4"
        label={{ value: 'Пик', position: 'insideTopRight', fill: palette.peak, fontSize: 10 }}
      />}
      <Area
        type="monotone"
        dataKey="value"
        name="Контролируемый вход"
        stroke={palette.line}
        strokeWidth={2.2}
        fill="url(#dailyEnergyFill)"
        dot={false}
        activeDot={{ r: 4, fill: palette.line, stroke: '#fff', strokeWidth: 2 }}
      />
    </AreaChart>
  </ResponsiveContainer>
}

function Outgoing35kv({ data }) {
  return <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
      <CartesianGrid stroke="var(--grid)" horizontal={false}/>
      <XAxis type="number" tickFormatter={compact} axisLine={false} tickLine={false}/>
      <YAxis
        type="category"
        dataKey="name"
        width={118}
        tickFormatter={name => name.replace(/^ВЛ 35 кВ\s*/i, '')}
        axisLine={false}
        tickLine={false}
        tick={{ fontSize: 10 }}
      />
      <Tooltip formatter={value => [`${fmt(value)} кВт·ч`, 'Расход']} cursor={{ fill: 'var(--surface-2)' }}/>
      <Bar dataKey="value" fill={palette.own} radius={[0, 6, 6, 0]}>
        {data.map((_, index) => <Cell key={index} fill={palette.bars[index % palette.bars.length]}/>)}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
}

function ExternalGroups({ data }) {
  return <ResponsiveContainer width="100%" height="100%">
    <PieChart>
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="44%"
        innerRadius="53%"
        outerRadius="78%"
        paddingAngle={2}
        stroke="none"
      >
        {data.map((_, index) => <Cell key={index} fill={palette.bars[index % palette.bars.length]}/>)}
      </Pie>
      <Tooltip formatter={value => [`${fmt(value)} кВт·ч`, 'Потребление']}/>
    </PieChart>
  </ResponsiveContainer>
}

function ForecastLoad({ data }) {
  const maxValue = data.reduce(
    (max, item) => Math.max(max, Number(item.actual || 0), Number(item.upper || item.value || 0)),
    0,
  )
  const chartData = data.map(item => ({ ...item, weatherMarkerY: maxValue * 1.12 }))
  const yMax = maxValue > 0 ? maxValue * 1.28 : 'auto'
  const forecastStart = chartData.find(item => item.phase === 'forecast')?.date
  const weatherMarkers = chartData.filter(
    (item, index) => item.weather_code != null && (item.weather_anomaly || index % 3 === 0),
  )

  return <ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={chartData} margin={{ top: 12, right: 20, bottom: 0, left: 12 }}>
      <defs>
        <linearGradient id="actualEnergyFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.actual} stopOpacity=".24"/>
          <stop offset="100%" stopColor={palette.actual} stopOpacity=".025"/>
        </linearGradient>
        <linearGradient id="forecastEnergyFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.line} stopOpacity=".25"/>
          <stop offset="100%" stopColor={palette.line} stopOpacity=".03"/>
        </linearGradient>
      </defs>
      <CartesianGrid stroke="var(--grid)" vertical={false}/>
      <XAxis
        dataKey="date"
        tickFormatter={shortDate}
        axisLine={false}
        tickLine={false}
        minTickGap={26}
      />
      <YAxis yAxisId="energy" domain={[0, yMax]} tickFormatter={compact} axisLine={false} tickLine={false} width={50}/>
      <YAxis
        yAxisId="temperature"
        orientation="right"
        domain={['dataMin - 4', 'dataMax + 4']}
        tickFormatter={value => `${Math.round(value)}°`}
        axisLine={false}
        tickLine={false}
        width={34}
      />
      <Tooltip content={<ForecastTooltip/>}/>
      {forecastStart && <ReferenceLine
        yAxisId="energy"
        x={forecastStart}
        stroke="#75938b"
        strokeDasharray="3 4"
        label={{ value: 'ПРОГНОЗ', position: 'insideTopRight', fill: '#75938b', fontSize: 8 }}
      />}
      {chartData.filter(item => item.weather_anomaly).map(item => (
        <ReferenceLine
          key={`weather-${item.date}`}
          yAxisId="energy"
          x={item.date}
          stroke="#e45b62"
          strokeWidth={12}
          strokeOpacity=".1"
          ifOverflow="extendDomain"
        />
      ))}
      {weatherMarkers.map(item => (
        <ReferenceDot
          key={`weather-icon-${item.date}`}
          yAxisId="energy"
          x={item.date}
          y={item.weatherMarkerY}
          r={item.weather_anomaly ? 9 : 7}
          fill={item.weather_anomaly ? '#fff0f0' : (item.phase === 'actual' ? '#edf5f8' : '#eff8f4')}
          stroke={item.weather_anomaly ? palette.peak : (item.phase === 'actual' ? palette.temperatureActual : palette.temperatureForecast)}
          strokeWidth={item.weather_anomaly ? 2 : 1}
          ifOverflow="visible"
          label={{
            value: weatherSymbol(item.weather_code),
            position: 'center',
            fontSize: 10,
          }}
        />
      ))}
      <Area
        yAxisId="energy"
        type="monotone"
        dataKey="actual"
        name="Факт прошлого месяца"
        stroke={palette.actual}
        strokeWidth={2.2}
        fill="url(#actualEnergyFill)"
        dot={false}
        activeDot={{ r: 4, fill: palette.actual, stroke: '#fff', strokeWidth: 2 }}
        connectNulls={false}
      />
      <Area
        yAxisId="energy"
        type="monotone"
        dataKey="value"
        name="Базовый прогноз"
        stroke={palette.line}
        strokeWidth={2.3}
        fill="url(#forecastEnergyFill)"
        dot={false}
        activeDot={{ r: 4, fill: palette.line, stroke: '#fff', strokeWidth: 2 }}
      />
      <Line
        yAxisId="energy"
        type="monotone"
        dataKey="upper"
        name="Верхняя граница"
        stroke={palette.peak}
        strokeWidth={1.4}
        strokeDasharray="5 5"
        dot={false}
      />
      <Line
        yAxisId="energy"
        type="monotone"
        dataKey="lower"
        name="Нижняя граница"
        stroke={palette.lowerBound}
        strokeWidth={1.4}
        strokeDasharray="5 5"
        dot={false}
      />
      <Line
        yAxisId="temperature"
        type="monotone"
        dataKey="temperature_actual"
        name="Температура · факт"
        stroke={palette.temperatureActual}
        strokeWidth={2.2}
        dot={false}
        connectNulls={false}
      />
      <Line
        yAxisId="temperature"
        type="monotone"
        dataKey="temperature_forecast"
        name="Температура · прогноз"
        stroke={palette.temperatureForecast}
        strokeWidth={2.2}
        strokeDasharray="6 4"
        dot={false}
        connectNulls={false}
      />
    </ComposedChart>
  </ResponsiveContainer>
}

export default function EnergyBusinessCharts({ kind, data, peakDay, controlLimit }) {
  if (kind === 'monthly') return <MonthlyBalance data={data}/>
  if (kind === 'daily') return <DailyLoad data={data} peakDay={peakDay} controlLimit={controlLimit}/>
  if (kind === 'outgoing') return <Outgoing35kv data={data}/>
  if (kind === 'external') return <ExternalGroups data={data}/>
  if (kind === 'forecast') return <ForecastLoad data={data}/>
  return null
}
