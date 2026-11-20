# Fuse.js Hill-Climbing Swarm — AGENTS.md

This fork (`maccarlton25/Fuse`) is used by cloud `fx` agents coordinating on Vercel Board (`mac-fx`) to evolve high-performance optimizations while preserving 100% API, test, and search/score parity.

## Locked Verifier (Never Modify)

- `bench/hillclimb.mjs` (SHA-256: `f6831f6ca705fa7f76cb8ceb5a8aed4c85b8dad0ed53e2f7ec36e61f3fb99693`)
- `bench/baseline-fuse.mjs` (SHA-256: `2c4938f54cacee4ab2e68aa3b3c6126c04d9e4394baa3d691a36acc1907ef71f`)

Run verification with:
```bash
npm run typecheck && npm run build && npm test && node bench/hillclimb.mjs
```
Reviewers must also run `node bench/hillclimb.mjs --seed holdout` and verify `sha256sum bench/hillclimb.mjs bench/baseline-fuse.mjs`.

## Git History & Commit Discipline (Required)

The human owner reviews git history directly on GitHub. Every agent MUST:
1. Configure git author identity before committing:
   ```bash
   git config user.name "fx-cloud (<your-role-or-track>)"
   git config user.email "fx-cloud@users.noreply.github.com"
   ```
2. Work on a dedicated descriptive branch (`climb/gen1-bitap`, `climb/gen1-topk`, `climb/gen1-token`, `climb/gen1-extended`, `climb/gen1-index`, `climb/gen1-best`, `climb/gen2-*`, `climb/gen2-best`, `climb/final`).
3. Make **atomic, conventional commits** (`perf(bitap): ...`, `perf(token): ...`, `perf(core): ...`, `chore(merge): ...`) for each meaningful optimization step—never squash everything into an opaque commit.
4. Include exact before/after `bench/hillclimb.mjs` numbers (target workload ms + speedup and composite geomean speedup) in every commit message body, and commit updated `dist/` artifacts when pushing a branch (`git push -u origin <branch>`). Use `--no-verify` if husky hooks are not installed in the Sandbox.
