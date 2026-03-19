import { expect, test, beforeEach, afterEach } from "bun:test"
import { resolveOAuthBindHost } from "../src/oauth"

let savedEnv: string | undefined

beforeEach(() => {
  savedEnv = process.env.OCA_OAUTH_BIND_HOST
  delete process.env.OCA_OAUTH_BIND_HOST
})

afterEach(() => {
  if (savedEnv !== undefined) {
    process.env.OCA_OAUTH_BIND_HOST = savedEnv
  } else {
    delete process.env.OCA_OAUTH_BIND_HOST
  }
})

test("resolveOAuthBindHost defaults to 127.0.0.1 when env is unset", () => {
  expect(resolveOAuthBindHost()).toBe("127.0.0.1")
})

test("resolveOAuthBindHost uses OCA_OAUTH_BIND_HOST when set", () => {
  process.env.OCA_OAUTH_BIND_HOST = "0.0.0.0"
  expect(resolveOAuthBindHost()).toBe("0.0.0.0")
})

test("resolveOAuthBindHost uses empty string env as-is", () => {
  process.env.OCA_OAUTH_BIND_HOST = ""
  // Empty string is falsy, so fallback to default
  expect(resolveOAuthBindHost()).toBe("127.0.0.1")
})
