// Ground truth for "which files call X?" on a TS repo, using the TypeScript parser (syntax only).
// Rule: a file calls X if it imports the name X (named import, alias followed) or defines X,
// and contains a call X(...), new X(...), a JSX element <X>, or passes X as a value (callback).
// Symbols: exported top-level functions/consts-with-arrow in non-test files whose name is
// defined exactly once in the repo and is called from >= MIN other files. Sample with a fixed seed.
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const [repo, nStr, seedStr, minStr] = process.argv.slice(2);
const N = Number(nStr), SEED = Number(seedStr), MIN = Number(minStr || 5);

const files = execSync("git ls-files", { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"));

const isTest = (f) => /(\.test\.|\.spec\.|__tests__|\/test\/|\/tests\/|e2e|playwright|__checks__)/.test(f);

const defs = new Map(); // name -> [{file, exported}]
const uses = new Map(); // name -> Set(file)

function add(m, k, v) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); }

for (const f of files) {
  let text;

  try { text = fs.readFileSync(path.join(repo, f), "utf8"); } catch { continue; }

  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const local = new Map(); // local name -> imported/original name
  const defined = new Set();

  for (const st of sf.statements) {
    const exported = !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (ts.isFunctionDeclaration(st) && st.name) { add(defs, st.name.text, { file: f, exported }); defined.add(st.name.text); }

    if (ts.isClassDeclaration(st) && st.name) { defined.add(st.name.text); add(defs, st.name.text, { file: f, exported: false }); }

    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) {
        const fn = d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));
        add(defs, d.name.text, { file: f, exported: exported && !!fn });
        defined.add(d.name.text);
      }
    }

    if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) local.set(el.name.text, (el.propertyName || el.name).text);
    }
  }

  for (const d of defined) local.set(d, d);
  const seen = new Set();

  const visit = (node) => {
    let id = null;

    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression)) id = node.expression.text;
    else if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) id = node.tagName.text;
    else if (ts.isCallExpression(node)) for (const a of node.arguments) if (ts.isIdentifier(a) && local.has(a.text)) seen.add(local.get(a.text));

    if (id && local.has(id)) seen.add(local.get(id));
    ts.forEachChild(node, visit);
  };

  visit(sf);

  for (const name of seen) add(uses, name, f);
}

const cands = [];

for (const [name, ds] of defs) {
  if (ds.length !== 1 || !ds[0].exported || isTest(ds[0].file) || name.length < 6) continue;
  const callers = [...new Set(uses.get(name) || [])].filter((f) => f !== ds[0].file);

  if (callers.length >= MIN) cands.push({ name, def: ds[0].file, callers: callers.sort() });
}

cands.sort((a, b) => a.name.localeCompare(b.name));

let s = SEED; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = [];

while (pick.length < Math.min(N, cands.length)) { const c = cands[Math.floor(rnd() * cands.length)];

 if (!pick.includes(c)) pick.push(c); }

console.log(JSON.stringify({ repo: path.basename(repo), candidates: cands.length, typescript: ts.version,
  symbols: pick.map((c) => ({ ...c, nonTest: c.callers.filter((f) => !isTest(f)), test: c.callers.filter(isTest) })) }, null, 1));
