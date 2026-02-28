# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install       # install dependencies
bun test          # run all tests
bun run typecheck # TypeScript type check (no emit)
```

Run a single test file:

```bash
bun test test/auth.test.ts
```

## Architecture

This is a standalone OpenCode plugin that provides OCA (Oracle Code Assist) authentication and model setup. It is written in TypeScript ESM and runs under Bun; there is no build step — `index.ts` is loaded directly.

### Plugin entry

`index.ts` exports `plugin: Plugin` (from `@opencode-ai/plugin`). When OpenCode loads this plugin it calls `plugin(input)` and receives an auth descriptor with a `provider`, a `loader`, and an array of `methods` (OAuth and API key).

### Source modules

- **`src/auth.ts`** — The auth loader returned to OpenCode. On every invocation it:
  1. Calls `discoverBaseUrl(token)` which probes multiple base URLs in parallel (each URL tries `/models`, `/v1/models`, `/v1/model/info` sequentially; `Promise.any` returns the first winner) to find a live OCA endpoint and populates `discoveredModels`.
  2. Calls `upsertModels(provider, baseURL)` to merge discovered models into the OpenCode provider registry, preserving any user-set fields.
  3. For OAuth auth, wraps `fetch` to inject a fresh `Authorization: Bearer` header and handles transparent token refresh (deduplication: a single in-flight refresh promise is reused by concurrent callers).
  - `resetDiscoveryCache()` is exported for test cleanup.
  - `isSafeBaseUrl()` validates base URLs: requires `http:`/`https:`, blocks plain HTTP for non-localhost, and blocks cloud metadata ranges (169.254.x.x).

- **`src/oauth.ts`** — Full PKCE OAuth flow:
  - `oauthMethod()` returns the method object OpenCode presents in the auth picker. It includes `prompts` for `idcsUrl` and `clientId` (shown with defaults as placeholders).
  - `authorize()` starts a local `Bun.serve` callback server on `127.0.0.1:48801` at path `/auth/oca`, builds the IDCS authorization URL, and returns a promise-based callback (5-minute timeout) that exchanges the code for tokens.
  - `refreshAccessToken()` and `exchangeCodeForTokens()` call the IDCS `/oauth2/v1/token` endpoint.
  - `oauthConfig()` resolves `idcsUrl` and `clientId` from: auth store `enterpriseUrl`/`accountId` → env vars → hardcoded public defaults.

- **`src/constants.ts`** — Public OAuth defaults (IDCS URL, client ID, OAuth port `48801`, redirect path `/auth/oca`, callback timeout `OAUTH_CALLBACK_TIMEOUT_MS` = 5 minutes).

- **`src/env.ts`** — Lazy `.env` loader. Reads the `.env` file at the package root once; shell environment variables always take precedence. Call `resetEnvCache()` in tests that modify `process.env`.

### Scripts

- **`scripts/utils.js`** — Shared helpers (`isObject`, `clone`, `toObject`) used by both install and uninstall scripts.
- **`scripts/install-opencode-oca-auth.js`** — Reads an OpenCode JSON config, inserts this package as a plugin entry (using its `file://` URL as the plugin ID when run locally), and adds `provider.oca.models["gpt-5.3-codex"]`. Handles both `plugin`/`provider` (modern) and `plugins`/`providers` (legacy) config key variants. Also handles array-style model lists.
- **`scripts/uninstall-opencode-oca-auth.js`** — Inverse: removes the plugin entry and all known default OCA model IDs (`gpt-5.3-codex`, `gpt-5-codex`, `gpt-oss-120b`, `oca-default`).

### Config fixtures

`config/opencode-modern.json` and `config/opencode-legacy.json` are fixtures used by tests to exercise both OpenCode config key conventions.

### Key design details

- **Model npm package selection**: Models that support the `RESPONSES` API, or whose IDs contain `gpt-5` or `codex`, use `@ai-sdk/openai`; others use `@ai-sdk/openai-compatible`.
- **`oca/` prefix stripping**: Model IDs returned by the endpoint may be prefixed with `oca/`; the loader strips this prefix before registering.
- **Reasoning model detection**: Detected by `model_info.is_reasoning_model` from the API, or by ID heuristic: `codex`, `gpt-5`, `reasoner`, `thinking`, `r1`, or OpenAI o-series (`o1`, `o3`, `o4`).
- **Re-login hint**: Any error during token refresh includes a message directing the user to run `opencode auth login` and select `oca`.
- **`OCA_BASE_URL`** (singular) short-circuits discovery entirely; **`OCA_BASE_URLS`** (comma-separated) prepends additional URLs to try before the built-in defaults. Both are read via `loadEnv()` so `.env` values are honoured.
- **Token persistence**: After a refresh, the new tokens (including `enterpriseUrl` and `accountId`) are saved back to the OpenCode auth store via `input.client.auth.set`.
