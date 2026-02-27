# opencode-oca-auth

Standalone OpenCode plugin for OCA authentication and model wiring.

## Install

```bash
npm i -g opencode-oca-auth
opencode-oca-auth-install
```

The installer adds:

- `opencode-oca-auth` to your OpenCode plugin list
- `provider.oca.models.gpt-oss-120b` to your OpenCode config

## Login and use OCA models

```bash
opencode auth login
opencode models
```

Select an `oca:*` model and run prompts normally.

## OCA OAuth defaults

The plugin includes public default OAuth values:

- `OCA_IDCS_URL=https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com`
- `OCA_CLIENT_ID=a8331954c0cf48ba99b5dd223a14c6ea`

These are mirrored from Cline's public constants file:
`https://github.com/cline/cline/blob/main/src/services/auth/oca/utils/constants.ts`.
You can override them with `OCA_IDCS_URL` and `OCA_CLIENT_ID`.

## Override defaults with `.env`

You can define local defaults in a `.env` file.
Supported variables:

- `OCA_IDCS_URL`
- `OCA_CLIENT_ID`
- `OCA_BASE_URLS`

At runtime, shell environment variables override `.env` values.
`OCA_IDCS_URL`, `OCA_CLIENT_ID`, and `OCA_BASE_URLS` are public configuration values and can be committed if needed.
Avoid committing secret values (for example access tokens or API keys).

## Uninstall

```bash
opencode-oca-auth-uninstall
```

This removes the plugin entry and the default OCA model entry.

## Development

```bash
bun install
bun test
bunx tsc --noEmit
```
