#!/usr/bin/env node

import { realpathSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MODULE_PATH = fileURLToPath(import.meta.url)
const __dirname = dirname(MODULE_PATH)
const PACKAGE_ROOT = resolve(__dirname, "..")
const DEFAULT_CONFIG = join(homedir(), ".config", "opencode", "opencode.json")

const PLUGIN = "opencode-oca-auth"

export const DEFAULT_OCA_MODEL_ID = "gpt-5.3-codex"

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

const clone = (value) => structuredClone(value)

const toObject = (value) => (isObject(value) ? value : {})

const toPlugins = (value) => {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string")
  return []
}

export const installConfig = (input, pluginId = PLUGIN) => {
  const config = toObject(clone(input ?? {}))
  if (typeof config.$schema !== "string" || !config.$schema) {
    config.$schema = "https://opencode.ai/config.json"
  }

  const pluginKey = Array.isArray(config.plugins) ? "plugins" : "plugin"
  const plugins = toPlugins(config[pluginKey])
  if (!plugins.includes(pluginId)) plugins.push(pluginId)
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
      oca.models = [...oca.models, { id: DEFAULT_OCA_MODEL_ID }]
    }
    return config
  }

  const models = toObject(oca.models)
  oca.models = models
  if (!isObject(models[DEFAULT_OCA_MODEL_ID])) {
    models[DEFAULT_OCA_MODEL_ID] = {}
  }

  return config
}

const isMain = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(MODULE_PATH)
  }
  catch {
    return false
  }
})()

if (isMain) {
  const file = process.argv[2] ?? DEFAULT_CONFIG
  const text = await readFile(file, "utf8").catch(() => "{}")
  const current = JSON.parse(text || "{}")
  const pluginId = pathToFileURL(PACKAGE_ROOT).href
  const next = installConfig(current, pluginId)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  console.log(`Updated ${file}`)
}
