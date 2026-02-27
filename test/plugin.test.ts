import { expect, test } from "bun:test"

import { plugin } from "../index"

test("plugin exposes oca auth provider", async () => {
  const input = {} as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  expect(hooks.auth?.provider).toBe("oca")
})
