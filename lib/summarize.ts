// Turns bench rows into the numbers the page shows: per arm totals with medians and ranges, and a
// per-question table. Pure functions so they can be tested without the run logs.

export type Arm = "plain" | "graphify"

export interface Row {
  symbol: string
  def?: string
  arm: Arm
  rep: number
  parsed: boolean
  nonTestFound: number
  nonTestTotal: number
  testFound: number
  testTotal: number
  wrong: number
  graphifyCalls: number
  toolCalls: number
  inputTokens: number | null
  costUsd: number | null
  wallMs: number
}

export interface ArmSummary {
  arm: Arm
  runs: number
  usedGraphify: number
  allNonTestFound: number
  nonTestFound: number
  nonTestTotal: number
  testFound: number
  testTotal: number
  wrong: number
  unparsed: number
  medianToolCalls: number
  rangeToolCalls: [number, number]
  medianInputTokens: number
  medianWallS: number
  costUsd: number
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function sum(values: number[]): number {
  let total = 0

  for (const v of values) total += v

  return total
}

export function summarizeArm(rows: Row[], arm: Arm): ArmSummary {
  const mine = rows.filter((r) => r.arm === arm)
  const tools = mine.map((r) => r.toolCalls)

  return {
    arm,
    runs: mine.length,
    usedGraphify: mine.filter((r) => r.graphifyCalls > 0).length,
    allNonTestFound: mine.filter((r) => r.parsed && r.nonTestFound === r.nonTestTotal).length,
    nonTestFound: sum(mine.map((r) => r.nonTestFound)),
    nonTestTotal: sum(mine.map((r) => r.nonTestTotal)),
    testFound: sum(mine.map((r) => r.testFound)),
    testTotal: sum(mine.map((r) => r.testTotal)),
    wrong: sum(mine.map((r) => r.wrong)),
    unparsed: mine.filter((r) => !r.parsed).length,
    medianToolCalls: median(tools),
    rangeToolCalls: [Math.min(...tools), Math.max(...tools)],
    medianInputTokens: median(mine.flatMap((r) => (r.inputTokens === null ? [] : [r.inputTokens]))),
    medianWallS: Math.round(median(mine.map((r) => r.wallMs)) / 1000),
    costUsd: Math.round(sum(mine.map((r) => r.costUsd ?? 0)) * 100) / 100,
  }
}

export interface QuestionRow {
  symbol: string
  def: string
  nonTestTotal: number
  testTotal: number
  // Per arm: non-test callers found in each rep, test callers found in each rep, graphify use per rep.
  arms: Record<Arm, { nonTest: number[]; test: number[]; used: number; medianToolCalls: number }>
}

export function perQuestion(rows: Row[]): QuestionRow[] {
  // Same-named functions in different files are different questions, so key on name + definition.
  const key = (r: Row) => `${r.symbol}::${r.def ?? ""}`
  const keys = [...new Set(rows.map(key))]

  return keys.map((k) => {
    const mine = rows.filter((r) => key(r) === k)
    const { symbol, def = "" } = mine[0]

    const arm = (a: Arm) => {
      const rs = mine.filter((r) => r.arm === a).toSorted((x, y) => x.rep - y.rep)

      return { nonTest: rs.map((r) => r.nonTestFound), test: rs.map((r) => r.testFound),
        used: rs.filter((r) => r.graphifyCalls > 0).length, medianToolCalls: median(rs.map((r) => r.toolCalls)) }
    }

    return { symbol, def, nonTestTotal: mine[0].nonTestTotal, testTotal: mine[0].testTotal, arms: { plain: arm("plain"), graphify: arm("graphify") } }
  })
}
