import { test } from "node:test"
import assert from "node:assert/strict"
import { parseFiles, scoreAnswer, countGraphifyUse } from "./score.mjs"

const sym = { name: "f", def: "src/f.ts", nonTest: ["a.ts", "b.tsx"], test: ["f.test.ts"], mentions: ["a.ts", "b.tsx", "f.test.ts", "index.ts"] }

test("parses bullets, backticks, ./ and line numbers", () => {
  assert.deepEqual(parseFiles("x\n<files>\n- `./a.ts`\n2. b.tsx:12\nnot a file\n</files>"), ["a.ts", "b.tsx"])
})

test("no block means unparsed, not zero", () => {
  assert.equal(scoreAnswer("a.ts", sym).parsed, false)
})

test("splits non-test, test, re-export/mock mentions and wrong; ignores the definition file", () => {
  const s = scoreAnswer("<files>\na.ts\nsrc/f.ts\nf.test.ts\nindex.ts\nzzz.ts\n</files>", sym)
  assert.equal(s.nonTestFound, 1)
  assert.equal(s.testFound, 1)
  assert.equal(s.extraMentioning, 1)
  assert.equal(s.wrong, 1)
  assert.deepEqual(s.wrongFiles, ["zzz.ts"])
})

test("counts graphify CLI calls and graph reads, not other bash", () => {
  const ev = [{ type: "assistant", message: { content: [
    { type: "tool_use", name: "Bash", input: { command: "graphify query \"x\"" } },
    { type: "tool_use", name: "Bash", input: { command: "cd x && graphify explain f" } },
    { type: "tool_use", name: "Read", input: { file_path: "/r/graphify-out/GRAPH_REPORT.md" } },
    { type: "tool_use", name: "Bash", input: { command: "grep -r graphifyish ." } },
  ] } }]

  assert.equal(countGraphifyUse(ev), 3)
})

test("a caller of another same-named definition is wrong, not a fair extra", () => {
  const s = scoreAnswer("<files>\na.ts\nother.ts\n</files>", { ...sym, mentions: [...sym.mentions, "other.ts"], otherCallerFiles: ["other.ts"] })
  assert.equal(s.wrong, 1)
  assert.equal(s.extraMentioning, 0)
})
