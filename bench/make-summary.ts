// Builds data/summary.json (what the page renders) from the bench results.
// Usage (from web/): node bench/make-summary.ts
import { readFileSync, writeFileSync } from "node:fs"
import { summarizeArm, perQuestion, type Row } from "../lib/summarize.ts"

interface GraphRecall { name: string; nonTest_recall: string; test_recall: string; extra: string[] }

const sets: { label: string; title: string; truth: string; graph: string | null; rows?: string[]; graphifyLabel?: string }[] = [
  { label: "calcom-impact", title: "cal.com, what breaks if I change X (two levels of callers)", truth: "truth-calcom-impact.json", graph: null },
  // Same questions and plain runs; the graphify arm ran against a copy whose installed rule adds one line pointing
  // what-breaks questions at `graphify affected X --depth 2` (bench/rule-line.md).
  { label: "calcom-impact-rule", title: "same impact questions, graphify rule plus one line about graphify affected", truth: "truth-calcom-impact.json", graph: null,
    rows: ["calcom-impact:plain", "calcom-impact-affected:graphify"], graphifyLabel: "+ graphify + rule line" },
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
  const source = (label: string) => JSON.parse(readFileSync(`bench/results/${label}/rows.json`, "utf8"))
  const data = source(set.rows ? set.rows[0].split(":")[0] : set.label)

  const rows: Row[] = set.rows
    ? set.rows.flatMap((spec) => { const [label, arm] = spec.split(":");

 return source(label).rows.filter((r: Row) => r.arm === arm) })
    : data.rows

  const graph: GraphRecall[] = set.graph === null ? [] : JSON.parse(readFileSync(`bench/results/${set.graph}`, "utf8"))

  return {
    label: set.label,
    title: set.title,
    graphifyLabel: set.graphifyLabel ?? "+ graphify",
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
