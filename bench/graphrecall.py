"""Graph-level recall: for each truth symbol, which caller files does graph.json link to it
(calls / references / indirect_call edges into the symbol's node, from nodes in other files)."""
import json, sys

graph_path, truth_path = sys.argv[1], sys.argv[2]
g = json.load(open(graph_path))
t = json.load(open(truth_path))
nodes = {n["id"]: n for n in g["nodes"]}
CALLY = {"calls", "references", "indirect_call", "uses", "renders"}
out = []
for s in t["symbols"]:
    targets = [n["id"] for n in g["nodes"] if n.get("source_file") == s["def"]
               and n.get("label", "").rstrip("()") == s["name"]]
    found = set()
    for e in g["links"]:
        if e["target"] in targets and e.get("relation") in CALLY:
            src = nodes.get(e["source"], {})
            f = src.get("source_file")
            if f and f != s["def"]:
                found.add(f)
    nt, te = set(s["nonTest"]), set(s["test"])
    out.append({"name": s["name"], "node_found": bool(targets),
                "nonTest_recall": f"{len(found & nt)}/{len(nt)}",
                "test_recall": f"{len(found & te)}/{len(te)}",
                "extra": sorted(found - nt - te),
                "missed_nonTest": sorted(nt - found)[:6]})
print(json.dumps(out, indent=1))
