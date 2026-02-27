import { afterEach, expect, test } from "bun:test"

import { plugin } from "../index"
import { resetDiscoveryCache } from "../src/auth"
import { resetEnvCache } from "../src/env"

const realFetch = globalThis.fetch
const realBaseUrl = process.env.OCA_BASE_URL
const realBaseUrls = process.env.OCA_BASE_URLS

afterEach(() => {
  globalThis.fetch = realFetch
  if (realBaseUrl === undefined) delete process.env.OCA_BASE_URL
  else process.env.OCA_BASE_URL = realBaseUrl
  if (realBaseUrls === undefined) delete process.env.OCA_BASE_URLS
  else process.env.OCA_BASE_URLS = realBaseUrls
  resetEnvCache()
  resetDiscoveryCache()
})

test("loader resolves base url from OCA_BASE_URLS env list", async () => {
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://env-a.example/litellm,https://env-b.example/litellm"
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url, init })
    if (String(url) === "https://env-a.example/litellm/models") {
      return Response.json({ data: [{ id: "gpt-5" }] })
    }
    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const input = {
    client: {
      auth: {
        set: async () => ({}),
      },
    },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
  expect(loader).toBeDefined()

  if (!loader) throw new Error("missing loader")

  const loaded = await loader(
    async () => ({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
    }),
    {} as never,
  )

  expect(loaded.baseURL).toBe("https://env-a.example/litellm")
  expect(String(calls[0]?.url)).toBe("https://env-a.example/litellm/models")
})

test("loader resolves oca base url from built-in endpoints", async () => {
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
  delete process.env.OCA_BASE_URL
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url, init })
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{ id: "gpt-5" }] })
    }
    return new Response("ok", { status: 200 })
  }) as unknown as typeof fetch

  const input = {
    client: {
      auth: {
        set: async () => ({}),
      },
    },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
  expect(loader).toBeDefined()

  if (!loader) throw new Error("missing loader")

  const loaded = await loader(
    async () => ({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
    }),
    {} as never,
  )

  expect(loaded.baseURL).toBe("https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm")
  expect(String(calls[0]?.url)).toBe(
    "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/models",
  )
  const headers = new Headers(calls[0]?.init?.headers)
  expect(headers.get("Authorization")).toBe("Bearer access-token")
})

test("loader populates provider models from oca models endpoint", async () => {
  delete process.env.OCA_BASE_URL
  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).endsWith("/models")) {
      return Response.json({
        data: [{ id: "gpt-5" }, { id: "oca/gpt-oss-120b" }],
      })
    }
    return new Response("ok", { status: 200 })
  }) as unknown as typeof fetch

  const input = {
    client: {
      auth: {
        set: async () => ({}),
      },
    },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
  expect(loader).toBeDefined()

  if (!loader) throw new Error("missing loader")

  const provider = {
    id: "oca",
    name: "Oracle Code Assist",
    source: "custom",
    env: ["OCA_API_KEY"],
    options: {},
    models: {},
  }

  await loader(
    async () => ({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
    }),
    provider as never,
  )

  expect(Object.keys(provider.models).sort()).toEqual(["gpt-5", "gpt-oss-120b"])
})

test("loader adds bearer authorization for oauth auth", async () => {
  let init: RequestInit | undefined
  globalThis.fetch = (async (_request: RequestInfo | URL, value?: RequestInit) => {
    init = value
    return new Response("ok", { status: 200 })
  }) as unknown as typeof fetch

  const input = {
    client: {
      auth: {
        set: async () => ({}),
      },
    },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
  expect(loader).toBeDefined()

  if (!loader) throw new Error("missing loader")

  const loaded = await loader(
    async () => ({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
    }),
    {} as never,
  )

  expect(typeof loaded.fetch).toBe("function")
  const fn = loaded.fetch as typeof fetch
  await fn("https://api.example.com/v1")

  const headers = new Headers(init?.headers)
  expect(headers.get("Authorization")).toBe("Bearer access-token")
})

test("oauth authorize uses auto callback server and exchanges code with pkce", async () => {
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes("/oauth2/v1/token")) {
      return realFetch(url, init)
    }
    calls.push({ url, init })
    return Response.json({
      access_token: "oauth-access",
      refresh_token: "oauth-refresh",
      expires_in: 1800,
      token_type: "Bearer",
    })
  }) as unknown as typeof fetch

  const input = {
    client: {
      auth: {
        set: async () => ({}),
      },
    },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const methods = hooks.auth?.methods ?? []
  const oauth = methods.find((x) => x.type === "oauth")
  expect(oauth).toBeDefined()

  if (!oauth || oauth.type !== "oauth") throw new Error("missing oauth method")

  const flow = await oauth.authorize({
    idcsUrl: "https://identity.example.com",
    clientId: "client-123",
  })
  expect(flow.method).toBe("auto")
  if (flow.method !== "auto") throw new Error("unexpected code flow")

  const authUrl = new URL(flow.url)
  expect(`${authUrl.origin}${authUrl.pathname}`).toBe("https://identity.example.com/oauth2/v1/authorize")
  expect(authUrl.searchParams.get("client_id")).toBe("client-123")
  expect(authUrl.searchParams.get("response_type")).toBe("code")
  expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256")
  const state = authUrl.searchParams.get("state")
  const redirectUri = authUrl.searchParams.get("redirect_uri")
  expect(redirectUri).toBe("http://127.0.0.1:48801/auth/oca")
  if (!state || !redirectUri) throw new Error("missing state or redirect")

  const pending = flow.callback()
  const callbackResponse = await realFetch(`${redirectUri}?code=code-123&state=${state}`)
  expect(callbackResponse.status).toBe(200)
  const result = await pending

  expect(result.type).toBe("success")
  if (result.type !== "success") throw new Error("unexpected failed result")
  expect("access" in result).toBe(true)
  if (!("access" in result)) throw new Error("unexpected api key result")
  const out = result as {
    access: string
    refresh: string
    expires: number
    accountId?: string
    enterpriseUrl?: string
  }
  expect(out.access).toBe("oauth-access")
  expect(out.refresh).toBe("oauth-refresh")
  expect(typeof out.expires).toBe("number")
  expect(out.enterpriseUrl).toBe("https://identity.example.com")
  expect(out.accountId).toBe("client-123")

  const tokenCall = calls[0]
  expect(String(tokenCall?.url)).toBe("https://identity.example.com/oauth2/v1/token")
  const params = new URLSearchParams(String(tokenCall?.init?.body ?? ""))
  expect(params.get("grant_type")).toBe("authorization_code")
  expect(params.get("client_id")).toBe("client-123")
  expect(params.get("code")).toBe("code-123")
  expect(params.get("redirect_uri")).toBe("http://127.0.0.1:48801/auth/oca")
  expect(params.get("code_verifier")?.length).toBeGreaterThan(0)
})

test("loader leaves api auth without oauth fetch injection", async () => {
  const input = {
    client: {
      auth: {
        set: async () => ({}),
      },
    },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
  expect(loader).toBeDefined()

  if (!loader) throw new Error("missing loader")

  const loaded = await loader(
    async () => ({
      type: "api",
      key: "k",
    }),
    {} as never,
  )

  expect(loaded.fetch).toBeUndefined()
})

test("expired oauth token refreshes and persists before request", async () => {
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url, init })
    if (String(url).includes("/oauth2/v1/token")) {
      return Response.json({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      })
    }
    return new Response("ok", { status: 200 })
  }) as unknown as typeof fetch

  const saved: Array<unknown> = []
  const input = {
    client: {
      auth: {
        set: async (value: unknown) => {
          saved.push(value)
          return {}
        },
      },
    },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
  expect(loader).toBeDefined()

  if (!loader) throw new Error("missing loader")

  const auth = {
    type: "oauth" as const,
    refresh: "old-refresh",
    access: "old-access",
    expires: Date.now() - 1000,
    enterpriseUrl: "https://custom-idcs.example.com",
    accountId: "custom-client-id",
  }
  const loaded = await loader(async () => auth, {} as never)
  const fn = loaded.fetch as typeof fetch
  await fn("https://api.example.com/v1")

  expect(saved.length).toBe(1)
  const payload = saved[0] as {
    body?: {
      type?: string
      access?: string
      refresh?: string
      expires?: number
      enterpriseUrl?: string
      accountId?: string
    }
  }
  expect(payload.body?.type).toBe("oauth")
  expect(payload.body?.access).toBe("fresh-access")
  expect(payload.body?.refresh).toBe("fresh-refresh")
  expect(typeof payload.body?.expires).toBe("number")
  expect(payload.body?.enterpriseUrl).toBe("https://custom-idcs.example.com")
  expect(payload.body?.accountId).toBe("custom-client-id")

  const tokenCall = calls.find((x) => String(x.url).includes("/oauth2/v1/token"))
  expect(String(tokenCall?.url)).toBe("https://custom-idcs.example.com/oauth2/v1/token")
  const tokenBody = new URLSearchParams(String(tokenCall?.init?.body ?? ""))
  expect(tokenBody.get("client_id")).toBe("custom-client-id")

  const requestCall = calls.at(-1)
  const headers = new Headers(requestCall?.init?.headers)
  expect(headers.get("Authorization")).toBe("Bearer fresh-access")
})
