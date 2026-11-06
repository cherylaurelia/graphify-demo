import summary from "@/data/summary.json";

const REPO = "https://github.com/cherylaurelia/graphify-demo";
const BENCH = `${REPO}/tree/main/bench`;
const CALCOM_COMMIT = "2eb48ec";

// `graphify affected "getPiiFreeCredential()" --depth 2` on the same graph, checked against the truth file
// (bench/results/affected-getPiiFreeCredential.txt): every truth file is listed, plus files that only import a name in the chain.
const AFFECTED = { hit: 31, total: 31, extra: 55 };
const GAP_TEST = "https://github.com/Graphify-Labs/graphify/blob/v8/tests/test_js_module_level_anonymous_calls.py";

type Set = (typeof summary)[number];

type ArmRow = Set["arms"][number];

const k = (n: number) => `${Math.round(n / 1000)}K`;

function setByLabel(label: string): Set {
  const found = summary.find((s) => s.label === label);

  if (!found) throw new Error(`summary.json has no set ${label}`);

  return found;
}

function arm(set: Set, name: "plain" | "graphify"): ArmRow {
  const found = set.arms.find((a) => a.arm === name);

  if (!found) throw new Error(`set ${set.label} has no ${name} arm`);

  return found;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border border-dashed border-line bg-white/80 p-4">
      <div className="font-mono text-3xl text-ink">{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

function ArmTable({ set }: { set: Set }) {
  const rows = set.arms;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3">Claude Code</th>
            <th className="py-2 pr-3">used graphify</th>
            <th className="py-2 pr-3">runs with every caller</th>
            <th className="py-2 pr-3">callers found (3 runs summed)</th>
            <th className="py-2 pr-3">test callers (summed)</th>
            <th className="py-2 pr-3">files outside the set</th>
            <th className="py-2 pr-3">tool calls (median, range)</th>
            <th className="py-2 pr-3">input tokens (median)</th>
            <th className="py-2">time (median)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.arm} className="border-b border-line">
              <td className="py-2 pr-3 font-mono text-ink">{a.arm === "plain" ? "plain" : "+ graphify"}</td>
              <td className="py-2 pr-3">{a.arm === "plain" ? "n/a" : `${a.usedGraphify}/${a.runs}`}</td>
              <td className="py-2 pr-3">{a.allNonTestFound}/{a.runs}</td>
              <td className="py-2 pr-3">{a.nonTestFound}/{a.nonTestTotal}</td>
              <td className="py-2 pr-3">{a.testFound}/{a.testTotal}</td>
              <td className={`py-2 pr-3 ${a.wrong > 0 ? "text-miss" : ""}`}>{a.wrong}</td>
              <td className="py-2 pr-3">{a.medianToolCalls} ({a.rangeToolCalls[0]}–{a.rangeToolCalls[1]})</td>
              <td className="py-2 pr-3">{k(a.medianInputTokens)}</td>
              <td className="py-2">{a.medianWallS}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Each run as "non-test + test" found, so a test-only function doesn't read as 0 found.
function runs(q: Set["questions"][number], a: "plain" | "graphify") {
  return q.arms[a].nonTest.map((n, i) => (q.testTotal > 0 ? `${n}+${q.arms[a].test[i]}` : `${n}`)).join(" · ");
}

function QuestionTable({ set }: { set: Set }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3">function (definition)</th>
            <th className="py-2 pr-3">callers</th>
            <th className="py-2 pr-3">plain: found per run (+ test)</th>
            <th className="py-2 pr-3">+ graphify: found per run (+ test)</th>
            <th className="py-2">graphify used</th>
          </tr>
        </thead>
        <tbody>
          {set.questions.map((q) => (
            <tr key={q.symbol + q.def} className="border-b border-line align-top">
              <td className="py-2 pr-3">
                <code className="font-mono text-ink">{q.symbol}</code>
                {q.def ? <div className="font-mono text-xs text-muted">{q.def}</div> : null}
              </td>
              <td className="py-2 pr-3">{q.nonTestTotal} + {q.testTotal} test</td>
              <td className="py-2 pr-3 font-mono">{runs(q, "plain")}</td>
              <td className="py-2 pr-3 font-mono">{runs(q, "graphify")}</td>
              <td className="py-2">{q.arms.graphify.used}/{q.arms.graphify.nonTest.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const impact = setByLabel("calcom-impact");
  const amb = setByLabel("calcom-ambiguous");
  const uniq = setByLabel("calcom");
  const small = setByLabel("tokenboard");
  const all = [impact, amb, uniq, small];
  let used = 0;
  let graphRuns = 0;
  let graphNonTest = 0;
  let graphNonTestTotal = 0;
  let graphTest = 0;
  let graphTestTotal = 0;

  for (const s of all) {
    used += arm(s, "graphify").usedGraphify;
    graphRuns += arm(s, "graphify").runs;
  }

  for (const s of [amb, uniq]) {
    graphNonTest += s.graph.nonTest.found;
    graphNonTestTotal += s.graph.nonTest.total;
    graphTest += s.graph.test.found;
    graphTestTotal += s.graph.test.total;
  }

  const impPlain = arm(impact, "plain");
  const impGraph = arm(impact, "graphify");
  const missed = (a: ArmRow) => a.nonTestTotal - a.nonTestFound + (a.testTotal - a.testFound);
  const piiQ = impact.questions.find((q) => q.symbol === "getPiiFreeCredential");

  if (!piiQ) throw new Error("impact set has no getPiiFreeCredential row");
  const perRun = (q: typeof piiQ, a: "plain" | "graphify") => q.arms[a].nonTest.map((n, i) => n + q.arms[a].test[i]).join(", ");

  return (
    <main>
      <section className="hero-glow px-6 pb-16 pt-10">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between font-mono text-xs text-ink">
            <span>graphify × Claude Code · open bench</span>
            <a className="underline" href={REPO}>source + logs</a>
          </div>
          <h1 className="mt-14 text-center font-mono text-3xl leading-tight text-white sm:text-5xl">
            <span className="box-decoration-clone bg-ink px-3 py-1 leading-[1.6]">What breaks if I change this?</span>
            <br />
            <span className="box-decoration-clone bg-ink px-3 py-1 leading-[1.6]">graphify on cal.com, measured</span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-center text-lg text-ink">
            The question: in a 5,000-file monorepo, does Claude Code trace callers more reliably with graphify installed
            the documented way? {graphRuns * 2} real runs, scored by script against compiler-parsed ground truth.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-center text-lg text-ink">
            The graph was right: {graphNonTest} of {graphNonTestTotal} non-test callers. The agents using it were not
            better than grep: {missed(impGraph)} vs {missed(impPlain)} files missed of{" "}
            {impPlain.nonTestTotal + impPlain.testTotal} on impact questions, and 4–60% more input tokens on who-calls
            questions. Every graphify run asked <code className="font-mono">graphify query</code> once; the command
            that answers “what breaks” in one call, <code className="font-mono">graphify affected --depth 2</code>, was
            never used.
          </p>
          <div className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
            <Stat value={`${used}/${graphRuns}`} label="runs used graphify when installed: the hooks and CLAUDE.md rule that graphify install --project writes send the agent there first" />
            <Stat value={`${graphNonTest}/${graphNonTestTotal}`} label="non-test callers graph.json links on its own on cal.com, with 0 callers of a different same-named function" />
            <Stat value={`${AFFECTED.hit}/${AFFECTED.total}`} label={`files graphify affected --depth 2 returns on the worst impact question, where agents with graphify listed ${perRun(piiQ, "graphify")}`} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="font-mono text-2xl text-ink">Results</h2>
        <p className="mt-2 max-w-3xl text-body">
          Each run is one fresh <code className="font-mono">claude -p</code> session ({amb.model}, Claude Code{" "}
          {amb.claudeCode.replace(/ \(Claude Code\)$/, "")}) asking one question: either which files could break if
          the signature of <code className="font-mono">X</code> changes (callers and callers of callers), or which
          files call or use <code className="font-mono">X</code>. 3 runs per question per arm; per-question tables show
          every run, not averages. Input tokens: median {k(impGraph.medianInputTokens)} vs{" "}
          {k(impPlain.medianInputTokens)} on impact questions; on who-calls sets graphify cost more ({k(arm(amb, "graphify").medianInputTokens)} vs{" "}
          {k(arm(amb, "plain").medianInputTokens)}, {k(arm(uniq, "graphify").medianInputTokens)} vs {k(arm(uniq, "plain").medianInputTokens)},{" "}
          {k(arm(small, "graphify").medianInputTokens)} vs {k(arm(small, "plain").medianInputTokens)}).
        </p>
        {all.map((s) => (
          <div key={s.label} className="mt-10">
            <h3 className="font-mono text-lg text-ink">
              {s.title} <span className="text-sm text-muted">· {s.symbols} functions</span>
            </h3>
            <div className="mt-3">
              <ArmTable set={s} />
            </div>
            <details className="mt-3 border border-dashed border-line p-3">
              <summary className="cursor-pointer font-mono text-sm text-ink">Per question</summary>
              <div className="mt-3">
                <QuestionTable set={s} />
              </div>
            </details>
          </div>
        ))}
      </section>

      <section className="bg-mint px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-mono text-2xl text-ink">What graphify could act on</h2>
          <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-body">
            <li>
              Read straight from <code className="font-mono">graph.json</code> (no agent), graphify links{" "}
              {graphNonTest} of {graphNonTestTotal} non-test caller files on cal.com, and on the same-named
              functions it links {amb.graph.extra} callers of the other definition. The one miss is
              controlled-dialog/index.tsx, which defines its own <code className="font-mono">Dialog</code> and wraps the
              UI one. The single caller the graphify arm missed in one run (DisconnectIntegration.tsx, imported via{" "}
              <code className="font-mono">../dialog/Dialog</code>) came from the agent&apos;s own ripgrep pattern after
              one graphify query, not from the graph.
            </li>
            <li>
              Test files, a known gap measured on a real repo: the graph links only {graphTest} of {graphTestTotal}
              test-file callers with a calls edge.
              Example: <code className="font-mono">apps/web/pages/api/book/recurring-event.test.ts</code> imports and
              calls <code className="font-mono">expectSuccessfulCalendarEventCreationInCalendar</code> inside an{" "}
              <code className="font-mono">it</code> block; graph.json has the imports edge but no calls edge. This is the
              case <a className="underline" href={GAP_TEST}>tests/test_js_module_level_anonymous_calls.py</a> already
              names as a known remaining gap after{" "}
              <a className="underline" href="https://github.com/Graphify-Labs/graphify/issues/3124">#3124</a>: when a file
              both imports a function and calls it only inside an anonymous callback, the relation-blind (source, target)
              dedup keeps the imports edge and drops the calls edge. I found no open issue tracking it; a{" "}
              <a className="underline" href={`${REPO}/tree/main/bench/repro-3124`}>four-file repro</a> is in the repo. The #3124 repro
              plus a plain <code className="font-mono">describe/it</code> file still give no calls edge on 0.9.103.{" "}
              <code className="font-mono">graphify affected</code> still lists those files through the imports edge,
              but “who calls this?” from the graph misses them. Agents found every test caller here because they also
              grepped.
            </li>
            <li>
              Impact questions need two hops, and the agents took one with graphify. On{" "}
              <code className="font-mono">getPiiFreeCredential</code> all three graphify-arm runs made one call,{" "}
              <code className="font-mono">graphify query &quot;who calls getPiiFreeCredential&quot; | head -40</code>. Its
              output names the default-exported <code className="font-mono">EventManager</code> class but not
              EventManager&apos;s own callers (handleCancelBooking.ts and others), and the agents did the second hop with
              ripgrep, which missed them: {perRun(piiQ, "graphify")} of {piiQ.nonTestTotal + piiQ.testTotal} files.
              Plain runs listed {perRun(piiQ, "plain")}; runs 2 and 3 found EventManager&apos;s callers.{" "}
              <code className="font-mono">graphify affected &quot;getPiiFreeCredential()&quot; --depth 2</code> on the same
              graph lists all {AFFECTED.total} (plus {AFFECTED.extra} files that only import a name in the chain). The
              rule that <code className="font-mono">graphify install</code> writes names query, path and explain, not
              affected; adding “for what-breaks questions run <code className="font-mono">graphify affected X --depth
              2</code>” is the change I&apos;d try next. I did not test it. On the other 5 impact questions every
              graphify-arm run was complete; plain missed files in one run each on nameOfDay and loadTranslations.
              Files outside the two-level set: {impGraph.wrong} vs {impPlain.wrong} (9 of plain&apos;s 10 were level-3
              callers).
            </li>
            <li>
              Building cal.com&apos;s graph (5,035 TypeScript files, commit {CALCOM_COMMIT}) took 117 s on a laptop
              with no LLM calls: 38,039 nodes, 103,398 edges.
            </li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="font-mono text-2xl text-ink">Method and limits</h2>
        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-body">
          <li>
            Ground truth comes from the TypeScript parser (5.9): a file calls <code className="font-mono">X</code> if
            it imports that definition (relative paths, tsconfig paths, workspace packages, re-export chains) and
            calls it, renders it as JSX or passes it as a value. Named and default imports both count. The first
            version ignored default imports; the functions were picked with it, then every set&apos;s callers were
            recomputed with default imports and all saved answers rescored (getPiiFreeCredential&apos;s set grew from 16
            to 31 files).
          </li>
          <li>
            Functions are picked by rule, not by hand. Impact: random (seeded) unique-named exported functions with
            3–8 direct caller files whose two-level set adds 5+ files and holds 12–60 (36 qualified, 6 picked).
            Who-calls: random unique-named functions with 5+ callers, and every function whose name has 2–4 called
            definitions (only 6 passed, a small set).
          </li>
          <li>
            Re-exports and mocks that mention the name count as fair extras. “Outside the set” means a caller of a
            different same-named definition, or a file that mentions none of the names in the chain. On impact
            questions 9 of plain&apos;s 10 such files were level-3 callers (for example getBusyTimes.ts), and
            graphify&apos;s 2 were e2e specs that hit the controller over HTTP.
          </li>
          <li>
            Runs happened in /tmp with no parent CLAUDE.md or AGENTS.md (checked); cal.com&apos;s own agent rules load
            in both arms. One model, one machine, Claude Code headless. tokenboard is my own repo.
          </li>
          <li>
            This tests the open-source skill and CLI, not Graphify Cloud, and compares only with graphify&apos;s own
            code benchmark (Python, ERPNext, n=6).
          </li>
        </ul>
        <h2 className="mt-12 font-mono text-2xl text-ink">Run it on your repo</h2>
        <pre className="mt-4 overflow-x-auto bg-ink p-4 font-mono text-sm text-white">
{`uv tool install graphifyy
cd your-repo && graphify update . && graphify install --project --platform claude
git clone ${REPO} && cd graphify-demo/bench && npm i
node truth.js /path/to/your-repo 10 42 5 > results/truth-yours.json
node bench.mjs --truth results/truth-yours.json --plain /tmp/copy-without-graphify \\
  --graphify /path/to/your-repo --label yours`}
        </pre>
        <div className="mt-8 flex flex-wrap gap-3">
          <a className="bg-ink px-4 py-2 font-medium text-white" href={REPO}>Repo and sanitized logs</a>
          <a className="border border-dashed border-ink px-4 py-2 font-medium text-ink" href={BENCH}>Bench scripts</a>
          <a className="border border-dashed border-ink px-4 py-2 font-medium text-ink" href="https://github.com/Graphify-Labs/graphify">graphify on GitHub</a>
        </div>
      </section>

      <footer className="border-t border-line px-6 py-6 text-center text-sm text-muted">
        Unofficial demo by Cheryl Aurelia: not affiliated with Graphify Labs.
      </footer>
    </main>
  );
}
