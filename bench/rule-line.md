# The one line added for the rule-line arm

Added to the `## graphify` rules block that `graphify install --project --platform claude` writes into
cal.com's AGENTS.md (CLAUDE.md is a symlink to it), right after the query/path/explain rule:

```
- For "what breaks if I change X" or "who depends on X" questions, run `graphify affected "<X>()" --depth 2` first: it returns callers and their callers in one call.
```

Everything else (graph, hooks, model, questions) is identical to the graphify arm. Results: `results/calcom-impact-affected/`.
