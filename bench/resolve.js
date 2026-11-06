// Shared import resolver for the ground-truth scripts: lists a repo's TS files, parses them with the
// TypeScript parser, and resolves imports (relative, tsconfig paths, workspace packages, re-exports).
const ts = require("typescript")
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

module.exports = function makeResolver(repo) {
const all = execSync("git ls-files", { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean)
const files = all.filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"))
const fileSet = new Set(files)
const allSet = new Set(all)
const isTest = (f) => /(\.test\.|\.spec\.|__tests__|\/test\/|\/tests\/|e2e|playwright|__checks__)/.test(f)
const readJson = (f) => { try { return ts.parseConfigFileTextToJson(f, fs.readFileSync(path.join(repo, f), "utf8")).config } catch { return null } }

const pkgs = []

for (const f of all.filter((x) => x.endsWith("package.json"))) {
  const j = readJson(f)

  if (j?.name) pkgs.push({ name: j.name, dir: path.dirname(f), main: j.main || j.types || null })
}

pkgs.sort((a, b) => b.name.length - a.name.length)

const tsconfigFor = new Map()

function nearestPaths(file) {
  let dir = path.dirname(file)

  for (;;) {
    if (tsconfigFor.has(dir)) return tsconfigFor.get(dir)
    const cfg = allSet.has(path.join(dir, "tsconfig.json")) ? readJson(path.join(dir, "tsconfig.json")) : null

    if (cfg?.compilerOptions?.paths) {
      const v = { base: path.join(dir, cfg.compilerOptions.baseUrl || "."), paths: cfg.compilerOptions.paths }
      tsconfigFor.set(path.dirname(file), v);

 return v
    }

    if (dir === "." || dir === "") return null
    dir = path.dirname(dir)
  }
}

function tryFile(p) {
  p = path.normalize(p).replace(/\.(js|jsx|mjs)$/, "")

  for (const c of [p, p + ".ts", p + ".tsx", p + "/index.ts", p + "/index.tsx", p + "/src/index.ts", p + "/src/index.tsx"]) if (fileSet.has(c)) return c

  return null
}

// Returns a repo file, null for an external package, or "UNRESOLVED" for an in-repo path we couldn't map.
function resolveSpec(spec, from) {
  if (spec.startsWith(".")) return tryFile(path.join(path.dirname(from), spec)) || "UNRESOLVED"
  const tp = nearestPaths(from)

  if (tp) for (const [pat, targets] of Object.entries(tp.paths)) {
    const prefix = pat.replace(/\*$/, "")

    if (pat.endsWith("*") ? spec.startsWith(prefix) : spec === pat) {
      const rest = spec.slice(prefix.length)

      for (const t of targets) {
        const target = t.replace(/\*$/, "") + (pat.endsWith("*") ? rest : "")

        if (target.startsWith("@")) return resolveSpec(target, from)
        const hit = tryFile(path.join(tp.base, target))

        if (hit) return hit
      }
    }
  }

  for (const p of pkgs) {
    if (spec === p.name) return (p.main && tryFile(path.join(p.dir, p.main))) || tryFile(p.dir) || "UNRESOLVED"

    if (spec.startsWith(p.name + "/")) return tryFile(path.join(p.dir, spec.slice(p.name.length + 1))) || tryFile(path.join(p.dir, "src", spec.slice(p.name.length + 1))) || "UNRESOLVED"
  }

  return spec.startsWith("@calcom/") ? "UNRESOLVED" : null
}

const parsed = new Map()

function parse(f) {
  if (parsed.has(f)) return parsed.get(f)
  const text = fs.readFileSync(path.join(repo, f), "utf8")
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  // defaultName: the local declaration `export default` points at; aliases: `export { a as b }` without a source.
  const info = { defs: new Map(), imports: [], reexports: [], star: [], aliases: new Map(), defaultName: null, sf }

  for (const st of sf.statements) {
    const exported = !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    const isDefault = !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)

    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && isDefault) {
      if (st.name) info.defaultName = st.name.text
      else info.defs.set("default", { exported: true, fn: ts.isFunctionDeclaration(st) })
    }

    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      if (ts.isIdentifier(st.expression)) info.defaultName = st.expression.text
      else info.defs.set("default", { exported: true, fn: ts.isArrowFunction(st.expression) || ts.isFunctionExpression(st.expression) })
    }

    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) if (el.propertyName) info.aliases.set(el.name.text, el.propertyName.text)
    }

    if (ts.isImportDeclaration(st) && st.importClause?.name && ts.isStringLiteral(st.moduleSpecifier)) {
      info.imports.push({ local: st.importClause.name.text, orig: "default", spec: st.moduleSpecifier.text })
    }

    if (ts.isFunctionDeclaration(st) && st.name) info.defs.set(st.name.text, { exported, fn: true })

    if (ts.isClassDeclaration(st) && st.name) info.defs.set(st.name.text, { exported, fn: false })

    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) {
      const fn = !!d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
      info.defs.set(d.name.text, { exported, fn })
    }

    if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings) && ts.isStringLiteral(st.moduleSpecifier)) {
      for (const el of st.importClause.namedBindings.elements) info.imports.push({ local: el.name.text, orig: (el.propertyName || el.name).text, spec: st.moduleSpecifier.text })
    }

    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      if (!st.exportClause) info.star.push(st.moduleSpecifier.text)
      else if (ts.isNamedExports(st.exportClause)) for (const el of st.exportClause.elements) info.reexports.push({ name: el.name.text, orig: (el.propertyName || el.name).text, spec: st.moduleSpecifier.text })
    }
  }

  parsed.set(f, info)

  return info
}

// Follow re-exports from file f to the file that defines `name`. null = not found, "UNRESOLVED" = gave up.
const defMemo = new Map()
const visiting = new Set()

// Follow imports/re-exports from file f to the declaration exported as `name`.
// Returns "file::localName", null when f doesn't export it, or "UNRESOLVED" when we gave up.
function defKey(f, name, depth = 0) {
  const key = f + "::" + name

  if (defMemo.has(key)) return defMemo.get(key)

  if (visiting.has(key)) return null // re-export cycle: this path adds nothing new
  visiting.add(key)
  const v = defKeyUncached(f, name, depth)
  visiting.delete(key)
  defMemo.set(key, v)

  return v
}

function viaImport(f, local, depth) {
  const imp = parse(f).imports.find((i) => i.local === local)

  if (!imp) return null
  const t = resolveSpec(imp.spec, f)

  return t === null || t === "UNRESOLVED" ? "UNRESOLVED" : defKey(t, imp.orig, depth + 1)
}

function defKeyUncached(f, name, depth) {
  if (depth > 8) return "UNRESOLVED"
  const info = parse(f)

  if (name === "default" && info.defaultName) {
    const local = info.aliases.get(info.defaultName) ?? info.defaultName

    return info.defs.has(local) ? `${f}::${local}` : viaImport(f, local, depth)
  }

  if (info.aliases.has(name)) {
    const local = info.aliases.get(name)

    return info.defs.has(local) ? `${f}::${local}` : viaImport(f, local, depth)
  }

  if (info.defs.has(name)) return `${f}::${name}`

  for (const r of info.reexports) if (r.name === name) {
    const t = resolveSpec(r.spec, f)

    return t === null || t === "UNRESOLVED" ? "UNRESOLVED" : defKey(t, r.orig, depth + 1)
  }

  let unresolved = false

  for (const s of info.star) {
    if (name === "default") break // `export *` never re-exports a default
    const t = resolveSpec(s, f)

    if (t === "UNRESOLVED") { unresolved = true; continue }

    if (t === null) continue
    const d = defKey(t, name, depth + 1)

    if (d === "UNRESOLVED") unresolved = true
    else if (d) return d
  }

  return unresolved ? "UNRESOLVED" : null
}

function usedLocals(info) {
  const seen = new Set()

  const visit = (node) => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) seen.add(node.expression.text)
    else if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) seen.add(node.tagName.text)

    if (ts.isCallExpression(node)) for (const a of node.arguments) if (ts.isIdentifier(a)) seen.add(a.text)
    ts.forEachChild(node, visit)
  }

  visit(info.sf)

  return seen
}


  return { ts, files, isTest, parse, resolveSpec, defKey, usedLocals }
}
