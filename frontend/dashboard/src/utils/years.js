// 数据从 2025 年开始；年份选项随当前年份自动扩展，避免跨年后只能选到旧年份。
export const FIRST_DATA_YEAR = 2025

export function getAvailableYears(now = new Date()) {
  const current = now.getFullYear()
  const years = []
  for (let y = FIRST_DATA_YEAR; y <= current; y++) years.push(y)
  return years
}
