# Fuse.js hill-climb log

Each generation appends a section. All verifier numbers come from the locked
`bench/hillclimb.mjs` (SHA-256 `f6831f6c…fb99693`) against the locked oracle
`bench/baseline-fuse.mjs` (SHA-256 `2c4938f5…907ef71f`). Single runs are noisy:
unmodified code has scored 0.995x–1.125x composite and 0.84x–1.58x on single
workloads.

## Generation 1

Branch `climb/gen1-best`, built from `climb/base` (`7d6e386`). Each accepted
experiment branch was merged with `--no-ff`, and every individual commit is
preserved. `dist/` conflicted on every merge and was resolved with a fresh
`npm run build`. No source conflicts.

### Branches

| Branch | Head | Review | Verdict | In gen1-best? |
|---|---|---|---|---|
| `climb/gen1-bitap` | `041968d` | `msg_4d0778eb…` | ACCEPT WITH FOLLOW-UPS | Yes, starting point |
| `climb/gen1-extended` | `2bb4ca2` | `msg_8422bfaf…` | ACCEPT WITH FOLLOW-UPS | Yes, merge `004d068` |
| `climb/gen1-topk` | `817d177` | `msg_c1c3ecdc…` | ACCEPT WITH FOLLOW-UPS | Yes, merge `3cc2872` |
| `climb/gen1-index` | `50f51ab` | `msg_4ae5137d…` | **REJECT** | **No** (see below) |
| `climb/gen1-prefilter` | `1999404` | — | REJECT (slowdown on long fields) | **No**, fix in progress, to be ported in gen 2 |
| `climb/base` | `7d6e386`, `43c7ec5`, `28cc81e` | — | — | Yes, merges `a57e9c4` (field-length probe), `4ebe6a2` (retention probe) and `47cd638` (fuzzer rev 2) |

**Why `climb/gen1-index` was left out.** The reviewer confirmed a parity divergence in
`Fuse.remove` (commit `50f51ab`). The new cursor filter
`(_, i) => i !== indicesToRemove[j] || (j++, false)` assumes that
`Array.prototype.filter` visits every index. On a sparse docs array the cursor
never advances past a hole, so `_docs` falls out of step with the index and
searches return the wrong document:

```js
const f = new Fuse(['apple', , 'banana', 'cherry'])
f.remove((_, i) => i === 1 || i === 2)
// baseline: docs=["apple","cherry"]           search('cherry') -> [["cherry",1]]
// branch:   docs=["apple","banana","cherry"]  search('cherry') -> [["banana",1]]
```

The reviewer proposed a fix and checked it locally without pushing it:
`(_, i) => { while (indicesToRemove[j] < i) j++; return i !== indicesToRemove[j] }`.
Going back to a `Set` would also work. The fix is not applied here; this
merge does not repair branches. With the fix, the reviewer estimates the branch
at about 1.40x on `index_diacritics_mutate` (about +5.8% composite) for +57 B
gzip. It is a candidate for generation 2.

### Extended × bitap interaction

On `climb/gen1-extended`, `ExtendedSearch.searchIn` holds each matcher's
result object until its AND group has finished. That is safe only if
`BitapSearch.searchIn` and the kernel return a fresh object on every call.

I checked this by reading the merged source:
- `search()` in `src/search/bitap/search.ts` builds a new `result` literal per call.
- `BitapSearch.searchIn` builds a new literal per call, on both the exact-match and the bitap paths.
- `convertMaskToIndices` and `mergeIndices` return new arrays.
- The kernel's module-level `Int32Array` buffers are scratch only and are never returned.

Commit `3398a27` adds `test/extended-and-fuzzy-parity.test.js` (30 tests):
- object-identity checks on `BitapSearch.searchIn` and the kernel;
- byte-exact parity with the baseline for AND groups holding two or more fuzzy
  terms, with `includeMatches` on and off, on string lists, object lists,
  `limit`, and `Fuse.match`.

Mutation check: when `BitapSearch.searchIn` was made to reuse a shared result
object, 22 of the 30 tests failed.

### Gate on the final tree (`3398a27`)

```
npm run typecheck                     -> OK
npm run build                         -> OK
npm test                              -> Test Files 24 passed (24) / Tests 489 passed (489)
PARITY_FUZZ_OK cases=400 comparisons=5626 seed=51
PARITY_FUZZ_OK cases=400 comparisons=5549 seed=52
PARITY_FUZZ_OK cases=400 comparisons=5638 seed=53
PARITY_FUZZ_OK cases=400 comparisons=5589 seed=54
FIELD_LENGTH_PROBE_OK
f6831f6ca705fa7f76cb8ceb5a8aed4c85b8dad0ed53e2f7ec36e61f3fb99693  bench/hillclimb.mjs     (matches AGENTS.md)
2c4938f54cacee4ab2e68aa3b3c6126c04d9e4394baa3d691a36acc1907ef71f  bench/baseline-fuse.mjs (matches AGENTS.md)
git status --short dist/              -> empty (committed dist == fresh build)
```

Where the test count comes from:
- 449 base tests
- \+ 10 from bitap (`test/bitap-kernel-parity.test.js`)
- \+ 30 new (`test/extended-and-fuzzy-parity.test.js`)
- = 489

The owner's trial reported 496 because it included the 37 tests from `climb/gen1-index`, which is left out here.

### Verifier runs on `climb/gen1-best`

All five runs PASS with 38 parity checks. `dist/fuse.min.mjs` gzip is 10269 B
for every run.

| run | bitap_fuzzy | bitap_matches | topk_limit10 | extended_logical | token_inverted | index_diacritics_mutate | composite | gzip |
|---|---|---|---|---|---|---|---|---|
| train #1 | 5.120x (802.0→156.6 ms) | 4.321x (806.6→186.7) | 4.854x (738.4→152.1) | 4.022x (229.1→57.0) | 5.563x (1779.2→319.8) | 1.001x (5.48→5.47) | **3.6601x** | 10269 B |
| train #2 | 4.798x (752.0→156.7) | 4.411x (791.1→179.3) | 4.935x (746.9→151.4) | 3.906x (221.3→56.7) | 5.381x (1784.7→331.7) | 1.006x (5.50→5.46) | **3.6085x** | 10269 B |
| train #3 | 4.775x (757.3→158.6) | 4.252x (790.3→185.9) | 4.864x (748.0→153.8) | 3.817x (218.9→57.3) | 5.399x (1775.1→328.8) | 1.009x (5.40→5.35) | **3.5653x** | 10269 B |
| holdout #1 | 4.837x (761.9→157.5) | 4.387x (791.8→180.5) | 4.918x (749.1→152.3) | 3.922x (223.0→56.9) | 5.539x (1790.4→323.2) | 1.071x (6.32→5.90) | **3.6659x** | 10269 B |
| holdout #2 | 4.736x (753.8→159.2) | 4.352x (781.1→179.5) | 4.909x (746.2→152.0) | 3.936x (221.7→56.3) | 5.322x (1745.0→327.9) | 1.013x (5.67→5.60) | **3.5915x** | 10269 B |

- Composite: train 3.566–3.660x, holdout 3.592–3.666x. The median over all five runs is 3.6085x.
- Holdout results agree with train.
- `index_diacritics_mutate` is within noise. As expected: the index track is not merged.

### Per-merge `node bench/climb-profile.mjs all --rounds 7`

This is the indicative in-process profiler, run against the oracle. Its baseline
column drifts between runs (the sandbox is noisy), so compare candidate ms within a row
with caution. The final library code is identical at "+ topk" and "+ base".

| stage (HEAD) | fuzzy | matches | topk | extended | token | index | geomean | gzip |
|---|---|---|---|---|---|---|---|---|
| bitap only (`041968d`) | 541.74→134.33 ms, 4.033x | 608.04→176.03, 3.454x | 610.50→138.51, 4.407x | 166.21→61.69, 2.694x | 1468.78→303.82, 4.834x | 8.27→9.49, 0.871x | 2.9775x | 10286 B |
| + extended (`004d068`) | 638.59→182.13, 3.506x | 828.78→244.05, 3.396x | 802.50→212.07, 3.784x | 244.03→73.71, **3.311x** | 1915.12→418.56, 4.576x | 11.38→11.39, 0.999x | 2.9669x | 10278 B |
| + topk (`3cc2872`) | 813.64→207.78, 3.916x | 793.25→245.45, 3.232x | 785.61→212.40, 3.699x | 253.70→81.06, 3.130x | 1868.70→417.02, 4.481x | 10.86→11.15, 0.974x | 2.9354x | 10269 B |
| + base (`a57e9c4`) | 831.86→211.73, 3.929x | 768.26→220.16, 3.490x | 619.18→182.50, 3.393x | 213.97→72.15, 2.966x | 1650.28→346.25, 4.766x | 9.20→10.92, 0.843x | 2.8661x | 10269 B |

- Extended's contribution shows as the `extended` ratio rising from 2.69x to 3.31x. It is also visible on the verifier: 3.82–4.02x on `extended_logical`, against 3.31–3.35x for bitap alone in its review.
- Topk's contribution is within noise here, as its review found. Its sure gain is −9 B gzip.
- The base merge changes no library code. Its row shows the run-to-run noise of this profiler.

### Bundle size

`dist/fuse.min.mjs` is 10269 B gzip (zlib default, as the verifier measures it):
- **+70 B** over the 10199 B base;
- **359 B** under the **10628 B** cap;
- of the 429 B shared gen-1 budget, 70 B is used.

Per merge: 10286 B (bitap), then 10278 B (+extended, −8), then 10269 B (+topk, −9), then 10269 B (+base, ±0).

### Addendum: second `climb/base` merge and the retention probe

After the first base merge (`a57e9c4`), `climb/base` moved to `43c7ec5`
("chore(bench): add retention probe for memory held after large searches").
Merge `4ebe6a2` brings that commit in. It changes no `src/` or `dist/` (a
fresh build is byte-identical, gzip still 10269 B) and `npm test` is still
24 files / 489 tests. The five verifier runs above were taken on identical
library code.

`bench/retention-probe.mjs` is not part of the gen 1 crossover gate, but it
**fails on `climb/gen1-best`**:

```
$ node --expose-gc bench/retention-probe.mjs
retention probe: candidate=../dist/fuse.mjs chars=5000000 max-retained-mb=4
            heap MB  buffers MB   hits
baseline       4.86       0.00     10
candidate      4.86     114.44     10
candidate retains -0.01 MB heap and 114.44 MB ArrayBuffer more than baseline
RETENTION_PROBE_FAIL
```

Bisect over committed `dist/fuse.mjs` (`--candidate`):

| tree | result |
|---|---|
| `origin/climb/base` `43c7ec5` | RETENTION_PROBE_OK (0.00 MB) |
| `origin/climb/gen1-bitap` `041968d` | RETENTION_PROBE_FAIL (114.44 MB) |
| `004d068` (+extended) | FAIL (114.44 MB) |
| `3cc2872` (+topk) | FAIL (114.44 MB) |

The cause is bitap follow-up 1 (module-level `bufA`/`bufB`/`charBuf` that
grow with the longest text scanned and are never released). Bitap was not
left out: its review verdict is ACCEPT WITH FOLLOW-UPS and the probe is not in
this task's gate. Fixing the buffers so this probe passes is the first item
for generation 2.

### Addendum 2: parity fuzzer rev 2 (third `climb/base` merge)

`climb/base` moved again, to `28cc81e` ("chore(bench): parity fuzzer rev 2,
sparse arrays and out-of-range options"). Merge `47cd638` brings it in, with no
`src/` or `dist/` change (gzip still 10269 B).

The gate's fuzzer step now **fails on `climb/gen1-best`**. Each run below is
`node bench/parity-fuzz.mjs --iters 400 --seed N`, checked against the
committed `dist/fuse.mjs` of each merge step:

| tree | seeds 51–54 (rev 2) |
|---|---|
| `041968d` bitap | OK, OK, OK, OK |
| `004d068` + extended | OK, OK, OK, OK |
| `3cc2872` + topk | FAIL ×4 (`parseIndex` step) |
| `47cd638` with `--no-sparse-records` | OK ×4 (comparisons 5496 / 5380 / 5516 / 5491) |

Repro:

```
PARITY_FUZZ_FAIL at case 0 (seed=51, caseSeed=51000153) step 11: parseIndex
  options: {"includeScore":true,"ignoreLocation":true,"findAllMatches":true,"threshold":0.2,"distance":0}
  baseline : …[]
  candidate: …THROW:Cannot read properties of undefined (reading 'v')
```

This is topk follow-up 1. `for…of` over index `records` throws on holes, where
the baseline's `forEach` skipped them. Commit `28cc81e` says the fix is
assigned to `climb/gen2-core`, and that `--no-sparse-records` is for branches
forked from this tree until the fix lands.

`climb/gen1-topk` is therefore **still in** `climb/gen1-best`. It has not been
reverted, and the branch has not been rewritten. That is a decision for the lead.
Topk's measured speed gain is within noise, and its only certain gain is −9 B
gzip. Bitap + extended alone (`004d068`) pass rev 2 on all four seeds.

### Open follow-ups from the reviews (not implemented here)

**bitap** (`msg_4d0778eb`):
1. The module-level scratch buffers `bufA`, `bufB` and `charBuf` grow to about 2 × `finish` and never shrink. With `ignoreLocation` or `findAllMatches`, `finish` is about the text length, so the process keeps about 24 B per character of the longest text ever searched. One search on a 5.4M-character text left 129.7 MB of `arrayBuffers` held after gc, against 0.1 MB on base. Suggestion: above a limit (for example 64K entries), allocate per call instead of keeping the buffers.
2. `location: NaN` no longer throws. The baseline throws `RangeError: Invalid array length`; this branch returns results. This is invalid input only, but it is a behaviour difference.
3. Unconfirmed, cost only: each `BitapSearch` allocates and fills an `Int32Array(256)` per chunk, about 1 KB per chunk for short-lived searchers.

**extended** (`msg_8422bfaf`):
1. Lead 2 is half done. `isInverse()` still runs once per successful group per text, through a `.some` closure, and `MULTI_MATCH_TYPES.has` runs per matcher when `includeMatches` is on. Precomputing a per-group `hasInverse` flag at parse time would save a few more ms.
2. Merge risk: matcher result objects are now held until the group finishes. **Checked for this merge:** results are fresh per call, and test `3398a27` guards it.
3. Minor: the `existing.matches.push(...)` dedupe branch in `_searchLogical` is unreachable, because record indexes are unique.

**topk** (`msg_c1c3ecdc`):
1. An index whose `records` array has holes now throws (`Cannot read properties of undefined`) instead of skipping them, because `forEach` became `for…of`. Only a hand-built sparse array triggers it. Either document it or add `if (!record) continue`.
2. `_findMatches` is now a wrapper that still allocates an array for `_searchLogical`. The extended path could call `pushMatches` directly.
3. The `f455c57` commit body quotes a single noisy run (1.080x fuzzy). Future commit bodies should quote medians.
4. Internal only: in `dist/fuse.d.ts`, `MaxHeap` loses `size`, `_bubbleUp` and `_sinkDown`. It is not exported.

**index** (`msg_4ae5137d`, not merged; these apply when it is ported):
1. Blocking: the `Fuse.remove` sparse-docs desync described above.
2. Building an index over fields that contain tabs or NBSP is about 2x slower (1.54 ms on base against 3.20 ms on the branch, for 5000 rows), because `RARE_SEPARATORS` + `replace` allocates a string per field. Fall back to the char loop instead.
3. `get()` reads an array segment's getter twice, against once in the baseline. This only matters for stateful getters and Proxies.
4. The `deepGet` comment says "outermost array"; the code uses the innermost array.
5. Cosmetic: the error text for a non-string in a string list changes.

**prefilter**: rejected for a slowdown on long fields. A fix is in progress, to be ported in generation 2.

## Generation 2

Branch `climb/gen2-best`, built from `climb/gen1-best` (`f67c9c0`). First a
merge of the `climb/base` guards (`4d3a960`: `bench/match-fuzz.mjs`,
`bench/index-api-fuzz.mjs`, field-length probe rev 2; tool files only, no
`src/` or `dist/` change), then the three accepted branches in the order
core, size, myers. Every merge is `--no-ff`; every individual commit is
preserved. There were no source conflicts. `dist/` was rebuilt with
`npm run build` on every merge. For core there was no textual conflict and
the rebuild matched `971ed50`'s committed `dist/`. For size and myers the
five minified files conflicted and the rebuild resolved them. No `dist/`
file was edited by hand. None of the three branches had moved past the
commit listed in the brief when it was merged.

### Branches

| Branch | Merged at | Merge commit | Review | Verdict | In gen2-best? |
|---|---|---|---|---|---|
| `climb/base` (guards) | `4d3a960` | `efbd65e` | — | — | Yes, tools only. Not merged again afterwards |
| `climb/gen2-core` | `971ed50` | `9234df4` | `msg_e0018c74-2337-404c-a715-4b4bbea4a189_1` | ACCEPT WITH FOLLOW-UPS | Yes |
| `climb/gen2-size` | `593c174` | `6566ab1` | `msg_0e3b6dad-904d-4b2b-87c9-9c683a334011_1` | ACCEPT WITH FOLLOW-UPS | Yes |
| `climb/gen2-myers` | `3f05f16` | `8a05651` | `msg_62cb5b2d-7061-4b45-8ee0-8b1b4a42e835_1` | ACCEPT WITH FOLLOW-UPS | Yes (it carries `climb/gen1-prefilter` via `22e7764`) |
| `climb/gen2-index` | head `c90758b` | — | `msg_c1e15dc4-49d4-43aa-96c6-bc0c2967cfc4_1` | **REJECT** | **No** |

**Why `climb/gen2-index` was left out.** The reviewer confirmed two parity
divergences from the baseline, neither of which exists on `climb/gen1-best`:
- **D1:** `FuseIndex.removeAll(new Set([1,2]))` throws
  `TypeError: indices.filter is not a function`. The baseline returns a result.
- **D2:** index creation reads `item.v` once where the baseline (and
  gen1-best) read it three times. With a custom `getFn` whose items have a
  stateful `v` getter, the branch builds a different index (`"first"` vs `"later"`).

`bench/index-api-fuzz.mjs` is the guard that catches this. The reviewer
measured index build about 1.65x faster (6.13 to 3.70 ms, about +8–9%
composite) for +70 B gzip, and tried a small local fix that he did not push
(`[...indices].filter` and three reads of `item.v`; +14 B). The repair
belongs to generation 3.

**Correction to generation 1: `climb/gen1-prefilter`.** The second review
(thread `msg_83400ea0-545f-4fbe-a9fb-76ec0d84cb55_1`, head `6efdf42`) ended in
**REJECT**, finding R1. When the only hit in a field is an exact copy of the
query near `location`, and the window `threshold × distance` is wide, the
filter walks the whole window. The baseline settles that case at once with
its `indexOf` pre-pass. Measured slowdowns: 8.2x at 1,000 characters with
`distance: 1000`, 40x at 10,000 with `distance: 1e4`, 23x at 1M with
`distance: 1e6`. Its output was byte-identical (600,000 window-edge triples, 0
mismatches). The generation 1 section above says only "fix in progress". The
branch was never merged directly. `climb/gen2-myers` ports it (merge
`22e7764`) and answers R1 in `733e402`, but only for windows longer than 256
positions (see the `lone hit` cells below).

### Gate on the final tree (`8a05651`)

```
npm run typecheck                     -> OK
npm run build                         -> OK
npm test                              -> Test Files 30 passed (30) / Tests 530 passed (530)
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5626 seed=1 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5655 seed=2 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5485 seed=3 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5637 seed=4 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5510 seed=71 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5479 seed=72 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5456 seed=73 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5583 seed=74 candidate=../dist/fuse.mjs
MATCH_FUZZ_OK cases=150000 seed=1 mismatches=0 candThrowsOnly=0 baseThrowsOnly=9957 baselineMatchRate=0.392
MATCH_FUZZ_OK cases=150000 seed=2 mismatches=0 candThrowsOnly=0 baseThrowsOnly=9968 baselineMatchRate=0.392
MATCH_FUZZ_OK cases=150000 seed=3 mismatches=0 candThrowsOnly=0 baseThrowsOnly=10121 baselineMatchRate=0.391
candidate retains -0.01 MB heap and 0.02 MB ArrayBuffer more than baseline
RETENTION_PROBE_OK
INDEX_API_FUZZ_OK removeAll=4000 reads=4000 seed=1 mismatches=0
INDEX_API_FUZZ_OK removeAll=4000 reads=4000 seed=2 mismatches=0
INDEX_API_FUZZ_OK removeAll=4000 reads=4000 seed=3 mismatches=0
f6831f6ca705fa7f76cb8ceb5a8aed4c85b8dad0ed53e2f7ec36e61f3fb99693  bench/hillclimb.mjs     (matches AGENTS.md)
2c4938f54cacee4ab2e68aa3b3c6126c04d9e4394baa3d691a36acc1907ef71f  bench/baseline-fuse.mjs (matches AGENTS.md)
git status --short dist/              -> empty
```

The parity fuzzer ran **without** `--no-sparse-records`, so the sparse-records
regression in `climb/gen1-best` is fixed (by `climb/gen2-core`). Match-fuzz
reads 0 mismatches, so the fractional-`location` defect is fixed (by
`climb/gen2-myers` `167366d`). The retention probe reads 0.02 MB, against
114.44 MB on gen1-best, so the pinned buffers are fixed (by `climb/gen2-myers`
`b133ac3`).

**Field-length probe rev 2**: `FIELD_LENGTH_PROBE_FAIL` on both runs. That is
expected and does not fail this gate. The rule is that every `SLOWER` line
must be a `lone hit*` mode, at field length 1,000 or less, with a ratio below
2.5, and that no `RESULT MISMATCH` appears. Both runs satisfy it, with 0
`MISMATCH` lines. Every non-`lone hit` cell is 0.06–0.68 of the baseline.
The marked lines:

```
run 1:
lone hit dflt         40   5000        5.114         6.873       1.34  SLOWER
lone hit dflt        200   1000        0.825         1.108       1.34  SLOWER
lone hit dflt       1000    200        0.181         0.234       1.29  SLOWER
lone hit             200   1000        0.859         1.890       2.20  SLOWER
lone hit+match       200   1000        1.823         2.961       1.62  SLOWER
run 2:
lone hit dflt        200   1000        0.809         1.077       1.33  SLOWER
lone hit dflt       1000    200        0.172         0.225       1.31  SLOWER
lone hit             200   1000        0.817         1.821       2.23  SLOWER
lone hit+match       200   1000        1.767         2.932       1.66  SLOWER
```

`lone hit dflt` at 40 characters read 1.34 in run 1 and 1.05 in run 2, so it
is borderline noise. The owner's trial did not mark this cell.

### Verifier runs on `climb/gen2-best` (`8a05651`)

All five runs PASS with 38 parity checks. `dist/fuse.min.mjs` is 9752 B gzip
(−3.65% vs base, cap 10628 B). Each cell is speedup (baseline→candidate ms).

| run | bitap_fuzzy | bitap_matches | topk_limit10 | extended_logical | token_inverted | index_diacritics_mutate | composite | gzip |
|---|---|---|---|---|---|---|---|---|
| train #1 | 14.778x (799.8→54.1) | 12.197x (798.4→65.5) | 15.295x (757.0→49.5) | 8.486x (226.6→26.7) | 20.900x (1758.0→84.1) | 0.990x (5.87→5.93) | **8.8612x** | 9752 B |
| train #2 | 14.246x (753.7→52.9) | 12.215x (789.4→64.6) | 15.271x (770.9→50.5) | 9.475x (257.2→27.1) | 21.064x (1764.7→83.8) | 1.013x (5.3→5.3) | **9.0160x** | 9752 B |
| train #3 | 14.437x (744.9→51.6) | 12.188x (805.8→66.1) | 16.104x (803.1→49.9) | 8.885x (223.4→25.1) | 20.528x (1742.3→84.9) | 0.943x (7.7→8.2) | **8.8717x** | 9752 B |
| holdout #1 | 14.419x (756.8→52.5) | 11.942x (786.5→65.9) | 15.221x (766.4→50.4) | 8.575x (220.7→25.7) | 20.810x (1809.0→86.9) | 1.000x (5.4→5.4) | **8.8099x** | 9752 B |
| holdout #2 | 16.320x (881.6→54.0) | 11.443x (793.7→69.4) | 14.833x (749.9→50.6) | 8.568x (223.9→26.1) | 20.269x (1736.7→85.7) | 0.977x (5.5→5.6) | **8.8172x** | 9752 B |

Compared with generation 1 (same verifier, five runs above):

| | train composite | holdout composite | gzip |
|---|---|---|---|
| `climb/gen1-best` | 3.565–3.660x | 3.592–3.666x | 10269 B |
| `climb/gen2-best` | 8.861–9.016x | 8.810–8.817x | 9752 B |

- That is about **2.45x** over gen1-best, and holdout agrees with train.
- The owner's trial of the same merge read 10.31x train in another sandbox.
  This sandbox reads 8.86–9.02x for the same code.
- `index_diacritics_mutate` is in the noise band (0.94–1.01x), as expected
  with the index track left out.

### Per-merge `node bench/climb-profile.mjs all --rounds 7`

This is the indicative in-process profiler: baseline→candidate ms and speedup.
The baseline column drifts between runs.

| stage (HEAD) | fuzzy | matches | topk | extended | token | index | geomean | gzip |
|---|---|---|---|---|---|---|---|---|
| gen1-best + base guards (`efbd65e`) | 553.55→178.80, 3.096x | 540.40→155.48, 3.476x | 496.28→123.19, 4.029x | 162.62→51.21, 3.176x | 1232.33→252.88, 4.873x | 6.42→7.21, 0.891x | 2.9025x | 10269 B |
| + core (`9234df4`) | 544.91→134.85, 4.041x | 556.28→153.86, 3.616x | 522.33→123.84, 4.218x | 160.04→49.13, 3.258x | 1170.11→239.76, 4.880x | 6.56→6.54, 1.003x | 3.1532x | 10263 B |
| + size (`6566ab1`) | 524.82→131.46, 3.992x | 540.20→151.88, 3.557x | 512.45→126.30, 4.057x | 161.67→50.46, 3.204x | 1202.20→245.67, 4.894x | 6.91→6.50, 1.064x | 3.1415x | 9531 B |
| + myers (`8a05651`) | 513.32→51.83, 9.903x | 534.81→67.13, 7.967x | 501.24→48.27, 10.385x | 160.41→27.26, 5.885x | 1187.44→86.75, 13.689x | 5.99→6.25, 0.958x | 6.3120x | 9752 B |

- **Core:** token 252.9→239.8 ms, consistent with its review's +3%. The
  fuzzy 178.8→134.9 ms step in this run is probably noise in the first row.
- **Size:** speed-neutral; −732 B gzip on the merged tree.
- **Myers:** all of the large gain comes from here (about 2.5–3x on the
  search workloads), for +221 B gzip.

### Bundle size

`dist/fuse.min.mjs` is 9752 B gzip:
- 517 B below gen1-best's 10269 B;
- 447 B below the 10199 B base;
- 876 B under the cap.

Per merge: 10269 B (guards), then 10263 B (+core, −6), 9531 B (+size, −732)
and 9752 B (+myers, +221).

### What became of generation 1's open follow-ups

| follow-up | status |
|---|---|
| bitap 1: scratch buffers pin memory | **Fixed** (`b133ac3`, gen2-myers). Retention probe OK at 0.02 MB |
| bitap 2: `location: NaN` returns where the baseline throws | **Still open**, an accepted divergence (counted as baseline-only throws in match-fuzz) |
| bitap 3: `Int32Array(256)` table per chunk | **Still open** (cost only, unconfirmed) |
| extended 1: `isInverse` via `.some` per group, `MULTI_MATCH_TYPES.has` per matcher | **Still open** |
| extended 2: result objects held until the group finishes | Closed (checked in gen 1, guarded by `3398a27`) |
| extended 3: unreachable `existing.matches.push` dedupe | **Still open** |
| topk 1: sparse `records` throw | **Fixed** (`f8abdfe`, gen2-core). The parity fuzzer passes without `--no-sparse-records` |
| topk 2: `_findMatches` wrapper allocates for `_searchLogical` | **Still open** |
| topk 3: commit bodies should quote medians | Still applies as a process note (the gen2-size review also notes missing ms figures) |
| topk 4: `MaxHeap` members dropped from `dist/fuse.d.ts` | Dropped: internal and not exported |
| index 1–5 | Fixed on `climb/gen2-index` (each verified by its reviewer), but that branch is not merged, so **still open here**. They carry into gen 3 together with D1/D2 |
| prefilter (long-field slowdown) | Ported through gen2-myers. R1 is fixed for windows longer than 256 positions; the residual is the `lone hit` cells (below) |

### New open follow-ups from the generation 2 reviews (not implemented here)

**gen2-core** (`msg_e0018c74`):
1. Token search now relies on the bitap kernel ignoring `isCaseSensitive`/`ignoreDiacritics`. gen2-myers preserves this (`test/token-normalize-parity.test.js` passes on the merged tree); any future kernel change must keep it.
2. Merge risk around the restructured `search()`/`_searchLogical`. Checked here: no conflict, and rev 2 fuzz passes on 8 seeds.
3. The retention probe failure: **fixed** on the merged tree by gen2-myers.
4. Minor: both scans allocate an unused `results` array when a heap is passed.
5. Accepted direction: a present `null`/`undefined` record in a hand-built index is skipped where the baseline throws.

**gen2-size** (`msg_0e3b6dad`):
1. `Fuse.parseQuery(...)` leaf `searcher.options` for extended and object leaves now holds raw values (or `{}`) instead of the 9 resolved keys, in the non-minified builds. Search results are unaffected. Architect's call.
2. `Fuse.match(5,'abc',{useExtendedSearch:true})` now throws `value.toLowerCase is not a function` instead of `pattern.toLowerCase…` (non-minified builds only). The fix is to rename `normalizeValue`'s parameter back to `pattern` (0 B minified).
3. Nit: a comment in `diacritics.ts` cites `.js` instead of `.ts` and "~570 B" instead of 604 B. Commit bodies lack target-workload ms.

**gen2-myers** (`msg_62cb5b2d`):
1. **F1:** when the filter passes and the kernel still runs over a wide window, the extra Myers pass is slower than gen1-best, though still faster than the baseline:
   - `ignoreLocation + includeMatches` on 100k fields: 1.60x;
   - a 1M field with `distance 1e6, threshold 0.9`: 1.91x;
   - 10k fields with `distance 1e4`: 1.40x;
   - 1k fields with `threshold 0.9`: 1.31x.

   Fix: with `ignoreLocation`, let `canMatch` return as soon as `score < m && score/m <= threshold`, instead of walking the whole text to find `best`.
2. F2 (accepted): for NaN or fractional `location`, the baseline throws where the branch returns.
3. **`lone hit` probe cells (required fix for generation 3).** The R1 shortcut (`733e402`) applies only to windows longer than 256 positions. Shorter windows walk position by position with a `calcScore` per step. On this merged tree:
   - `lone hit` at 200: 2.20 / 2.23;
   - `lone hit+match` at 200: 1.62 / 1.66;
   - `lone hit dflt` at 200 and 1,000: 1.29–1.34 (and 1.34 / 1.05 at 40).

   The owner's figures on `3f05f16` were 1.87–2.02, 1.39–1.45 and 1.15–1.29. The worker reports that removing the 256 guard costs 5–6% on the fuzzy workloads. Gate: field-length probe rev 2 must print `FIELD_LENGTH_PROBE_OK`.

**gen2-index** (`msg_c1e15dc4`, not merged): D1 and D2 above are blocking. Also:
- **D3** (non-blocking, contrived): the same record object appearing twice in `parseIndex` records changes the `removeAll` result. Restoring the two-pass `removeAll` fixes D1 and D3 together.
- **Nit:** `isArray = Array.isArray` is captured when the module loads.
- **Commit hygiene:** merge `85d03e8` has an empty body; the `.d.ts` change in `f8e3afe` was only undone in `c90758b`.

## Generation 3

Branch `climb/final`, built from `climb/gen2-best` (`c481aa4`) by a new lead
(`fx-cloud (gen3-lead)`, board thread `msg_9b051d3e-c670-469a-8148-676d2ec55680_1`).
The original architect launched the three generation 3 workers and then ran
out of sandbox time; it did not review, merge or verify anything below. One
branch was merged, with `--no-ff`; its individual commits are preserved.
There was no conflict of any kind (the branch descends from `c481aa4`), and the
rebuilt `dist/` is byte-identical to the one the branch committed.

This generation was judged on safety first. Four branches or attempts were
reviewed or measured and three were left out. Every first review, and one of
the two re-reviews, found a defect that the verifier and all the shared
guards scored as a pass.

### Branches

| Branch | Reviewed at | Merge commit | Review | Verdict | In climb/final? |
|---|---|---|---|---|---|
| `climb/gen3-scan` | `d1a8bc7` | — | `msg_ee7e02ba-d4c0-4e7a-a89b-ec7be3b1f9fc_1` | **REJECT**, with a named two-line fix | No, superseded by the next row |
| `climb/gen3-scan` + fix-up | `f55c09d` | `5c0c097` | `msg_fc0d722e-a75e-4f8c-8492-fc607e5dc3ba_1` (targeted) | ACCEPT WITH FOLLOW-UPS | Yes |
| `climb/gen3-harden` | `9fd1956` | — | `msg_406ef0ad-15d2-4494-9886-33544df67e68_1` | **REJECT**, with a named fix | No |
| `climb/gen3-harden` + fix-up | `77d7039` | — | `msg_fe84c34f-244d-4886-bdfd-350466238858_1` (targeted) | **REJECT** | **No** |
| `climb/gen3-index` | `09c1e2f` | — | `msg_d4c7302c-96a3-41d3-a1f0-54c38d73738b_1` | **REJECT** | **No** |
| `climb/gen3-nonstring` | never pushed | — | worker thread `msg_80096dce-25c5-4555-8bf9-7a50ab1a393e_1` | Exact fix over its byte limit; the worker stopped as briefed | **No** |

**`climb/gen3-scan` (merged at `f55c09d`).** The required fix of this
generation: a lone exact copy of the query in a window of 33 to 256 positions
is now settled by a native substring search instead of a position-by-position
walk (`6b0b144`); an integer edit bound is tested before `calcScore`
(`2a16df1`); and the `ignoreLocation` pass stops at the first passing start
when the caller only needs truth (`bc85d8a`, generation 2's finding F1). The
first review confirmed the fix (`FIELD_LENGTH_PROBE_OK` in 4 of 4 runs; every
`lone hit` cell 0.66–0.99 of the baseline, against up to 2.06 on
`climb/gen2-best`; 148,000 window-edge cases and 585,000 `k/m` boundary cases
with 0 mismatches; a separate 13-run copy of the lone-hit modes read
`lone hit+match` at 200 as 1.46 once and 0.73–1.18 otherwise, which the
reviewer counted as noise) and rejected the branch for one defect: `2a16df1` computed
the bound as `Math.floor(threshold * m)`, so a BigInt `threshold` with
`ignoreLocation` or `distance: -1` threw `Cannot mix BigInt and other types`
where the baseline and `climb/gen2-best` return a result (36 new
candidate-only throws in 1,065 odd-option cases). The fix-up `f55c09d`
replaces the arithmetic with a comparison-only loop (9829 → 9811 B).
The targeted re-review at `f55c09d` returned **ACCEPT WITH FOLLOW-UPS**: the
loop equals the brute-force bound in 33,718 `(m, threshold)` pairs (0 wrong);
1,082,760 `Fuse.match` cases and 33,000 whole searches around every `k/m`
boundary match the baseline byte for byte; in a 9,348-case grid of odd option
types the branch gives the same output as `climb/gen2-best` for every
stateless value; `FIELD_LENGTH_PROBE_OK` in 3 of 3 runs. Its verifier read
9.2059x train and 9.1903x holdout.

**Why `climb/gen3-harden` was left out.** It restored three development-build
details that generation 2's reviewers had classed as non-blocking (the
wording of one `TypeError`, the resolved `options` on `Fuse.parseQuery` leaf
searchers, an unused array in the record scans; 9752 → 9750 B). Both reviews
rejected it for the way commit `354d78e` makes `Fuse.parseQuery` read a
user-supplied options object, which a stateful getter can observe:
- First review, at `9fd1956`: the `ExtendedSearch` constructor resolved the
  options and then passed the raw object on, so each key was read twice
  (21 reads against the baseline's 10). With a `threshold` getter that
  changes after its first read, `Fuse.parseQuery({title:'abd'}, opts)` built a
  searcher that returns `{"isMatch":false,"score":1}` where the baseline and
  `climb/gen2-best` return `{"isMatch":true,"score":0.333…}` (52 of 216
  getter cases). Fixed by `77d7039` (+1 B).
- Targeted re-review, at `77d7039`: count and keys now equal the baseline in
  312 of 312 traces, but for `$fuzzy` leaves the nine keys are read in a
  different order than the baseline's (and `climb/gen2-best`'s). With a Proxy
  whose `threshold` depends on how many reads came before, 784 of 56,160
  cases differ where `climb/gen2-best` matches the baseline. Named fix: about
  8 lines in `matchers.ts`, +34 B (scratch patch in attachment
  `att_0c490a0c-3fd2-40d2-92dc-3fe9de23f66b`, not pushed).

The lead's rules allowed one fix-up and one targeted re-review per branch;
both were used. The three items stay as they were after generation 2.

**Why `climb/gen3-index` was left out.** It merges the rejected
`climb/gen2-index` (`c90758b`), repairs D1 to D3 (all three verified fixed:
0 differences in 12,006 `removeAll` cases and 16,004 index-build cases) and
adds two speed commits. The reviewer measured the index workload at about
1.65x over `climb/gen2-best` (about 8.4 → 5.1 ms, +126 B) and found three
defects that came in with `c90758b` and that the generation 2 review missed;
`climb/gen2-best` passes on all three:
- **F1 (blocking):** the word count in `src/tools/fieldNorm.ts` calls
  `RARE_SEPARATORS.test(value)` and `value.indexOf`, so index creation throws
  where the baseline returns for a non-primitive string-like in a string list:
  `new Fuse(['x', { trim(){return 'y'}, toString(){ throw new TypeError('nope') } }])`.
  Named fix: 2 lines, +5 B.
- **F2 (slowdown outside the benchmark):** the `indexOf` word count is slower
  than the baseline on fields of short words: 2.50–2.56x on `'w '`×1M,
  2.38–2.64x on 2,000 fields of `'a b c d e '`×40, 1.63x on 2-character
  words, 1.15–1.28x on a `'red apple N'` string list. It is faster on words
  of 5 characters or more, which is what the verifier's vocabulary has.
  Restoring `climb/gen2-best`'s loop costs −34 B and leaves the index
  workload about 1.27x over `climb/gen2-best` (about +4% composite).
- **F3:** `get()` and the inlined default getter read the key path in a
  different count and order. With a Proxy path whose `length` trap is
  stateful, `Fuse.config.getFn({k:{x:5}}, proxyPath)` returns `"5"` where the
  baseline returns `5`. No measured fix (the reviewer estimates 30–40 B and
  recommended a waiver).

The lead did not run a fix-up: only F1 has a named fix with a measured cost;
F2 is the class of slowdown this swarm rejected the prefilter for, and fixing
it halves what the branch is worth; F3 is the class of defect generation 2
was rejected for. This is the third review of the index work and the third to
find defects the previous one missed. `index_diacritics_mutate` therefore
stays at about 1.0x. Repros: attachment
`att_869c9fab-4f03-4e94-8fb5-274c52c59679`.

**`climb/gen3-nonstring` (never pushed).** The harden worker found that a
`text` or `pattern` that is not a string diverges from the baseline on
`climb/gen2-best` (see "Behaviour differences" in the Final section). The lead
launched one fix-up worker with a 350 B limit. Its only exact fix is a port of
the baseline kernel for non-string text behind a `typeof` guard, **+500 B**
(9752 → 10252 B; a first version was +582 B), so it pushed nothing, as
briefed. Partial fixes it measured: +19 B (pattern-side messages) and +39 B
(also the baseline-only throws and text-side messages); neither removes the
candidate-only throws on array text. Patch and test (unreviewed): attachments
`att_09d2eb8c-8502-40f9-8cd4-a45ece510d2a` and
`att_42a7fd6b-4aee-44c5-aec7-59d582a8b7c4` on its thread.

### Open follow-ups from the generation 3 reviews (not implemented here)

**gen3-scan** (`msg_ee7e02ba`, `msg_fc0d722e`):
1. A 1M-character field with `distance: 1e6, threshold: 0.9` reads 1.12–1.22x of `climb/gen2-best`'s time after a long warm-up sequence in the same process (6 of 6 runs; 0.94–0.97x in a fresh process; 0.37–0.40x of the baseline either way). The reviewer's profile puts the gap in `canMatch` (95.6 against 53.4 ms, repeated OSR cycles) and suspects the loop shape from `bc85d8a`, not the 32 guard or `kmax`.
2. For an array `text` of 33 to 256 elements the branch returns an `Array.includes`-based result where `climb/gen2-best` threw `charCodeAt is not a function` (differs from the baseline in 65 of 1,026 cases). Same class as the non-string divergence below.
3. Not attempted, no measurements: hoisting the `ignoreLocation` test out of the loop, the `??` fallback above U+00FF, the per-call destructuring in `searchIn`. The worker's design note for token search (a per-text character-presence set, to reject a term before the Myers pass) is on thread `msg_97dc6e82`.
4. The comparison loop in `f55c09d` runs up to `m + 1` times per `canMatch` call. On 32-character queries over 20,000 short texts it is 4–14% slower than `d1a8bc7` with default options (5 of 5 runs) and 1.4–12% slower with `ignoreLocation`; no verifier workload is slower in every run. Cheapest fix: compute `kmax` once per pattern chunk, or keep the arithmetic behind `typeof threshold === 'number'` (an estimated 20–30 B).
5. A `threshold` that is an object with a stateful `valueOf` is read a different number of times than in the baseline (already true of `climb/gen2-best`, which reads it about twice as often). In the re-reviewer's grid the cases where both builds return and differ from the baseline go from 90 on `climb/gen2-best` to 58 here: 35 cases now match that did not, and 3 that matched on `climb/gen2-best` no longer do (all 3 come from `2a16df1`/`bc85d8a`, not from the fix-up). No build can match without copying the baseline's exact read sequence; the reviewer did not treat it as blocking and said so explicitly.

**gen3-harden** (`msg_406ef0ad`, `msg_fe84c34f`; not merged): the `$fuzzy` read-order fix above (+34 B). With it the second reviewer saw nothing else blocking. Also noted: two `no-unused-expressions` eslint errors in `src/core/index.ts` that `climb/gen2-best` already has.

**gen3-index** (`msg_d4c7302c`; not merged): F1, F2 and F3 above. Nits: `isArray = Array.isArray` is captured at module load; merge `39639ce` quotes gzip 9716/9642 B where the verifier reads 9813/9752 B; merge `85d03e8` has an empty body.

**Still open from generations 1 and 2** (unchanged by this generation): bitap 3 (`Int32Array(256)` per chunk), extended 1 (`isInverse` through `.some`, `MULTI_MATCH_TYPES.has` per matcher), topk 2 (`_findMatches` wrapper allocates), gen2-core 4 (unused `results` array), gen2-size 1 and 2 (`Fuse.parseQuery` leaf `searcher.options`; `value.toLowerCase` wording). Extended 3 is **closed as wrong**: the harden worker showed, and its reviewer confirmed, that the `existing.matches.push` branch in `_searchLogical` is reachable through a parsed index with a repeated `i`, and that the baseline merges the same way.

## Final

`climb/final` is `climb/gen2-best` plus `climb/gen3-scan` at `f55c09d`
(merge `5c0c097`). Everything in this section was measured by the
generation 3 lead in its own sandbox on that merge commit, unless it says
otherwise. The original architect did not verify this tree.

### Gate on the final tree (`5c0c097`)

```
npm run typecheck                     -> OK
npm run build                         -> OK
npm test                              -> Test Files 32 passed (32) / Tests 849 passed (849)
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5492 seed=101 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5589 seed=102 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5581 seed=103 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5328 seed=104 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5660 seed=105 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5475 seed=106 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5563 seed=107 candidate=../dist/fuse.mjs
PARITY_FUZZ_OK rev=2 cases=400 comparisons=5542 seed=108 candidate=../dist/fuse.mjs
MATCH_FUZZ_OK cases=150000 seed=101 mismatches=0 candThrowsOnly=0 baseThrowsOnly=9876 baselineMatchRate=0.391 candidate=../dist/fuse.mjs
MATCH_FUZZ_OK cases=150000 seed=102 mismatches=0 candThrowsOnly=0 baseThrowsOnly=10147 baselineMatchRate=0.391 candidate=../dist/fuse.mjs
MATCH_FUZZ_OK cases=150000 seed=103 mismatches=0 candThrowsOnly=0 baseThrowsOnly=10133 baselineMatchRate=0.389 candidate=../dist/fuse.mjs
candidate retains -0.01 MB heap and 0.02 MB ArrayBuffer more than baseline
RETENTION_PROBE_OK
INDEX_API_FUZZ_OK removeAll=4000 reads=4000 seed=101 mismatches=0 candidate=../dist/fuse.mjs
INDEX_API_FUZZ_OK removeAll=4000 reads=4000 seed=102 mismatches=0 candidate=../dist/fuse.mjs
INDEX_API_FUZZ_OK removeAll=4000 reads=4000 seed=103 mismatches=0 candidate=../dist/fuse.mjs
field-length probe run 1: FIELD_LENGTH_PROBE_OK (0 SLOWER, 0 RESULT MISMATCH lines)
field-length probe run 2: FIELD_LENGTH_PROBE_OK (0 SLOWER, 0 RESULT MISMATCH lines)
f6831f6ca705fa7f76cb8ceb5a8aed4c85b8dad0ed53e2f7ec36e61f3fb99693  bench/hillclimb.mjs     (matches AGENTS.md)
2c4938f54cacee4ab2e68aa3b3c6126c04d9e4394baa3d691a36acc1907ef71f  bench/baseline-fuse.mjs (matches AGENTS.md)
git status --short dist/              -> empty
```

Test count: 530 on `climb/gen2-best`, + 4 (`test/bitap-scan-edges.test.ts`),
+ 315 (`test/bitap-threshold-types.test.ts`) = 849.

**Field-length probe rev 2**: `FIELD_LENGTH_PROBE_OK` on both runs, with no
`SLOWER` and no `RESULT MISMATCH` line (it printed `FAIL` on `climb/gen2-best`).
The `lone hit` cells, candidate/baseline time, limit 1.25:

| mode | field length | run 1 | run 2 |
|---|---|---|---|
| `lone hit dflt` | 40 | 0.79 | 0.77 |
| `lone hit dflt` | 200 | 0.79 | 0.79 |
| `lone hit dflt` | 1,000 | 0.87 | 0.81 |
| `lone hit dflt` | 5,000 | 0.93 | 0.87 |
| `lone hit dflt` | 25,000 | 0.97 | 1.09 |
| `lone hit` | 40 | 0.77 | 0.80 |
| `lone hit` | 200 | 0.80 | 0.78 |
| `lone hit` | 1,000 | 0.84 | 0.79 |
| `lone hit` | 5,000 | 0.98 | 0.90 |
| `lone hit` | 25,000 | 0.94 | 0.96 |
| `lone hit+match` | 40 | 0.75 | 0.60 |
| `lone hit+match` | 200 | 0.93 | 0.90 |
| `lone hit+match` | 1,000 | 0.72 | 0.75 |
| `lone hit+match` | 5,000 | 0.65 | 0.78 |
| `lone hit+match` | 25,000 | 0.41 | 0.44 |

Every other cell (30 per run) is 0.06–0.73 of the baseline.

### Verifier runs on `climb/final` (`5c0c097`)

All five runs PASS with 38 parity checks. `dist/fuse.min.mjs` is 9811 B gzip
(−3.06% vs the 10199 B base, cap 10628 B). Each cell is speedup
(baseline→candidate ms).

| run | bitap_fuzzy | bitap_matches | topk_limit10 | extended_logical | token_inverted | index_diacritics_mutate | composite | gzip |
|---|---|---|---|---|---|---|---|---|
| train #1 | 14.785x (746.2→50.5 ms) | 12.387x (771.3→62.3) | 15.766x (736.1→46.7) | 8.839x (218.0→24.7) | 21.851x (1734.7→79.4) | 1.000x (6.11→6.11) | **9.0728x** | 9811 B |
| train #2 | 16.924x (892.8→52.7 ms) | 14.011x (962.1→68.7) | 18.000x (845.2→47.0) | 8.355x (227.2→27.2) | 23.480x (1895.5→80.7) | 0.922x (5.52→5.98) | **9.5787x** | 9811 B |
| train #3 | 14.908x (745.9→50.0 ms) | 12.717x (771.6→60.7) | 15.965x (737.8→46.2) | 8.883x (221.2→24.9) | 22.135x (1743.1→78.7) | 1.004x (5.93→5.91) | **9.1771x** | 9811 B |
| holdout #1 | 14.588x (751.6→51.5 ms) | 12.301x (777.6→63.2) | 15.533x (750.2→48.3) | 8.895x (218.6→24.6) | 21.629x (1709.4→79.0) | 0.994x (5.28→5.31) | **9.0051x** | 9811 B |
| holdout #2 | 15.238x (764.1→50.1 ms) | 12.514x (796.3→63.6) | 16.370x (760.9→46.5) | 8.996x (219.3→24.4) | 22.257x (1738.7→78.1) | 1.012x (5.84→5.77) | **9.2651x** | 9811 B |

- Composite: train 9.073–9.579x (median 9.1771x), holdout 9.005–9.265x. Holdout agrees with train.
- `climb/gen2-best` read 8.9277x train and 8.9001x holdout in this sandbox on
  the same day (one run each), so the merge is worth a few percent here; the
  first scan reviewer's same-process A/B puts `token_inverted` 3–5% faster and
  `bitap_fuzzy` 0–10% faster, the rest within noise.
- `index_diacritics_mutate` is in the noise band (0.92–1.01x): no index work
  is merged.
- Other sandboxes read the same code differently. `f55c09d` (same tree apart
  from this log): re-reviewer 9.2059x train / 9.1903x holdout; fix-up worker
  9.2730x / 9.2147x. `climb/gen2-best` read 9.76–10.07x train and
  10.23–10.54x holdout in the three generation 3 reviewers' sandboxes, where
  the baseline itself ran about 1.5x slower than here.

### Per-merge `node bench/climb-profile.mjs all --rounds 7`

The indicative in-process profiler: baseline→candidate ms and speedup. The
baseline column drifts between runs.

| stage (HEAD) | fuzzy | matches | topk | extended | token | index | geomean | gzip |
|---|---|---|---|---|---|---|---|---|
| gen2-best (`c481aa4`) | 527.84→53.41 ms, 9.883x | 548.51→64.50, 8.505x | 499.13→48.93, 10.200x | 167.91→29.59, 5.675x | 1206.24→91.48, 13.185x | 6.55→6.70, 0.978x | 6.3039x | 9752 B |
| + gen3-scan (`5c0c097`) | 537.38→50.53 ms, 10.635x | 553.96→63.32, 8.749x | 621.85→53.00, 11.732x | 171.70→29.97, 5.729x | 1212.11→83.25, 14.559x | 7.11→6.77, 1.050x | 6.7619x | 9811 B |

### Bundle size

`dist/fuse.min.mjs` is 9811 B gzip: +59 B over `climb/gen2-best` (9752 B),
388 B below the 10199 B base, 817 B under the cap.

### Behaviour differences from the baseline (for the owner to accept or not)

The rule throughout was: byte-identical results wherever the baseline
returns, same error class and message wherever it throws. These inputs do not
meet it on `climb/final`. All five classes predate generation 3 (which moved
a few cases inside items 3 and 5, as noted) and the verifier exercises none
of them. Item 1 is counted by match-fuzz; items 3 and 4 need
input outside the declared TypeScript types, which no fuzzer generates.

1. **The baseline crashes, the candidate returns** (accepted by the original
   architect pending the owner, who had not answered): `location: NaN` and
   some fractional `location` values (`RangeError: Invalid array length`;
   counted by match-fuzz as `baseThrowsOnly`, see the gate lines), and a
   `null`/`undefined` record in a hand-built index (`TypeError`; the candidate
   skips it).
2. **`Fuse.parseQuery` internals in the development builds:** `BitapSearch`
   chunks carry an alphabet keyed by character code and an extra 256-entry
   `table` (1,054 of the first harden reviewer's 3,275 parsed trees differ,
   only there); leaf `searcher.options` hold raw values (gen2-size 1). Search
   results are unaffected.
3. **A non-string `text` or `pattern` handed to a searcher**, through
   `Fuse.match` or a hand-built index whose stored value is not a string (from
   the char-code kernel `07424cd` and generation 2's `canMatch`). The baseline
   treats an array as text by accident. The lead's 16,000-case grid on this
   tree (20 values × 20 values × 40 option sets through `Fuse.match`; same
   counts on `climb/gen2-best`): 135 cases where only the candidate throws
   (`text.charCodeAt is not a function`), 189 where only the baseline throws
   (`text.indexOf is not a function`), and 1,547 where both throw with
   different messages (`pattern.charAt`/`this.pattern.substr` against
   `pattern.substr`, 960; `pattern.toLowerCase` against `value.toLowerCase`,
   560; `text.indexOf` against `text.charCodeAt`, 27). The scan reviewer adds
   that array texts of 33 to 256 elements can now return a different result
   instead of throwing (65 of 1,026 cases). The nonstring worker's larger
   differential on `climb/gen2-best` read 2,740 candidate-only throws through
   `Fuse.match` and 1,500 through a parsed index. Exact fix: +500 B,
   unreviewed (above).
4. **A BigInt `threshold` or `distance`** (from generation 2's window
   arithmetic in `canMatch`): the candidate throws `Cannot mix BigInt and
   other types` where the baseline returns. The lead's 1,722-case odd-option
   grid on this tree (same counts on `climb/gen2-best`): 60 (`threshold`) and
   18 (`distance`) candidate-only throws, 12 changed messages, 63 cases where
   only the baseline throws. Strings, `null`, booleans, arrays and objects as
   option values all match or fall under item 1. No fix has been measured.

5. **A numeric option that is an object with a stateful `valueOf`** (for
   example a `threshold` whose value changes each time it is read): the
   candidate reads it a different number of times than the baseline, so the
   result can differ. In the scan re-reviewer's 9,348-case grid, 58 cases
   return a different result from the baseline on this tree, against 90 on
   `climb/gen2-best` (see gen3-scan follow-up 5).

Items 3 and 4 include cases where only the candidate throws, which the rule
does not allow. The lead chose to disclose them and not to hold the pull
request for a fix; that choice is the owner's to confirm or reverse.

### Who verified what

- Generations 1 and 2: per-branch reviews and the crossover gates recorded in
  the sections above.
- Generation 3 branches: three first reviews and two targeted re-reviews, each
  by an independent reviewer in its own sandbox (threads in the table above).
  `climb/gen3-nonstring` was measured by its worker and not reviewed.
- `climb/final` as a whole: the gate and the five verifier runs above, by the
  generation 3 lead; then an independent final review of
  `origin/main...origin/climb/final` (recorded in the pull request, since it
  ran after this file was committed).
- The original architect did not verify this tree.

### Addendum: final review of `climb/final` (`5a341ef`)

An independent reviewer (thread `msg_b349f914-d7d3-415e-96b0-5dbdef967a6c_1`)
reviewed `origin/main...origin/climb/final` at `5a341ef` in its own sandbox:
**ACCEPT WITH FOLLOW-UPS**. This commit only records that review; it changes
no library code, test, tool or `dist/` file.

What it ran:
- Integrity, build and tests: both SHA-256 values equal `AGENTS.md`; no change
  to the locked files, build configuration or any test that exists on `main`
  (10 test files added); typecheck and build OK; 32 files / 849 tests pass
  (22 / 449 on `main`); `dist/` equals a fresh build.
- Guards on its own seeds: `PARITY_FUZZ_OK rev=2` on 211, 377, 4096, 9137,
  20261121 and 65537; `MATCH_FUZZ_OK cases=200000` on 313, 7777 and 31337
  (0 mismatches, 0 candidate-only throws; 13352 / 13322 / 13302 baseline-only
  throws); `INDEX_API_FUZZ_OK removeAll=5000` on the same three seeds;
  `RETENTION_PROBE_OK` (0.02 MB); `FIELD_LENGTH_PROBE_OK` in 3 of 3 runs
  (`lone hit` cells 0.39–0.99).
- Verifier, all PASS with 38 parity checks and 9811 B:

| run | bitap_fuzzy | bitap_matches | topk_limit10 | extended_logical | token_inverted | index_diacritics_mutate | composite |
|---|---|---|---|---|---|---|---|
| train #1 | 18.215x (1211.2→66.5 ms) | 14.519x (1206.4→83.1) | 18.637x (1165.2→62.5) | 9.694x (332.7→34.3) | 28.759x (2891.5→100.5) | 1.097x (8.80→8.02) | **10.7082x** |
| train #2 | 17.474x (1138.6→65.2 ms) | 14.506x (1212.2→83.6) | 19.182x (1146.1→59.8) | 10.122x (332.0→32.8) | 27.453x (2733.5→99.6) | 1.098x (7.75→7.06) | **10.6796x** |
| train #3 | 17.684x (1139.9→64.5 ms) | 14.588x (1180.2→80.9) | 18.714x (1124.6→60.1) | 10.013x (329.0→32.9) | 26.757x (2711.4→101.3) | 1.091x (8.66→7.94) | **10.5907x** |
| holdout #1 | 17.357x (1150.9→66.3 ms) | 13.107x (1265.4→96.5) | 19.861x (1210.3→60.9) | 8.992x (329.8→36.7) | 26.368x (2724.2→103.3) | 1.107x (7.74→7.00) | **10.2881x** |
| holdout #2 | 17.046x (1123.5→65.9 ms) | 14.222x (1176.3→82.7) | 18.289x (1145.3→62.6) | 11.258x (419.0→37.2) | 26.147x (2785.9→106.5) | 1.443x (11.64→8.07) | **11.1121x** |

  Its baseline ran about 1.5x slower than the lead's (1211 against 746 ms on
  `bitap_fuzzy`), which is why it reads 10.3–11.1x where the lead read
  9.0–9.6x for the same code. The 1.443x on the index workload is noise (the
  baseline took 11.64 ms in that run).
- Its own differential against the baseline over the whole search surface
  (2,700 cases and 23,010 comparisons with index mutations, parsed indexes,
  extended, logical and token search; 10,000 `Fuse.match` cases; 936 cases of
  non-string values through `getFn`, the default getter and string lists):
  0 mismatches, 0 candidate-only throws, 0 changed messages; 926 baseline-only
  throws, all `RangeError: Invalid array length`. Controls: `climb/gen1-best`
  gives 31 candidate-only throws and 2 mismatches, a `<=` → `<` mutant of the
  edit bound gives 19 mismatches in 300 cases; a one-character `!$` mutant was
  not caught (a gap in its generator).
- Its own grids for the disclosed classes, same counts on `climb/gen2-best`:
  non-string input, 15,000 cases: 400 candidate-only throws, 400
  baseline-only, 2,480 changed messages, 0 differing results; BigInt options,
  640 cases: 66 candidate-only throws, 28 baseline-only, 64 changed messages;
  other odd option values, 2,560 cases: 130 baseline-only throws and nothing
  else. It found no divergence outside the five disclosed classes, and would
  not reverse the decision to disclose them.
- Timings outside the benchmark: index build 0.80–1.00 of the baseline on
  short words, tabs, NBSP and long fields (one 0.5 ms run read 1.39 and did
  not reproduce); long-field searches 0.03–1.05 with identical results;
  patterns of 31 to 33 characters over 20,000 short texts 0.01–0.17. No
  finding.

What it added to the record:
- **Public surface.** `dist/fuse.d.ts` and `dist/fuse.d.cts` differ from
  `main` in two internal declarations: `MaxHeap` loses `get size()`,
  `_bubbleUp` and `_sinkDown` (topk follow-up 4), and `_searchStringList` /
  `_searchObjectList` declare their second parameter as
  `opts?: HeapSearchOptions` instead of a destructuring pattern of the same
  type. No exported name or member type changes. `MaxHeap` is not exported by
  name but is reachable through `HeapSearchOptions.heap` on underscore
  methods of the exported `Fuse` class.
- **Class 4 (BigInt options)** is reached through the ordinary constructor
  (`new Fuse(list, { threshold: 0n })`), unlike class 3, and has no measured
  fix. Follow-up: price a `typeof`-guarded fix.
- **History.** 58 commits, 13 of them two-parent merges; nothing squashed;
  every commit that changes `src/` also commits `dist/`. Commit bodies that
  fall short of `AGENTS.md`: merges `efbd65e`, `3f05f16` and `1ad9685` have
  empty bodies (tooling only); test-only `2b9b9e5`, `3398a27` and `06f1872`
  carry no verifier numbers of their own; `6888153`, `5e1b88c`, `10a87ec`
  (gen2-size) and `167366d` give speedups and the composite but not the
  target workload's milliseconds. Pushed history is not rewritten, so these
  stay.
- **gen2-myers F1** is addressed by `bc85d8a`: the first scan reviewer read
  the 100k-character `ignoreLocation` + `includeMatches` case at 0.73–0.85 of
  `climb/gen2-best`'s time. Nobody re-measured it against `climb/gen1-best`,
  where the original finding was 1.60x, so it is reduced and not shown closed.
