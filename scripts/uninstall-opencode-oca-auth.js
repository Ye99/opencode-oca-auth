#!/usr/bin/env node

import { realpathSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MODULE_PATH = fileURLToPath(import.meta.url)
const __dirname = dirname(MODULE_PATH)
const PACKAGE_ROOT = resolve(__dirname, "..")
const DEFAULT_CONFIG = join(homedir(), ".config", "opencode", "opencode.json")

const PLUGIN = "opencode-oca-auth"
const DEFAULT_OCA_MODEL_ID = "gpt-5.3-codex"
const PREVIOUS_DEFAULT_OCA_MODEL_ID = "gpt-5-codex"
const LEGACY_PREVIOUS_DEFAULT_OCA_MODEL_ID = "gpt-oss-120b"
const LEGACY_OCA_MODEL_ID = "oca-default"

import { isObject, clone, toObject } from "./utils.js"

const cleanProvider = (config, key) => {
  if (!isObject(config[key])) return

  const provider = config[key]
  if (!isObject(provider.oca)) return

  const oca = provider.oca
  if (Array.isArray(oca.models)) {
    oca.models = oca.models.filter((x) => {
      if (!isObject(x)) return true
      return x.id !== DEFAULT_OCA_MODEL_ID
        && x.id !== PREVIOUS_DEFAULT_OCA_MODEL_ID
        && x.id !== LEGACY_PREVIOUS_DEFAULT_OCA_MODEL_ID
        && x.id !== LEGACY_OCA_MODEL_ID
    })
    if (!oca.models.length) delete oca.models
  }
  if (isObject(oca.models)) {
    delete oca.models[DEFAULT_OCA_MODEL_ID]
    delete oca.models[PREVIOUS_DEFAULT_OCA_MODEL_ID]
    delete oca.models[LEGACY_PREVIOUS_DEFAULT_OCA_MODEL_ID]
    delete oca.models[LEGACY_OCA_MODEL_ID]
    if (!Object.keys(oca.models).length) delete oca.models
  }

  if (!Object.keys(oca).length) delete provider.oca
  if (!Object.keys(provider).length) delete config[key]
}

export const uninstallConfig = (input, pluginId = PLUGIN) => {
  const config = toObject(clone(input ?? {}))

  const isPlugin = (x) => x === PLUGIN || x === pluginId
  if (Array.isArray(config.plugin)) {
    config.plugin = config.plugin.filter((x) => !isPlugin(x))
  }
  if (Array.isArray(config.plugins)) {
    config.plugins = config.plugins.filter((x) => !isPlugin(x))
  }

  cleanProvider(config, "provider")
  cleanProvider(config, "providers")

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
  const next = uninstallConfig(current, pluginId)
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  console.log(`Updated ${file}`)
}
