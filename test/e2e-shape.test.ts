import { expect, test } from "bun:test"

import { plugin } from "../index"
import modern from "../config/opencode-modern.json"
import {
  DEFAULT_OCA_MODEL_ID,
  installConfig,
} from "../scripts/install-opencode-oca-auth.js"

test("plugin auth provider matches installer modern config provider key", async () => {
  const hooks = await plugin({} as Parameters<typeof plugin>[0])
  const next = installConfig(modern)

  expect(hooks.auth?.provider).toBe("oca")
  expect(next.provider?.oca).toBeDefined()
  expect(next.provider?.oca?.models?.[DEFAULT_OCA_MODEL_ID]).toBeDefined()
})
