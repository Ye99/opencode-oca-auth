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

## Optional `.env` support

You can define local defaults in a `.env` file.
Supported variables:

- `OCA_IDCS_URL`
- `OCA_CLIENT_ID`
- `OCA_BASE_URLS`

Shell environment variables override `.env` values at runtime.
Never commit `.env` files to version control.

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
