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
| `climb/base` | `7d6e386` | — | — | Yes, merge `a57e9c4` (brings `bench/field-length-probe.mjs`) |

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
