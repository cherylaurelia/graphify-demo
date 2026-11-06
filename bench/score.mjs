// Scoring for one who-calls answer: the file list between <files> and </files>, compared with the
// script's ground truth, split into non-test and test callers. The definition file is ignored.

export function parseFiles(answer) {
  const m = answer.match(/<files>([\s\S]*?)<\/files>/i)

  if (!m) return null

  return [...new Set(m[1].split("\n")
    .map((l) => l.trim().replace(/^(?:[-*]|\d+[.)])\s*/, "").replace(/`/g, "").replace(/,$/, "").replace(/^\.\//, "").replace(/:\d+.*$/, "").trim())
    .filter((l) => /\.(tsx?|jsx?|mjs|cjs)$/.test(l)))]
}

export function scoreAnswer(answer, symbol) {
  const files = parseFiles(answer)

  if (!files) return { parsed: false, nonTestFound: 0, nonTestTotal: symbol.nonTest.length, testFound: 0, testTotal: symbol.test.length, wrong: 0 }
  const listed = new Set(files.filter((f) => f !== symbol.def))
  const nonTest = new Set(symbol.nonTest)
  const test = new Set(symbol.test)
  const mentions = new Set(symbol.mentions ?? [])
  // For a name defined in several places, a caller of another definition is wrong even though it mentions the name.
  const otherDef = new Set(symbol.otherCallerFiles ?? [])
  const wrongFiles = [...listed].filter((f) => !nonTest.has(f) && !test.has(f) && (otherDef.has(f) || !mentions.has(f)))

  return {
    parsed: true,
    nonTestFound: [...listed].filter((f) => nonTest.has(f)).length,
    nonTestTotal: nonTest.size,
    testFound: [...listed].filter((f) => test.has(f)).length,
    testTotal: test.size,
    // Re-exports and mocks are fair answers to "call or use"; only files that never mention the name are wrong.
    extraMentioning: [...listed].filter((f) => !nonTest.has(f) && !test.has(f) && mentions.has(f) && !otherDef.has(f)).length,
    wrong: wrongFiles.length,
    wrongFiles: wrongFiles.slice(0, 10),
  }
}

// A graphify use is a Bash call whose command runs the graphify CLI, or a Read of graphify-out/.
export function countGraphifyUse(events) {
  let n = 0

  for (const e of events) {
    if (e.type !== "assistant") continue

    for (const p of e.message?.content ?? []) {
      if (p.type !== "tool_use") continue
      const cmd = p.input?.command ?? ""

      if (p.name === "Bash" && /(^|[;&|]\s*)graphify\s/.test(cmd)) n++
      else if (/graphify-out\//.test(p.input?.file_path ?? p.input?.path ?? p.input?.pattern ?? "")) n++
    }
  }

  return n
}
