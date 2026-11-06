#!/usr/bin/env node
// Re-score saved raw run logs against the current truth file (after a scoring rule changes),
// keeping each run's measured cost, tokens and timing. Usage: node rescore.mjs <label> <truth.json> <plain repo>
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { scoreAnswer, countGraphifyUse } from "./score.mjs"

const [label, truthPath, plainRepo] = process.argv.slice(2)
const truth = JSON.parse(readFileSync(truthPath, "utf8"))
const file = join("results", label, "rows.json")
const data = JSON.parse(readFileSync(file, "utf8"))
const mentions = new Map()

data.rows = data.rows.map((row) => {
  const symbol = truth.symbols.find((s) => s.name === row.symbol && (!row.def || s.def === row.def))

  const grep = (name) => { try { return execFileSync("git", ["grep", "-lw", name], { cwd: plainRepo, encoding: "utf8" }).split("\n").filter(Boolean) } catch { return [] } }

  if (!mentions.has(symbol.name)) mentions.set(symbol.name, [...new Set((symbol.mentionNames ?? [symbol.name]).flatMap(grep))])

  const events = readFileSync(join("results", label, "raw", `${row.id}.jsonl`), "utf8").split("\n").filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })

  // A session can emit a second result after a background task ends; score the answer that has the file list.
  const result = events.findLast((e) => e.type === "result" && /<files>/i.test(e.result ?? "")) ?? events.findLast((e) => e.type === "result")

  return { ...row, ...scoreAnswer(result?.result ?? "", { ...symbol, mentions: mentions.get(symbol.name) }), graphifyCalls: countGraphifyUse(events) }
})

writeFileSync(file, JSON.stringify(data, null, 1))

console.log(`rescored ${data.rows.length} rows in ${file}`)
