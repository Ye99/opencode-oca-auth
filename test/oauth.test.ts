import { afterEach, expect, test } from "bun:test"
import { rm, writeFile } from "node:fs/promises"

import { DEFAULT_IDCS_CLIENT_ID, DEFAULT_IDCS_URL } from "../src/constants"
import { resetEnvCache } from "../src/env"
import { exchangeCodeForTokens, oauthConfig, refreshAccessToken } from "../src/oauth"

const envFile = new URL("../.env", import.meta.url)
const realIdcs = process.env.OCA_IDCS_URL
const realClient = process.env.OCA_CLIENT_ID
const realFetch = globalThis.fetch

afterEach(async () => {
  if (realIdcs === undefined) delete process.env.OCA_IDCS_URL
  else process.env.OCA_IDCS_URL = realIdcs

  if (realClient === undefined) delete process.env.OCA_CLIENT_ID
  else process.env.OCA_CLIENT_ID = realClient

  globalThis.fetch = realFetch

  await rm(envFile, { force: true })
  resetEnvCache()
})

test("oauth config falls back to defaults when env vars are blank", () => {
  process.env.OCA_IDCS_URL = "   "
  process.env.OCA_CLIENT_ID = ""
  resetEnvCache()

  expect(oauthConfig()).toEqual({
    idcsUrl: DEFAULT_IDCS_URL,
    clientId: DEFAULT_IDCS_CLIENT_ID,
  })
})

test("oauth config reads values from .env", async () => {
  delete process.env.OCA_IDCS_URL
  delete process.env.OCA_CLIENT_ID
  await writeFile(
    envFile,
    ["OCA_IDCS_URL=https://idcs.env.example", "OCA_CLIENT_ID=env-client"].join("\n") + "\n",
    "utf8",
  )

  resetEnvCache()

  expect(oauthConfig()).toEqual({
    idcsUrl: "https://idcs.env.example",
    clientId: "env-client",
  })
})

test("oauth config trims trailing slash in enterprise URL", () => {
  expect(
    oauthConfig({
      enterpriseUrl: "https://idcs.example.com///",
      accountId: "client-123",
    }),
  ).toEqual({
    idcsUrl: "https://idcs.example.com",
    clientId: "client-123",
  })
})

test("refresh token rejects invalid idcs URL", async () => {
  expect.assertions(1)
  try {
    await refreshAccessToken("idcs.example.com", "client-123", "refresh-token")
    throw new Error("expected refreshAccessToken to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Invalid IDCS URL: idcs.example.com")
  }
})

test("refresh token reports status with JSON oauth error detail", async () => {
  globalThis.fetch = (async () => {
    return Response.json(
      {
        error: "invalid_grant",
        error_description: "refresh token expired",
      },
      { status: 401 },
    )
  }) as unknown as typeof fetch

  expect.assertions(1)
  try {
    await refreshAccessToken("https://idcs.example.com", "client-123", "refresh-token")
    throw new Error("expected refreshAccessToken to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Token refresh failed: 401 (invalid_grant: refresh token expired)")
  }
})

test("refresh token reports status without detail when body is empty", async () => {
  globalThis.fetch = (async () => {
    return new Response("", {
      status: 500,
      headers: { "content-type": "text/plain" },
    })
  }) as unknown as typeof fetch

  expect.assertions(1)
  try {
    await refreshAccessToken("https://idcs.example.com", "client-123", "refresh-token")
    throw new Error("expected refreshAccessToken to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Token refresh failed: 500")
  }
})

test("refresh token omits detail when JSON payload has no oauth error fields", async () => {
  globalThis.fetch = (async () => {
    return Response.json({}, { status: 503 })
  }) as unknown as typeof fetch

  expect.assertions(1)
  try {
    await refreshAccessToken("https://idcs.example.com", "client-123", "refresh-token")
    throw new Error("expected refreshAccessToken to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Token refresh failed: 503")
  }
})

test("exchange code reports compact text detail when token endpoint returns plain text", async () => {
  globalThis.fetch = (async () => {
    return new Response("  upstream\n\nerror  ", {
      status: 502,
      headers: { "content-type": "text/plain" },
    })
  }) as unknown as typeof fetch

  expect.assertions(1)
  try {
    await exchangeCodeForTokens(
      "https://idcs.example.com",
      "client-123",
      "code-123",
      "http://127.0.0.1:48801/auth/oca",
      "verifier",
    )
    throw new Error("expected exchangeCodeForTokens to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Token exchange failed: 502 (upstream error)")
  }
})

test("exchange code accepts JSON message field as oauth error detail", async () => {
  globalThis.fetch = (async () => {
    return Response.json(
      {
        message: "authorization code has expired",
      },
      { status: 400 },
    )
  }) as unknown as typeof fetch

  expect.assertions(1)
  try {
    await exchangeCodeForTokens(
      "https://idcs.example.com",
      "client-123",
      "code-123",
      "http://127.0.0.1:48801/auth/oca",
      "verifier",
    )
    throw new Error("expected exchangeCodeForTokens to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Token exchange failed: 400 (authorization code has expired)")
  }
})

test("exchange code omits detail when JSON payload has no oauth error fields", async () => {
  globalThis.fetch = (async () => {
    return Response.json({}, { status: 401 })
  }) as unknown as typeof fetch

  expect.assertions(1)
  try {
    await exchangeCodeForTokens(
      "https://idcs.example.com",
      "client-123",
      "code-123",
      "http://127.0.0.1:48801/auth/oca",
      "verifier",
    )
    throw new Error("expected exchangeCodeForTokens to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Token exchange failed: 401")
  }
})

test("exchange code rejects invalid idcs URL", async () => {
  expect.assertions(1)
  try {
    await exchangeCodeForTokens(
      "idcs.example.com",
      "client-123",
      "code-123",
      "http://127.0.0.1:48801/auth/oca",
      "verifier",
    )
    throw new Error("expected exchangeCodeForTokens to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toBe("Invalid IDCS URL: idcs.example.com")
  }
})
