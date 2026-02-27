import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const file = fileURLToPath(new URL("../.env", import.meta.url))

let loaded = false

const strip = (value: string) => {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return value
}

export function resetEnvCache() {
  loaded = false
}

export function loadEnv() {
  if (loaded) return
  loaded = true
  if (!existsSync(file)) return

  const text = readFileSync(file, "utf8")
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const index = line.indexOf("=")
      if (index < 1) return
      const key = line.slice(0, index).trim()
      if (!key || process.env[key] !== undefined) return
      process.env[key] = strip(line.slice(index + 1).trim())
    })
}
