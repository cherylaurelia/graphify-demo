// Ground truth for who-calls questions on names that are defined in 2-4 places, where `grep name`
// finds callers of every definition. A file counts as calling definition D only if it imports the
// name through a path that resolves to D: relative paths, the nearest tsconfig `paths`, workspace
// package names (package.json "name" -> folder), and re-export chains (`export { x } from`,
// `export * from`). Symbols with any import of the name that could not be resolved are dropped,
// so the truth never guesses. Usage: node truth-ambiguous.js <repo> <n> <seed> <minCallers>
//   or: node truth-ambiguous.js <repo> --fixed <truth.json>  (recompute callers for already-benched symbols)
const path = require("path")
const makeResolver = require("./resolve.js")

const [repo, nStr, seedStr, minStr] = process.argv.slice(2)
const fixed = nStr === "--fixed" ? JSON.parse(require("fs").readFileSync(seedStr, "utf8")) : null
const N = Number(nStr), SEED = Number(seedStr), MIN = Number(minStr || 4)
const { ts, files, isTest, parse, resolveSpec, defKey, usedLocals } = makeResolver(repo)
const defsByName = new Map()

for (const f of files) {
  let info

  try { info = parse(f) } catch { continue }

  for (const [name, d] of info.defs) if (fixed ? fixed.symbols.some((x) => x.name === name) : d.exported && d.fn && !isTest(f) && name.length >= 5) {
    if (!defsByName.has(name)) defsByName.set(name, [])
    defsByName.get(name).push(f)
  }
}

const names = fixed ? new Set(fixed.symbols.map((x) => x.name)) : new Set([...defsByName].flatMap(([n, ds]) => (ds.length >= 2 && ds.length <= 4 ? [n] : [])))

const callers = new Map() // defFile::name -> Set(file)
const unresolvedNames = new Set()

for (const f of files) {
  const info = parse(f)
  // Default imports can bind any local name, so every import is resolved and kept if it lands on a candidate.
  const relevant = info.imports.filter((i) => names.has(i.orig) || i.orig === "default")

  if (relevant.length === 0) continue
  const used = usedLocals(info)

  for (const imp of relevant) {
    const t = resolveSpec(imp.spec, f)

    if (t === null) continue
    const d = t === "UNRESOLVED" ? "UNRESOLVED" : defKey(t, imp.orig)
    const asName = imp.orig === "default" ? imp.local : imp.orig

    if (d === "UNRESOLVED" || d === null) { if (names.has(asName)) unresolvedNames.add(asName); continue }

    if (!names.has(d.slice(d.lastIndexOf("::") + 2)) || !used.has(imp.local)) continue
    const key = d

    if (!callers.has(key)) callers.set(key, new Set())
    callers.get(key).add(f)
  }
}

if (fixed) {
  const symbols = fixed.symbols.map(({ name, def }) => {
    const ds = defsByName.get(name) ?? []
    const mine = callers.get(`${def}::${name}`) ?? new Set()
    const other = [...new Set(ds.filter((x) => x !== def).flatMap((x) => [...(callers.get(`${x}::${name}`) ?? [])]))].filter((f) => !mine.has(f) && f !== def)
    const all = [...mine].filter((f) => f !== def).sort()

    return { name, def, otherDefs: ds.filter((x) => x !== def), callers: all, otherCallerFiles: other.sort(), unresolvedImports: unresolvedNames.has(name),
      nonTest: all.filter((f) => !isTest(f)), test: all.filter(isTest) }
  })

  console.log(JSON.stringify({ ...fixed, resolver: "named + default imports", symbols }, null, 1))
  process.exit(0)
}

const cands = []

for (const name of names) {
  if (unresolvedNames.has(name)) continue
  const ds = defsByName.get(name)
  const counts = ds.map((d) => (callers.get(d + "::" + name) || new Set()).size)

  // Ambiguity has to be real: at least two definitions are each called from somewhere.
  if (counts.filter((c) => c > 0).length < 2) continue
  ds.forEach((d, i) => {
    if (counts[i] >= MIN) cands.push({ name, def: d, otherDefs: ds.filter((x) => x !== d), callers: [...callers.get(d + "::" + name)].sort(),
      otherCallerFiles: [...new Set(ds.filter((x) => x !== d).flatMap((x) => [...(callers.get(x + "::" + name) || [])]))]
        .filter((f) => !callers.get(d + "::" + name).has(f)).sort() })
  })
}

cands.sort((a, b) => (a.name + a.def).localeCompare(b.name + b.def))

let s = SEED; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = []
const distinct = new Set(cands.map((c) => c.name)).size

if (cands.length <= N) pick.push(...cands)

while (pick.length < Math.min(N, distinct)) {
  const c = cands[Math.floor(rnd() * cands.length)]

  if (!pick.some((p) => p.name === c.name)) pick.push(c)
}

console.log(JSON.stringify({ repo: path.basename(repo), rule: "ambiguous", candidates: cands.length, droppedUnresolvedNames: unresolvedNames.size, typescript: ts.version,
  symbols: pick.map((c) => ({ ...c, nonTest: c.callers.filter((f) => !isTest(f)), test: c.callers.filter(isTest) })) }, null, 1))
