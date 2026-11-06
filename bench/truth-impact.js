// Ground truth for "what could break if I change X?": files with a top-level function that calls X
// (level 1) or calls a level-1 function (level 2), plus files whose module-level code calls X.
// Calls are resolved through real imports (resolve.js), so a same-named function elsewhere never counts.
// Targets: exported functions with a unique name, 3-8 direct caller files, a level-2 closure that adds
// at least 5 files, 12-60 files in total, and no unresolvable import of X or any level-1 function.
// Usage: node truth-impact.js <repo> <n> <seed>
//   or: node truth-impact.js <repo> --fixed <truth.json>  (recompute the closure for already-benched targets)
const path = require("path")
const makeResolver = require("./resolve.js")

const [repo, nStr, seedStr] = process.argv.slice(2)
const fixed = nStr === "--fixed" ? JSON.parse(require("fs").readFileSync(seedStr, "utf8")) : null
const N = Number(nStr), SEED = Number(seedStr)
const { ts, files, isTest, parse, resolveSpec, defKey } = makeResolver(repo)

// Top-level function-like declarations of a file: name -> AST node.
function topLevelFunctions(info) {
  const out = new Map()

  for (const st of info.sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.set(st.name.text, st)

    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) out.set(d.name.text, d.initializer)
    }
  }

  return out
}

function calledIdentifiers(node) {
  const seen = new Set()

  const visit = (n) => {
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && ts.isIdentifier(n.expression)) seen.add(n.expression.text)
    else if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName)) seen.add(n.tagName.text)

    if (ts.isCallExpression(n)) for (const a of n.arguments) if (ts.isIdentifier(a)) seen.add(a.text)
    ts.forEachChild(n, visit)
  }

  visit(node)

  return seen
}

const callersOf = new Map() // "defFile::name" -> Set("file::fn" | "file::<module>")
const unresolved = new Set() // names with an import we could not resolve
const defCount = new Map()
const exportedFn = new Map() // name -> def file, for exported function-like top-level declarations

for (const f of files) {
  let info

  try { info = parse(f) } catch { continue }

  for (const [name, d] of info.defs) {
    defCount.set(name, (defCount.get(name) || 0) + 1)

    if (d.exported && d.fn && !isTest(f)) exportedFn.set(name, f)
  }
}

for (const f of files) {
  const info = parse(f)
  const local = new Map() // local identifier -> "defFile::name"

  for (const name of info.defs.keys()) local.set(name, `${f}::${name}`)

  for (const imp of info.imports) {
    const t = resolveSpec(imp.spec, f)

    if (t === null) continue
    const d = t === "UNRESOLVED" ? "UNRESOLVED" : defKey(t, imp.orig)

    if (d === "UNRESOLVED") { unresolved.add(imp.orig === "default" ? imp.local : imp.orig); continue }

    if (d) local.set(imp.local, d)
  }

  const fns = topLevelFunctions(info)

  const add = (callee, caller) => {
    if (!callersOf.has(callee)) callersOf.set(callee, new Set())
    callersOf.get(callee).add(caller)
  }

  const inFunctions = new Set()

  for (const [fn, node] of fns) {
    for (const id of calledIdentifiers(node)) if (local.has(id) && id !== fn) { add(local.get(id), `${f}::${fn}`); inFunctions.add(id) }
  }

  for (const id of calledIdentifiers(info.sf)) if (local.has(id) && !inFunctions.has(id)) add(local.get(id), `${f}::<module>`)
}

const fileOf = (node) => node.slice(0, node.lastIndexOf("::"))
const nameOf = (node) => node.slice(node.lastIndexOf("::") + 2)

const cands = []

const targets = fixed ? fixed.symbols.map((x) => [x.name, x.def]) : [...exportedFn]

for (const [name, def] of targets) {
  if (!fixed && (defCount.get(name) !== 1 || name.length < 6 || unresolved.has(name))) continue
  const level1 = [...(callersOf.get(`${def}::${name}`) || [])]
  const level1Files = new Set(level1.flatMap((n) => (fileOf(n) === def ? [] : [fileOf(n)])))

  if (!fixed && (level1Files.size < 3 || level1Files.size > 8)) continue
  const level1Names = [...new Set(level1.flatMap((n) => (nameOf(n) === "<module>" ? [] : [nameOf(n)])))]

  if (!fixed && level1Names.some((n) => unresolved.has(n))) continue
  const level2Files = new Set()
  const level2Nodes = new Set()

  for (const node of level1) {
    if (nameOf(node) === "<module>") continue

    for (const c of callersOf.get(node) || []) if (fileOf(c) !== def) { level2Files.add(fileOf(c)); level2Nodes.add(c) }
  }

  const all = new Set([...level1Files, ...level2Files])
  const added = [...level2Files].filter((f) => !level1Files.has(f)).length

  if (!fixed && (added < 5 || all.size < 12 || all.size > 60)) continue
  // Level-3 files are only reported, not scored: they explain answers that went one level further than asked.
  const level3Files = new Set()

  for (const node of level2Nodes) {
    if (nameOf(node) === "<module>") continue

    for (const c of callersOf.get(node) || []) if (!all.has(fileOf(c)) && fileOf(c) !== def) level3Files.add(fileOf(c))
  }

  cands.push({ name, def, unresolvedImports: unresolved.has(name) || level1Names.some((n) => unresolved.has(n)), level1Files: [...level1Files].sort(), level1Names: level1Names.sort(), callers: [...all].sort(), level3Files: [...level3Files].sort() })
}

if (fixed) {
  console.log(JSON.stringify({ ...fixed, resolver: "named + default imports",
    symbols: cands.map((c) => ({ ...c, mentionNames: [c.name, ...c.level1Names], nonTest: c.callers.filter((f) => !isTest(f)), test: c.callers.filter(isTest) })) }, null, 1))
  process.exit(0)
}

cands.sort((a, b) => a.name.localeCompare(b.name))

let s = SEED; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = []

while (pick.length < Math.min(N, cands.length)) {
  const c = cands[Math.floor(rnd() * cands.length)]

  if (!pick.includes(c)) pick.push(c)
}

console.log(JSON.stringify({ repo: path.basename(repo), rule: "impact-depth-2", candidates: cands.length, typescript: ts.version,
  symbols: pick.map((c) => ({ ...c, mentionNames: [c.name, ...c.level1Names], nonTest: c.callers.filter((f) => !isTest(f)), test: c.callers.filter(isTest) })) }, null, 1))
