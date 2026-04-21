export interface FundData {
  meta: {
    name: string;
    category: string;
    aum: string;
    age: string;
    asOfDate: string;
    benchmark: string;
  };
  pointToPoint: Array<{
    period: string;
    fund: number;
    benchmark: number;
  }>;
  rollingReturnSummary: {
    threeYearFund: number;
    threeYearBenchmark: number;
    threeYearBeatPct: number;
    threeYearBeatRatio: string;
    fiveYearFund: number;
    fiveYearBenchmark: number;
    fiveYearBeatPct: number;
    fiveYearBeatRatio: string;
  };
  rankByYear: Array<{
    year: string;
    rank: string;
    percentile: number;
    total: number;
  }>;
  riskRatios: {
    stdDev: { fund: number; cat: number };
    sharpe: { fund: number; cat: number };
    sortino: { fund: number; cat: number };
    infoRatio: { fund: number; cat: number };
    upside: { fund: number; cat: number };
    downside: { fund: number; cat: number };
  };
  drawdown: {
    fundMax: number;
    catMax: number;
    period: string;
  };
  expenseActive: {
    expenseFund: number;
    expenseCat: number;
    activeShare: number;
  };
  marketCap: Array<{
    name: string;
    value: number;
    color: string;
  }>;
}

export const dummyFundData: FundData = {
  meta: {
    name: "Parag Parikh Flexi Cap Fund",
    category: "Flexi Cap Fund",
    aum: "₹1,28,966 Cr",
    age: "12.9 yrs",
    asOfDate: "12-Apr-2026",
    benchmark: "NIFTY 500",
  },
  pointToPoint: [
    { period: "1Y", fund: 8.2, benchmark: 10.8 },
    { period: "3Y", fund: 18.6, benchmark: 15.8 },
    { period: "5Y", fund: 16.7, benchmark: 13.4 },
    { period: "7Y", fund: 19.6, benchmark: 13.9 },
  ],
  rollingReturnSummary: {
    threeYearFund: 20.5,
    threeYearBenchmark: 15.3,
    threeYearBeatPct: 98,
    threeYearBeatRatio: "1687/1721",
    fiveYearFund: 19.5,
    fiveYearBenchmark: 14.5,
    fiveYearBeatPct: 100,
    fiveYearBeatRatio: "1721/1721",
  },
  rankByYear: [
    { year: "2021", rank: "3", total: 27, percentile: 47 },
    { year: "2022", rank: "30", total: 32, percentile: -6.3 },
    { year: "2023", rank: "4", total: 38, percentile: 37.6 },
    { year: "2024", rank: "12", total: 39, percentile: 24.8 },
    { year: "2025", rank: "10", total: 44, percentile: 8.6 },
  ],
  riskRatios: {
    stdDev: { fund: 2.63, cat: 3.97 },
    sharpe: { fund: 0.45, cat: 0.26 },
    sortino: { fund: 0.94, cat: 0.48 },
    infoRatio: { fund: 0.12, cat: 0.1 },
    upside: { fund: 82, cat: 105 },
    downside: { fund: 37, cat: 97 },
  },
  drawdown: {
    fundMax: -17.9,
    catMax: -20.5,
    period: "Oct 2021 - Jun 2022",
  },
  expenseActive: {
    expenseFund: 0.62,
    expenseCat: 0.74,
    activeShare: 71,
  },
  marketCap: [
    { name: "Large cap", value: 62.5, color: "#3B82F6" },
    { name: "Mid cap", value: 1.9, color: "#F59E0B" },
    { name: "Small cap", value: 2.7, color: "#EF4444" },
    { name: "International", value: 10.6, color: "#10B981" },
    { name: "Cash & others", value: 22.3, color: "#A855F7" },
  ],
};
