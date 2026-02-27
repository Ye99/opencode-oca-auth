#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"

const PLUGIN = "opencode-oca-auth"

export const DEFAULT_OCA_MODEL_ID = "gpt-oss-120b"
export const DEFAULT_OCA_MODEL = {}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

const clone = (value) => structuredClone(value)

const toObject = (value) => (isObject(value) ? value : {})

const toPlugins = (value) => {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string")
  return []
}

export const installConfig = (input) => {
  const config = toObject(clone(input ?? {}))
  if (typeof config.$schema !== "string" || !config.$schema) {
    config.$schema = "https://opencode.ai/config.json"
  }

  const pluginKey = Array.isArray(config.plugins) ? "plugins" : "plugin"
  const plugins = toPlugins(config[pluginKey])
  if (!plugins.includes(PLUGIN)) plugins.push(PLUGIN)
  config[pluginKey] = plugins

  const providerKey = isObject(config.providers) ? "providers" : "provider"
  const provider = toObject(config[providerKey])
  config[providerKey] = provider

  const oca = toObject(provider.oca)
  provider.oca = oca

  if (Array.isArray(oca.models)) {
    const hasDefault = oca.models.some(
      (x) => isObject(x) && x.id === DEFAULT_OCA_MODEL_ID,
    )
    if (!hasDefault) {
      oca.models = [...oca.models, { id: DEFAULT_OCA_MODEL_ID, ...clone(DEFAULT_OCA_MODEL) }]
    }
    return config
  }

  const models = toObject(oca.models)
  oca.models = models
  if (!isObject(models[DEFAULT_OCA_MODEL_ID])) {
    models[DEFAULT_OCA_MODEL_ID] = clone(DEFAULT_OCA_MODEL)
  }

  return config
}

if (import.meta.main) {
  const file = process.argv[2] ?? "opencode.json"
  const text = await readFile(file, "utf8").catch(() => "{}")
  const current = JSON.parse(text || "{}")
  const next = installConfig(current)
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8")
}
