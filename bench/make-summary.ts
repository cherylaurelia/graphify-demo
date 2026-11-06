// Builds data/summary.json (what the page renders) from the bench results.
// Usage (from web/): node bench/make-summary.ts
import { readFileSync, writeFileSync } from "node:fs"
import { summarizeArm, perQuestion, type Row } from "../lib/summarize.ts"

interface GraphRecall { name: string; nonTest_recall: string; test_recall: string; extra: string[] }

const sets = [
  { label: "calcom-impact", title: "cal.com, what breaks if I change X (two levels of callers)", truth: "truth-calcom-impact.json", graph: null },
  { label: "calcom-ambiguous", title: "cal.com, same-named functions", truth: "truth-calcom-ambiguous.json", graph: "graphrecall-calcom-ambiguous.json" },
  { label: "calcom", title: "cal.com, uniquely named functions", truth: "truth-calcom.json", graph: "graphrecall-calcom.json" },
  { label: "tokenboard", title: "tokenboard (small control repo)", truth: "truth-tokenboard.json", graph: "graphrecall-tokenboard.json" },
]

const ratio = (items: string[]) => {
  let found = 0
  let total = 0

  for (const item of items) {
    const [f, t] = item.split("/").map(Number)
    found += f
    total += t
  }

  return { found, total }
}

const out = sets.map((set) => {
  const data = JSON.parse(readFileSync(`bench/results/${set.label}/rows.json`, "utf8"))
  const rows: Row[] = data.rows
  const graph: GraphRecall[] = set.graph === null ? [] : JSON.parse(readFileSync(`bench/results/${set.graph}`, "utf8"))

  return {
    label: set.label,
    title: set.title,
    model: data.model,
    claudeCode: data.claudeCode,
    at: data.at,
    symbols: JSON.parse(readFileSync(`bench/results/${set.truth}`, "utf8")).symbols.length,
    arms: [summarizeArm(rows, "plain"), summarizeArm(rows, "graphify")],
    questions: perQuestion(rows),
    graph: {
      nonTest: ratio(graph.map((g) => g.nonTest_recall)),
      test: ratio(graph.map((g) => g.test_recall)),
      extra: graph.reduce((n, g) => n + g.extra.length, 0),
    },
  }
})

writeFileSync("data/summary.json", JSON.stringify(out, null, 1))

console.log("wrote data/summary.json")
