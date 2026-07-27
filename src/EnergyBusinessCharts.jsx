import React from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line,
  LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip,
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
      <Legend iconType="circle" formatter={value => value}/>
      <Bar dataKey="own_kwh" name="КОА" stackId="balance" fill={palette.own} radius={[0, 0, 0, 0]}/>
      <Bar dataKey="external_kwh" name="Сторонние" stackId="balance" fill={palette.external} radius={[6, 6, 0, 0]}/>
    </BarChart>
  </ResponsiveContainer>
}

function DailyLoad({ data, peakDay }) {
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
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
      <YAxis tickFormatter={compact} axisLine={false} tickLine={false} width={50}/>
      <Tooltip content={<EnergyTooltip date/>}/>
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
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0)
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
      <Legend
        verticalAlign="bottom"
        iconType="circle"
        formatter={(value, entry) => `${value} · ${Math.round(Number(entry.payload.value || 0) / total * 100)}%`}
      />
    </PieChart>
  </ResponsiveContainer>
}

export default function EnergyBusinessCharts({ kind, data, peakDay }) {
  if (kind === 'monthly') return <MonthlyBalance data={data}/>
  if (kind === 'daily') return <DailyLoad data={data} peakDay={peakDay}/>
  if (kind === 'outgoing') return <Outgoing35kv data={data}/>
  if (kind === 'external') return <ExternalGroups data={data}/>
  return null
}
