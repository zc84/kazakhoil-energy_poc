import React from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line,
  LineChart, Pie, PieChart, ReferenceLine, ReferenceArea, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'

const palette = {
  own: '#0d7a5d',
  external: '#a6d653',
  line: '#0e8064',
  peak: '#e45b62',
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
  return <div className="energy-tooltip">
    <b>{date ? shortDate(label) : label}</b>
    {payload.map(item => <span key={item.dataKey} style={{ '--series-color': item.color }}>
      <i/> {item.name}: <strong>{fmt(item.value)} кВт·ч</strong>
    </span>)}
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
  const maxValue = data.reduce((max, item) => Math.max(max, Number(item.upper || item.value || 0)), 0)
  const yMax = maxValue > 0 ? maxValue * 1.18 : 'auto'

  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 10, right: 24, bottom: 0, left: 18 }}>
      <defs>
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
      <YAxis domain={[0, yMax]} tickFormatter={compact} axisLine={false} tickLine={false} width={50}/>
      <Tooltip content={<EnergyTooltip date/>}/>
      <Area
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
        type="monotone"
        dataKey="upper"
        name="Верхняя граница"
        stroke={palette.peak}
        strokeWidth={1.4}
        strokeDasharray="5 5"
        dot={false}
      />
      <Line
        type="monotone"
        dataKey="lower"
        name="Нижняя граница"
        stroke="#35a482"
        strokeWidth={1.4}
        strokeDasharray="5 5"
        dot={false}
      />
    </AreaChart>
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
