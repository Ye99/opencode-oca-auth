import { expect, test } from "bun:test"

import {
  DEFAULT_OCA_MODEL_ID,
  installConfig,
} from "../scripts/install-opencode-oca-auth.js"
import { uninstallConfig } from "../scripts/uninstall-opencode-oca-auth.js"

import legacy from "../config/opencode-legacy.json"
import modern from "../config/opencode-modern.json"

test("install adds plugin and oca model for modern config", () => {
  const next = installConfig(modern)
  const plugins = (next.plugin ?? []) as string[]
  const models = (next.provider?.oca?.models ?? {}) as Record<string, unknown>

  expect(plugins).toContain("opencode-oca-auth")
  expect(models[DEFAULT_OCA_MODEL_ID]).toBeDefined()
})

test("install adds latest codex default and not legacy default", () => {
  const next = installConfig(modern)
  const models = (next.provider?.oca?.models ?? {}) as Record<string, unknown>
  const codex = (models["gpt-5.3-codex"] ?? {}) as { api?: { npm?: string } }

  expect(models["gpt-5.3-codex"]).toBeDefined()
  expect(codex.api?.npm).toBe("@ai-sdk/openai")
  expect(models["gpt-oss-120b"]).toBeUndefined()
})

test("install is idempotent", () => {
  const once = installConfig(modern)
  const twice = installConfig(once)
  const plugins = (twice.plugin ?? []) as string[]
  const models = (twice.provider?.oca?.models ?? {}) as Record<string, unknown>

  expect(plugins.filter((x) => x === "opencode-oca-auth")).toHaveLength(1)
  expect(Object.keys(models).filter((x) => x === DEFAULT_OCA_MODEL_ID)).toHaveLength(1)
})

test("install handles legacy keys", () => {
  const next = installConfig(legacy)
  const plugins = (next.plugins ?? []) as string[]
  const models = (next.providers?.oca?.models ?? {}) as Record<string, unknown>

  expect(plugins).toContain("opencode-oca-auth")
  expect(models[DEFAULT_OCA_MODEL_ID]).toBeDefined()
})

test("uninstall removes plugin and default oca model", () => {
  const installed = installConfig(modern)
  const next = uninstallConfig(installed)
  const plugins = (next.plugin ?? []) as string[]
  const models = (next.provider?.oca?.models ?? {}) as Record<string, unknown>

  expect(plugins).not.toContain("opencode-oca-auth")
  expect(plugins).toContain("existing-plugin")
  expect(next.provider?.openai?.models?.["gpt-4.1"]).toBeDefined()
  expect(models[DEFAULT_OCA_MODEL_ID]).toBeUndefined()
  expect(next.provider?.oca).toBeUndefined()
})

test("uninstall handles legacy keys", () => {
  const installed = installConfig(legacy)
  const next = uninstallConfig(installed)

  expect((next.plugins ?? [])).not.toContain("opencode-oca-auth")
  expect(next.plugins).toContain("existing-plugin")
  expect(next.providers?.openai?.models?.["gpt-4.1"]).toBeDefined()
  expect(next.providers?.oca).toBeUndefined()
})

test("install preserves array models and adds default once", () => {
  const input = {
    plugin: ["existing-plugin"],
    provider: {
      oca: {
        models: [{ id: "custom", name: "Custom Model" }],
      },
    },
  }

  const once = installConfig(input)
  const twice = installConfig(once)
  const models = (twice.provider?.oca?.models ?? []) as Array<{ id?: string; name?: string }>

  expect(models.find((x) => x.id === "custom")?.name).toBe("Custom Model")
  expect(models.filter((x) => x.id === DEFAULT_OCA_MODEL_ID)).toHaveLength(1)
})

test("install and uninstall preserve non-default array models", () => {
  const input = {
    plugin: ["existing-plugin"],
    provider: {
      oca: {
        models: [{ id: "custom", name: "Custom Model" }],
      },
    },
  }

  const installed = installConfig(input)
  const next = uninstallConfig(installed)
  const models = (next.provider?.oca?.models ?? []) as Array<{ id?: string; name?: string }>

  expect(models).toEqual([{ id: "custom", name: "Custom Model" }])
  expect((next.plugin ?? [])).toContain("existing-plugin")
})

test("uninstall removes empty array-based oca provider", () => {
  const input = {
    plugin: ["opencode-oca-auth"],
    provider: {
      oca: {
        models: [{ id: "oca-default" }],
      },
    },
  }

  const next = uninstallConfig(input)

  expect(next.provider?.oca).toBeUndefined()
})

test("uninstall removes previous default model id", () => {
  const input = {
    plugin: ["opencode-oca-auth"],
    provider: {
      oca: {
        models: [
          { id: "gpt-oss-120b", name: "Legacy Default" },
          { id: "custom", name: "Custom" },
        ],
      },
    },
  }

  const next = uninstallConfig(input)
  const models = (next.provider?.oca?.models ?? []) as Array<{ id?: string; name?: string }>

  expect(models).toEqual([{ id: "custom", name: "Custom" }])
})
