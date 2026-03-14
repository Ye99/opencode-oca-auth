# OCA Auth Core Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract reusable OCA OAuth and discovery logic into a standalone core package, then switch `opencode-oca-auth` to use it without breaking existing behavior.

**Architecture:** Create an in-repo workspace package named `packages/oca-auth-core` that contains pure OAuth, discovery, and metadata normalization logic. Keep `opencode-oca-auth` as a thin OpenCode adapter responsible only for plugin wiring, provider mutation, and auth-store persistence.

**Tech Stack:** Bun, TypeScript ESM, Bun test, OpenCode CLI

---

### Task 1: Create core package scaffolding

**Files:**
- Create: `packages/oca-auth-core/package.json`
- Create: `packages/oca-auth-core/tsconfig.json`
- Create: `packages/oca-auth-core/index.ts`
- Create: `packages/oca-auth-core/src/types.ts`

**Step 1: Write the failing test**

Add a package-level smoke test import in `test/core.test.ts` that imports from `../packages/oca-auth-core`.

**Step 2: Run test to verify it fails**

Run: `bun test test/core.test.ts`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

Create the package files and export a trivial symbol so the import resolves.

**Step 4: Run test to verify it passes**

Run: `bun test test/core.test.ts`
Expected: PASS.

### Task 2: Move reusable OAuth and discovery logic into the core package

**Files:**
- Create: `packages/oca-auth-core/src/constants.ts`
- Create: `packages/oca-auth-core/src/env.ts`
- Create: `packages/oca-auth-core/src/oauth.ts`
- Create: `packages/oca-auth-core/src/discovery.ts`
- Modify: `test/oauth.test.ts`
- Modify: `test/auth.test.ts`
- Modify: `test/core.test.ts`

**Step 1: Write the failing test**

Add focused tests for exported core functions:
- refresh token success/failure
- exchange code success/failure
- discovery prefers `/v1/model/info`
- model parsing returns normalized IDs and metadata

**Step 2: Run test to verify it fails**

Run: `bun test test/core.test.ts`
Expected: FAIL because the exports do not exist yet.

**Step 3: Write minimal implementation**

Move pure logic from `src/oauth.ts`, `src/auth.ts`, `src/constants.ts`, and `src/env.ts` into the core package while keeping OpenCode-specific persistence out of the core.

**Step 4: Run test to verify it passes**

Run: `bun test test/core.test.ts`
Expected: PASS.

### Task 3: Refactor the OpenCode plugin to use the shared core

**Files:**
- Modify: `package.json`
- Modify: `src/auth.ts`
- Modify: `src/oauth.ts`
- Modify: `src/constants.ts`
- Modify: `src/env.ts`
- Modify: `index.ts`

**Step 1: Write the failing test**

Keep the existing OpenCode plugin tests unchanged and add one regression test that asserts the loader still refreshes and persists tokens through the OpenCode client.

**Step 2: Run test to verify it fails**

Run: `bun test test/auth.test.ts`
Expected: FAIL after swapping imports until the adapter is complete.

**Step 3: Write minimal implementation**

Replace duplicated logic with imports from `packages/oca-auth-core`, leaving only OpenCode-specific state updates and provider-model mutation in the plugin package.

**Step 4: Run test to verify it passes**

Run: `bun test test/auth.test.ts test/oauth.test.ts test/plugin.test.ts test/install.test.ts test/e2e-shape.test.ts`
Expected: PASS.

### Task 4: Add isolated OpenCode CLI end-to-end regression coverage

**Files:**
- Create: `test/opencode-cli.e2e.test.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

Add an end-to-end test that:
- creates temporary XDG paths
- installs the plugin into a temp OpenCode config
- runs `opencode providers list`
- runs `opencode models oca`
- asserts the provider and default model are visible

**Step 2: Run test to verify it fails**

Run: `bun test test/opencode-cli.e2e.test.ts`
Expected: FAIL before the harness or assertions are complete.

**Step 3: Write minimal implementation**

Implement the isolated CLI harness and document the extra regression test in `README.md`.

**Step 4: Run test to verify it passes**

Run: `bun test test/opencode-cli.e2e.test.ts`
Expected: PASS.

### Task 5: Full verification

**Files:**
- Verify only

**Step 1: Run unit and regression tests**

Run: `bun test`
Expected: PASS.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

**Step 3: Run isolated OpenCode smoke test**

Run: `bun test test/opencode-cli.e2e.test.ts`
Expected: PASS.

**Step 4: Inspect diff**

Run: `git status --short`
Expected: only intended files changed.
