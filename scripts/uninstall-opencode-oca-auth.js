#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"

const PLUGIN = "opencode-oca-auth"
const DEFAULT_OCA_MODEL_ID = "gpt-oss-120b"
const LEGACY_OCA_MODEL_ID = "oca-default"

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

const clone = (value) => structuredClone(value)

const toObject = (value) => (isObject(value) ? value : {})

const cleanProvider = (config, key) => {
  if (!isObject(config[key])) return

  const provider = config[key]
  if (!isObject(provider.oca)) return

  const oca = provider.oca
  if (Array.isArray(oca.models)) {
    oca.models = oca.models.filter((x) => {
      if (!isObject(x)) return true
      return x.id !== DEFAULT_OCA_MODEL_ID && x.id !== LEGACY_OCA_MODEL_ID
    })
    if (!oca.models.length) delete oca.models
  }
  if (isObject(oca.models)) {
    delete oca.models[DEFAULT_OCA_MODEL_ID]
    delete oca.models[LEGACY_OCA_MODEL_ID]
    if (!Object.keys(oca.models).length) delete oca.models
  }

  if (!Object.keys(oca).length) delete provider.oca
  if (!Object.keys(provider).length) delete config[key]
}

export const uninstallConfig = (input) => {
  const config = toObject(clone(input ?? {}))

  if (Array.isArray(config.plugin)) {
    config.plugin = config.plugin.filter((x) => x !== PLUGIN)
  }
  if (Array.isArray(config.plugins)) {
    config.plugins = config.plugins.filter((x) => x !== PLUGIN)
  }

  cleanProvider(config, "provider")
  cleanProvider(config, "providers")

  return config
}

if (import.meta.main) {
  const file = process.argv[2] ?? "opencode.json"
  const text = await readFile(file, "utf8").catch(() => "{}")
  const current = JSON.parse(text || "{}")
  const next = uninstallConfig(current)
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8")
}
