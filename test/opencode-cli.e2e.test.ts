import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

import modernConfig from "../config/opencode-modern.json"
import { installConfig } from "../scripts/install-opencode-oca-auth.js"

const repoRoot = resolve(import.meta.dir, "..")
const fixtureConfig = join(repoRoot, "config", "opencode-modern.json")
const installScript = join(repoRoot, "scripts", "install-opencode-oca-auth.js")

function run(command: string, args: string[], env: Record<string, string>) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  })

  if (result.status !== 0) {
    throw new Error(
      [
        `command failed: ${command} ${args.join(" ")}`,
        `status: ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  return result.stdout
}

test("OpenCode loads the plugin in an isolated config and lists OCA models", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "opencode-oca-auth-"))

  try {
    const home = join(tempRoot, "home")
    const configHome = join(tempRoot, "config")
    const dataHome = join(tempRoot, "data")
    const cacheHome = join(tempRoot, "cache")
    const stateHome = join(tempRoot, "state")
    const configDir = join(configHome, "opencode")
    const configPath = join(configDir, "opencode.json")

    mkdirSync(home, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    cpSync(fixtureConfig, configPath)

    const env = {
      HOME: home,
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: dataHome,
      XDG_CACHE_HOME: cacheHome,
      XDG_STATE_HOME: stateHome,
    }

    run(process.execPath, [installScript, configPath], env)

    const installedConfig = readFileSync(configPath, "utf8")
    expect(installedConfig).toContain('"oca"')
    expect(installedConfig).toContain('"gpt-5.3-codex"')

    const resolvedConfig = run("opencode", ["debug", "config"], env)
    expect(resolvedConfig).toContain('"oca"')

    const models = run("opencode", ["models", "oca"], env)
    expect(models).toContain("oca/gpt-5.3-codex")
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("OpenCode loads the packed plugin artifact and lists OCA models", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "opencode-oca-auth-pack-"))

  try {
    const packDir = join(tempRoot, "pack")
    const unpackDir = join(tempRoot, "unpack")
    mkdirSync(packDir, { recursive: true })
    mkdirSync(unpackDir, { recursive: true })

    const packOutput = run("npm", ["pack", "--pack-destination", packDir], {
      HOME: process.env.HOME ?? tempRoot,
    }).trim()
    const tarball = join(packDir, packOutput)
    run("tar", ["-xzf", tarball, "-C", unpackDir], {
      HOME: process.env.HOME ?? tempRoot,
    })

    const packedPluginPath = `file://${join(unpackDir, "package")}`
    const home = join(tempRoot, "home")
    const configHome = join(tempRoot, "config")
    const dataHome = join(tempRoot, "data")
    const cacheHome = join(tempRoot, "cache")
    const stateHome = join(tempRoot, "state")
    const configDir = join(configHome, "opencode")
    const configPath = join(configDir, "opencode.json")

    mkdirSync(home, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(installConfig(modernConfig, packedPluginPath), null, 2)}\n`,
      "utf8",
    )

    const env = {
      HOME: home,
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: dataHome,
      XDG_CACHE_HOME: cacheHome,
      XDG_STATE_HOME: stateHome,
    }

    const resolvedConfig = run("opencode", ["debug", "config"], env)
    expect(resolvedConfig).toContain(packedPluginPath)

    const models = run("opencode", ["models", "oca"], env)
    expect(models).toContain("oca/gpt-5.3-codex")
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
