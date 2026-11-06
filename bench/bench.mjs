#!/usr/bin/env node
// Does Claude Code find every caller of a function faster or more completely with graphify installed?
// Each run is one fresh `claude -p` session asking one who-calls question in one arm.
// Usage: node bench.mjs --truth results/truth-calcom.json --plain <dir> --graphify <dir>
//                       [--reps 3] [--jobs 4] [--model sonnet] [--only name,name] [--label calcom]
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { scoreAnswer, countGraphifyUse } from "./score.mjs"

const opts = { reps: "3", jobs: "4", model: "sonnet", label: "run" }
const argv = process.argv.slice(2)

for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, "")] = argv[i + 1]

for (const k of ["truth", "plain", "graphify"]) if (!opts[k]) throw new Error(`--${k} is required`)

// Claude Code reads CLAUDE.md, AGENTS.md and .claude/rules from parent folders, so one above the repo would leak in.
for (const arm of [opts.plain, opts.graphify]) {
  for (let dir = dirname(resolve(arm)); dir !== "/"; dir = dirname(dir)) {
    for (const file of ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", ".claude/rules"]) {
      if (existsSync(join(dir, file))) throw new Error(`${join(dir, file)} would be loaded into every run; move the repo`)
    }
  }
}

const truth = JSON.parse(readFileSync(opts.truth, "utf8"))

const gitGrep = (name) => {
  try { return execFileSync("git", ["grep", "-lw", name], { cwd: opts.plain, encoding: "utf8" }).split("\n").filter(Boolean) } catch { return [] }
}

const only = opts.only ? new Set(opts.only.split(",")) : null

const symbols = truth.symbols.filter((s) => !only || only.has(s.name)).map((s) => ({ ...s,
  // Impact questions also accept files that mention a level-1 function; who-calls questions use the name only.
  mentions: [...new Set((s.mentionNames ?? [s.name]).flatMap((name) => gitGrep(name)))] }))

const outDir = join("results", opts.label)

mkdirSync(join(outDir, "raw"), { recursive: true })

export const question = (s) => truth.rule === "impact-depth-2"
  ? `If I change the signature of the function \`${s.name}\` (defined in ${s.def}), which files could break? ` +
    "Count files that call it directly and files that call a function which calls it (two levels). " +
    "Include test files. Don't change any files. End your answer with every file path (relative to the repo root), " +
    "one per line, between a line <files> and a line </files>."
  : `Which files in this repository call or use the function \`${s.name}\` (defined in ${s.def})? ` +
  "Include test files. Don't change any files. End your answer with every file path (relative to the repo root), " +
  "one per line, between a line <files> and a line </files>."

const jobs = []

for (let rep = 1; rep <= Number(opts.reps); rep++) {
  for (const s of symbols) for (const arm of ["plain", "graphify"]) jobs.push({ s, arm, rep })
}

// Interleave arms and symbols so time-of-day or rate limits don't land on one arm.
jobs.sort((a, b) => (a.rep - b.rep) || (hash(a.s.name + a.arm + a.rep) - hash(b.s.name + b.arm + b.rep)))

function hash(text) { let h = 0;

 for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;

 return h }

function runOne({ s, arm, rep }) {
  // Same-named symbols get the definition's folder in the id so their logs don't overwrite each other.
  const id = `${s.name}${symbols.filter((x) => x.name === s.name).length > 1 ? "@" + s.def.split("/").slice(-2, -1)[0] : ""}.${arm}.${rep}`
  const rawPath = join(outDir, "raw", `${id}.jsonl`)

  const args = ["-p", question(s), "--setting-sources", "project", "--strict-mcp-config",
    "--output-format", "stream-json", "--verbose", "--max-turns", "30", "--permission-mode", "bypassPermissions",
    "--model", opts.model, "--no-session-persistence"]

  return new Promise((done) => {
    const started = Date.now()
    const child = spawn("claude", args, { cwd: arm === "plain" ? opts.plain : opts.graphify, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", () => {})
    const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60 * 1000)
    child.on("close", () => {
      clearTimeout(timer)
      writeFileSync(rawPath, out)
      const events = out.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
      // A session can emit a second result after a background task ends; score the answer that has the file list.
      const result = events.findLast((e) => e.type === "result" && /<files>/i.test(e.result ?? "")) ?? events.findLast((e) => e.type === "result")
      const score = scoreAnswer(result?.result ?? "", s)

      const row = { id, symbol: s.name, def: s.def, arm, rep, ...score, graphifyCalls: countGraphifyUse(events),
        toolCalls: events.flatMap((e) => e.type === "assistant" ? (e.message?.content ?? []) : []).filter((p) => p.type === "tool_use").length,
        turns: result?.num_turns ?? null, costUsd: result?.total_cost_usd ?? null,
        inputTokens: result?.usage ? (result.usage.input_tokens + (result.usage.cache_read_input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0)) : null,
        outputTokens: result?.usage?.output_tokens ?? null, wallMs: Date.now() - started, error: result ? result.subtype : "no result" }

      console.log(JSON.stringify(row))
      done(row)
    })
  })
}

const rows = []
let next = 0

await Promise.all(Array.from({ length: Number(opts.jobs) }, async () => {
  while (next < jobs.length) rows.push(await runOne(jobs[next++]))
}))

const claudeVersion = await new Promise((done) => { const c = spawn("claude", ["--version"]); let v = ""; c.stdout.on("data", (d) => { v += d }); c.on("close", () => done(v.trim())) })

writeFileSync(join(outDir, "rows.json"), JSON.stringify({ model: opts.model, claudeCode: claudeVersion, truth: opts.truth, at: new Date().toISOString(), rows }, null, 1))
