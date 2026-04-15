"use client";

import React, { useMemo } from 'react';
import { dummyFundData } from './data';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ReferenceLine,
} from 'recharts';

export default function FundResearchPage({ params }: { params: { symbol: string } }) {
  const data = dummyFundData;

  // Fake rolling return data for charting
  const rollingData = useMemo(() => Array.from({ length: 50 }).map((_, i) => ({
    date: `20${19 + Math.floor(i / 10)}`,
    fund: 15 + Math.sin(i / 3) * 15 + Math.random() * 5,
    benchmark: 10 + Math.sin(i / 3) * 10 + Math.random() * 3,
  })), []);

  // Fake drawdown data
  const drawdownData = useMemo(() => Array.from({ length: 20 }).map((_, i) => ({
    date: `Month ${i}`,
    fund: i < 10 ? -(i * 1.8) : -18 + ((i - 10) * 1.5),
    benchmark: i < 10 ? -(i * 2.1) : -21 + ((i - 10) * 1.8),
  })), []);

  return (
    <div className="min-h-screen bg-[#F5F7FA] p-6 text-slate-800 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="pb-4 border-b border-gray-200">
          <div className="text-sm font-medium text-slate-500 uppercase tracking-widest mb-1">Know Your Fund</div>
          <h1 className="text-4xl font-extrabold text-slate-900 mb-2">{data.meta.name}</h1>
          <div className="flex items-center text-sm font-medium text-slate-600 gap-3">
            <span className="text-blue-600">{data.meta.category}</span>
            <span className="text-gray-300">•</span>
            <span>AUM {data.meta.aum}</span>
            <span className="text-gray-300">•</span>
            <span>{data.meta.age}</span>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* LEFT COLUMN */}
          <div className="space-y-6 flex flex-col">
            
            {/* Point-to-point Returns */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-xl font-semibold text-[#2B73B3] mb-4">Point-to-point returns vs {data.meta.benchmark}</h2>
              <div className="h-64 mb-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.pointToPoint} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{fill: '#6B7280'}} />
                    <YAxis tickFormatter={(val) => `${val}%`} axisLine={false} tickLine={false} tick={{fill: '#6B7280'}} />
                    <RechartsTooltip cursor={{fill: 'transparent'}} formatter={(value: number | string | undefined) => [`${value ?? 0}%`, '']} />
                    <Legend iconType="square" align="left" verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                    <Bar dataKey="fund" name="Fund" fill="#2B73B3" radius={[4, 4, 0, 0]} barSize={32}>
                      {data.pointToPoint.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill="#2B73B3" />
                      ))}
                    </Bar>
                    <Bar dataKey="benchmark" name={data.meta.benchmark} fill="#BFC7D1" radius={[4, 4, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-gray-500">As of {data.meta.asOfDate}. CAGR returns. Benchmark: {data.meta.benchmark} - TRI.</p>
            </div>

            {/* Rolling Returns */}
            <div className="bg-[#F0F4F8] rounded-xl shadow-sm border border-blue-100 p-6">
              <h2 className="text-xl font-semibold text-[#2B73B3] mb-2">Rolling returns vs {data.meta.benchmark}</h2>
              <p className="text-sm text-slate-600 mb-4 tracking-tight">
                Fund&apos;s 3 and 5-year returns, calculated daily over 7 years. A better test of consistency than point-to-point returns.
              </p>
              
              <div className="flex items-center gap-4 mb-2">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#2B73B3] rounded-sm"></div><span className="text-sm font-medium">Fund</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#BFC7D1] rounded-sm"></div><span className="text-sm font-medium text-slate-500">{data.meta.benchmark}</span></div>
              </div>

              {/* 3-Year */}
              <div className="mb-4">
                <div className="font-semibold text-slate-800 text-sm mb-1 bg-white inline-block px-3 py-1 rounded shadow-sm border border-gray-100">
                  3-year rolling <span className="text-blue-600">({data.rollingReturnSummary.threeYearFund}%</span> vs <span className="text-gray-500">{data.rollingReturnSummary.threeYearBenchmark}%)</span>
                </div>
                <div className="h-32 mt-2">
                   <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rollingData}>
                      <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                      <Line type="monotone" dataKey="fund" stroke="#2B73B3" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="benchmark" stroke="#BFC7D1" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full bg-white p-2 rounded border border-gray-200 mt-2 text-center text-sm font-semibold text-slate-800">
                  Beat benchmark {data.rollingReturnSummary.threeYearBeatPct}% of the time ({data.rollingReturnSummary.threeYearBeatRatio})
                </div>
              </div>

            </div>

             {/* Rank By Year Table */}
             <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-[#2B73B3] mb-4">Rank within category by year</h2>
              <div className="flex justify-between items-center text-center">
                {data.rankByYear.map((item, i) => (
                  <div key={i} className="flex flex-col border border-gray-100 rounded flex-1 mx-1 overflow-hidden">
                    <div className="bg-gray-50 py-2 border-b border-gray-100 text-sm font-semibold text-gray-500">{item.year}</div>
                    <div className="py-2 flex flex-col items-center">
                      <div className="font-bold text-lg"><span className={parseInt(item.rank) <= item.total/4 ? 'text-blue-600' : (parseInt(item.rank) > item.total/2 ? 'text-orange-500': 'text-slate-800')}>{item.rank}</span><span className="text-gray-400 text-sm font-normal">/{item.total}</span></div>
                      <div className={`text-xs ${item.percentile > 0 ? 'text-blue-600' : 'text-orange-500'}`}>{item.percentile}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-6 flex flex-col">
            
            {/* Risk Adjusted Ratios */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-xl font-semibold text-[#2B73B3] mb-4">Risk-adjusted ratios (Fund vs Category)</h2>
              <div className="grid grid-cols-2 gap-4 auto-rows-fr">
                
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <div className="text-sm font-semibold text-slate-700">Standard deviation</div>
                  <div className="text-2xl font-bold my-1 text-blue-600">{data.riskRatios.stdDev.fund} <span className="text-sm font-normal text-slate-500 line-through decoration-transparent">vs {data.riskRatios.stdDev.cat}</span></div>
                  <p className="text-xs text-slate-500 leading-tight">How much returns swing up and down. Lower means more stable.</p>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <div className="text-sm font-semibold text-slate-700">Sharpe ratio</div>
                  <div className="text-2xl font-bold my-1 text-blue-600">{data.riskRatios.sharpe.fund} <span className="text-sm font-normal text-slate-500">vs {data.riskRatios.sharpe.cat}</span></div>
                  <p className="text-xs text-slate-500 leading-tight">Return per unit of total risk. Higher means better risk-adjusted returns.</p>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <div className="text-sm font-semibold text-slate-700">Sortino ratio</div>
                  <div className="text-2xl font-bold my-1 text-blue-600">{data.riskRatios.sortino.fund} <span className="text-sm font-normal text-slate-500">vs {data.riskRatios.sortino.cat}</span></div>
                  <p className="text-xs text-slate-500 leading-tight">Return per unit of downside risk. Higher means less pain in bad periods.</p>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <div className="text-sm font-semibold text-slate-700">Information ratio</div>
                  <div className="text-2xl font-bold my-1 text-blue-600">{data.riskRatios.infoRatio.fund} <span className="text-sm font-normal text-slate-500">vs {data.riskRatios.infoRatio.cat}</span></div>
                  <p className="text-xs text-slate-500 leading-tight">Consistency of beating benchmark. Higher is better.</p>
                </div>

                <div className="bg-orange-50 rounded-lg p-4 border border-orange-100 shadow-sm relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-1 h-full bg-orange-400"></div>
                   <div className="text-sm font-semibold text-slate-700">Upside capture</div>
                  <div className="text-2xl font-bold my-1 text-orange-500">{data.riskRatios.upside.fund}% <span className="text-sm font-normal text-slate-500">vs {data.riskRatios.upside.cat}%</span></div>
                  <p className="text-xs text-slate-500 leading-tight">% of market gains captured when markets rise. Higher is better.</p>
                </div>
                
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                  <div className="text-sm font-semibold text-slate-700">Downside capture</div>
                  <div className="text-2xl font-bold my-1 text-blue-600">{data.riskRatios.downside.fund}% <span className="text-sm font-normal text-slate-500">vs {data.riskRatios.downside.cat}%</span></div>
                  <p className="text-xs text-slate-500 leading-tight">% of market losses absorbed when markets fall. Lower is better.</p>
                </div>

              </div>
              <div className="mt-4 text-xs font-medium text-slate-500">All ratios over 3 years. Blue = better. Orange = less favorable.</div>
            </div>

            {/* Split Row: Drawdown and Expense Ratio */}
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-[#F4F7F9] rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[#2B73B3] mb-1">Max drawdown</h2>
                  <div className="text-4xl font-extrabold text-orange-500 mb-1">{data.drawdown.fundMax}%</div>
                  <div className="text-sm text-slate-600 font-medium mb-4">{data.drawdown.period}</div>
                </div>
                <div className="h-20 mb-3">
                   <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={drawdownData}>
                      <YAxis hide domain={['dataMin - 2', 0]} />
                      <ReferenceLine y={0} stroke="#D1D5DB" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="fund" stroke="#2B73B3" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-sm font-semibold text-slate-700 border-t border-gray-200 pt-3">
                  Category: <span className="font-bold text-slate-900">{data.drawdown.catMax}%</span>
                </div>
                <p className="text-xs text-slate-500 mt-2 leading-tight">Peak-to-trough fall. Lower = better. Based on NAV data of last 5 years.</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col">
                <h2 className="text-lg font-semibold text-[#2B73B3] mb-4">Expense ratio</h2>
                <div className="flex items-center justify-between font-semibold border-b border-gray-100 pb-3 mb-4">
                  <div className="text-2xl text-blue-600">{data.expenseActive.expenseFund}% <span className="text-sm text-slate-500 font-normal">Fund</span></div>
                  <div className="text-lg text-slate-700">{data.expenseActive.expenseCat}% <span className="text-sm text-slate-500 font-normal">Cat</span></div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 mt-auto">
                    <div className="flex justify-between items-end mb-2">
                      <div className="font-semibold text-slate-800">Active share</div>
                      <div className="text-3xl font-bold text-[#2B73B3]">{data.expenseActive.activeShare}%</div>
                    </div>
                    <p className="text-xs text-slate-500 leading-tight">
                      Above 60% suggests the fund is taking active calls rather than closely mirroring the benchmark.
                    </p>
                </div>
              </div>
            </div>

            {/* Asset Allocation */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
               <h2 className="text-xl font-semibold text-[#2B73B3] mb-4">Market cap allocation</h2>
               <div className="flex items-center">
                  <div className="w-1/3 h-32 relative">
                     <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data.marketCap}
                            cx="50%"
                            cy="50%"
                            innerRadius={30}
                            outerRadius={50}
                            stroke="none"
                            paddingAngle={2}
                            dataKey="value"
                            isAnimationActive={false}
                          >
                            {data.marketCap.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                     </ResponsiveContainer>
                     <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full bg-white shadow-inner"></div>
                     </div>
                  </div>
                  <div className="w-2/3 pl-6">
                    <table className="w-full text-sm">
                      <tbody>
                        {data.marketCap.map((cap, i) => (
                          <tr key={i} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 flex items-center gap-2">
                              <span className="w-3 h-3 rounded-sm block" style={{backgroundColor: cap.color}}></span>
                              <span className="font-medium text-slate-700">{cap.name}</span>
                            </td>
                            <td className="py-2 text-right font-bold text-slate-900">{cap.value}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
               </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
