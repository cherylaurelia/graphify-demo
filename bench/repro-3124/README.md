# Calls inside anonymous callbacks lose their `calls` edge when the file also imports the callee

graphify 0.9.103 (also 0.9.62). This is the case `tests/test_js_module_level_anonymous_calls.py` names as
`test_direct_import_collision_is_a_known_remaining_gap`: the file node's `imports` edge to the callee and the
`calls` edge share a (source, target) pair, and the relation-blind dedup keeps only the first.

```bash
cd bench/repro-3124 && git init -q && git add -A && git commit -qm repro
graphify update .
python3 -c "import json; g=json.load(open('graphify-out/graph.json')); print([(e['source'], e['relation']) for e in g['links'] if e['target']=='target_target'])"
```

Expected: a `calls` edge from `anon_parent` and from `simple_test` (both call `target` inside `it(...)`).
Actual: `calls` only from `named_parent_makeapp`; `anon_parent` and `simple_test` have `imports` only.

On cal.com (commit 2eb48ec) this leaves 10 of 13 test-file callers in the bench without a calls edge, e.g.
`apps/web/pages/api/book/recurring-event.test.ts` → `expectSuccessfulCalendarEventCreationInCalendar`.
`graphify affected` still lists those files through the imports edge.
