# graphify in Claude Code: who calls this function?

An open bench of real Claude Code runs on cal.com (5,035 TypeScript files, commit `2eb48ec`) and a small
control repo, with and without [graphify](https://github.com/Graphify-Labs/graphify) installed the
documented way (`graphify install --project --platform claude`). Each run asks one question,
"which files call or use `X` (defined in file F)?", and the answer is scored by script against ground truth
from the TypeScript parser.

Live page: see the repo description. Unofficial demo by Cheryl Aurelia: not affiliated with Graphify Labs.

## Results (162 runs, Sonnet, Claude Code 2.1.318, 3 runs per question per arm)

| set | arm | used graphify | files found (3 runs summed) | outside the set | median input tokens |
|---|---|---|---|---|---|
| cal.com, what breaks if X changes, two levels (6) | plain | n/a | 498/522 | 10 | 291K |
| | + graphify | 18/18 | 489/522 | 2 | 302K |
| cal.com, same-named functions (6) | plain | n/a | 372/372 | 1 | 226K |
| | + graphify | 18/18 | 371/372 | 0 | 234K |
| cal.com, unique names (10) | plain | n/a | 477/477 | 0 | 168K |
| | + graphify | 30/30 | 477/477 | 0 | 175K |
| tokenboard (5) | plain | n/a | 90/90 | 0 | 43K |
| | + graphify | 15/15 | 90/90 | 0 | 69K |

- Claude Code used graphify in 81 of 81 runs where it was installed.
- Every graphify-arm run started with one `graphify query`; none used `graphify affected`. On the worst impact
  question (getPiiFreeCredential) `graphify affected "getPiiFreeCredential()" --depth 2` on the same graph lists all
  31 truth files (plus 55 that only import a name in the chain; `bench/results/affected-getPiiFreeCredential.txt`),
  while agents with graphify listed 19–22. The rule `graphify install` writes names query/path/explain, not affected;
  pointing what-breaks questions at `graphify affected X --depth 2` is untested here.
- Impact questions: 5 of 6 came out the same in both arms. On getPiiFreeCredential (callers include the default-exported EventManager class) graphify-arm runs stopped at 19–22 of 31 files; plain runs found 16, 31 and 28. graph.json has those edges; the agent didn't follow them. Files outside the two-level set: 2 vs 10 (9 of plain's were level-3 callers).
- Read straight from `graph.json`, graphify links 282 of 283 non-test caller files on cal.com and none of the
  callers of a different same-named definition. Test-file callers: 3 of 13 have a calls edge. This is the known
  remaining gap documented in graphify's `tests/test_js_module_level_anonymous_calls.py` (#3124 follow-up): a file
  that imports a function and calls it only inside an anonymous callback keeps the imports edge, and the
  relation-blind dedup drops the calls edge. Still reproduces on 0.9.103; no open issue found.
- On who-calls questions, plain Claude Code with grep was already as accurate, and graphify added a few percent of tokens. The hardest question
  (packages/ui `Dialog`, 23 of the 78 files that call a `Dialog`) used fewer tokens with graphify:
  median 371K vs 496K, 31 s vs 43 s.

## How it works

- `bench/truth.js`: unique-name set. Exported functions with 5+ callers whose name is defined once, sampled
  with a fixed seed. A file calls `X` if it imports `X` (alias followed) and calls it, renders it as JSX or
  passes it as a value.
- Ground truth counts named and default imports. The functions were picked with a first version that ignored default
  imports; callers were then recomputed for the same functions (`--fixed`) and all saved answers rescored.
- `bench/truth-impact.js`: impact set. Files with a top-level function that calls X or calls a function that calls X (two levels), resolved through real imports; seeded pick of unique-named functions with 3–8 direct caller files and 12–60 files in the two-level set.
- `bench/resolve.js`: shared import resolver.
- `bench/truth-ambiguous.js`: names with 2–4 definitions that are each called. Imports are resolved
  through relative paths, tsconfig `paths`, workspace package names and re-export chains; a name with any
  unresolvable import is dropped instead of guessed.
- `bench/bench.mjs`: one fresh `claude -p --setting-sources project` session per question per arm, in a
  folder with no parent CLAUDE.md/AGENTS.md (checked by the script).
- `bench/score.mjs`: parses the `<files>` block. Re-exports and mocks that mention the name are fair
  extras; callers of another same-named definition, or files that never mention the name, are wrong.
- `bench/graphrecall.py`: the same truth checked against `graph.json` alone.
- `bench/results/`: truth files, rows, and sanitized run logs (model text, tool calls, graphify's own output
  and the final answer; local tool output and machine details removed by `bench/sanitize.mjs`).

## Run it on your repo

```bash
uv tool install graphifyy
cd your-repo && graphify update . && graphify install --project --platform claude
git clone https://github.com/cherylaurelia/graphify-demo && cd graphify-demo/bench && npm i
node truth.js /path/to/your-repo 10 42 5 > results/truth-yours.json
node bench.mjs --truth results/truth-yours.json --plain /tmp/copy-without-graphify \
  --graphify /path/to/your-repo --label yours
```

## Limits

One model, one machine, headless Claude Code. Small same-named set (only 6 functions passed the rule).
tokenboard is my own repo. This tests the open-source skill and CLI, not Graphify Cloud.

## Page

Next.js + Tailwind, rendered from `data/summary.json` (`node bench/make-summary.ts`). `npm test`, `npm run lint`.
