import { test } from "node:test"
import assert from "node:assert/strict"
import { median, summarizeArm, perQuestion, type Row } from "./summarize.ts"

const row = (over: Partial<Row>): Row => ({
  symbol: "f", arm: "plain", rep: 1, parsed: true, nonTestFound: 3, nonTestTotal: 3, testFound: 0, testTotal: 1,
  wrong: 0, graphifyCalls: 0, toolCalls: 2, inputTokens: 100, costUsd: 0.1, wallMs: 10_000, ...over,
})

test("median of odd, even and empty lists", () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), 0)
})

test("arm summary counts uptake, complete runs and ranges for one arm only", () => {
  const rows = [
    row({ arm: "graphify", graphifyCalls: 2, toolCalls: 5 }),
    row({ arm: "graphify", rep: 2, nonTestFound: 2, toolCalls: 1, inputTokens: null }),
    row({ arm: "plain", toolCalls: 40 }),
  ]

  const s = summarizeArm(rows, "graphify")
  assert.equal(s.runs, 2)
  assert.equal(s.usedGraphify, 1)
  assert.equal(s.allNonTestFound, 1)
  assert.equal(s.nonTestFound, 5)
  assert.equal(s.nonTestTotal, 6)
  assert.deepEqual(s.rangeToolCalls, [1, 5])
  assert.equal(s.medianInputTokens, 100)
})

test("an unparsed answer is not a complete run even if counts match", () => {
  const s = summarizeArm([row({ parsed: false, nonTestFound: 0, nonTestTotal: 0 })], "plain")
  assert.equal(s.allNonTestFound, 0)
  assert.equal(s.unparsed, 1)
})

test("per-question rows keep reps in order per arm", () => {
  const q = perQuestion([row({ rep: 2, nonTestFound: 1 }), row({ rep: 1, nonTestFound: 3 }), row({ arm: "graphify", graphifyCalls: 1 })])
  assert.deepEqual(q[0].arms.plain.nonTest, [3, 1])
  assert.equal(q[0].arms.graphify.used, 1)
})

test("same-named functions with different definitions stay separate questions", () => {
  const q = perQuestion([row({ def: "a/Dialog.tsx" }), row({ def: "b/Dialog.tsx" })])
  assert.equal(q.length, 2)
  assert.deepEqual(q.map((x) => x.def), ["a/Dialog.tsx", "b/Dialog.tsx"])
})
