# opencode-oca-auth

Standalone OpenCode plugin for OCA authentication and model setup.

## Install

### Standard

```bash
git clone <this-repo>
cd opencode-oca-auth
node ./scripts/install-opencode-oca-auth.js ~/.config/opencode/opencode.json
```

### Development (live edits)

`npm link` adds `opencode-oca-auth-install` and `opencode-oca-auth-uninstall` to your `PATH`:

```bash
git clone <this-repo>
cd opencode-oca-auth
npm link
opencode-oca-auth-install ~/.config/opencode/opencode.json
```

The installer adds:

- this repository as an OpenCode plugin entry
- `provider.oca.models.gpt-5.3-codex` to your OpenCode config

## Login and use OCA models

```bash
opencode auth login
opencode models
```

Run `opencode auth login` without extra arguments, then choose `oca` in the provider picker.

Select an `oca/*` model and run prompts as usual.

To confirm the default OCA model works after setup, run:

```bash
opencode -m oca/gpt-5.3-codex run "Reply with: ok"
```

Expected result: the model replies with `ok`.

## OCA OAuth defaults

The plugin includes public default OAuth values:

- `OCA_IDCS_URL=https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com`
- `OCA_CLIENT_ID=a8331954c0cf48ba99b5dd223a14c6ea`

These values are mirrored from Cline's public constants file:
`https://github.com/cline/cline/blob/main/src/services/auth/oca/utils/constants.ts`.
You can override them with `OCA_IDCS_URL` and `OCA_CLIENT_ID`.

## Override defaults with `.env`

You can define local defaults in a `.env` file.
Supported variables:

- `OCA_IDCS_URL`
- `OCA_CLIENT_ID`
- `OCA_BASE_URL` — skip discovery and use this URL directly
- `OCA_BASE_URLS` — comma-separated list of URLs to probe before the built-in defaults

At runtime, shell environment variables override `.env` values.
Avoid committing secret values (for example access tokens or API keys).

## Uninstall

```bash
node ./scripts/uninstall-opencode-oca-auth.js ~/.config/opencode/opencode.json
```

This removes the plugin entry and the default OCA model entry.

## Development

```bash
bun install
bun test
bun run typecheck
```
