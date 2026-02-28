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
    if (String(url) === "https://env-a.example/litellm/v1/model/info") {
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
  expect(String(calls[0]?.url)).toBe("https://env-a.example/litellm/v1/model/info")
})

test("loader resolves oca base url from built-in endpoints", async () => {
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
  delete process.env.OCA_BASE_URL
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url, init })
    if (String(url).endsWith("/v1/model/info")) {
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
    "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/model/info",
  )
  const headers = new Headers(calls[0]?.init?.headers)
  expect(headers.get("Authorization")).toBe("Bearer access-token")
})

test("loader populates provider models from oca models endpoint", async () => {
  delete process.env.OCA_BASE_URL
  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    // /v1/model/info is tried first; serve the same model list from there
    if (String(url).endsWith("/v1/model/info")) {
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

test("loader upgrades empty existing model entries", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: { supported_api_list: ["RESPONSES"] },
          },
        ],
      })
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

  const provider = {
    id: "oca",
    name: "Oracle Code Assist",
    source: "custom",
    env: ["OCA_API_KEY"],
    options: {},
    models: {
      "gpt-5.3-codex": {},
    },
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

  const codex = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(codex.api.npm).toBe("@ai-sdk/openai")
  expect(codex.api.url).toBe("https://oca.example/litellm")
})

test("loader refreshes discovered metadata for non-empty existing entries", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: { is_reasoning_model: true, supported_api_list: ["RESPONSES"] },
          },
        ],
      })
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

  const provider = {
    id: "oca",
    name: "Oracle Code Assist",
    source: "custom",
    env: ["OCA_API_KEY"],
    options: {},
    models: {
      "gpt-5.3-codex": {
        name: "Custom Codex",
        api: {
          id: "gpt-5.3-codex",
          url: "https://old.example/litellm",
          npm: "@ai-sdk/openai-compatible",
        },
        capabilities: {
          reasoning: false,
        },
        custom: "keep-me",
      },
    },
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

  const codex = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(codex.name).toBe("Custom Codex")
  expect(codex.providerID).toBe("oca")
  expect(codex.api.id).toBe("gpt-5.3-codex")
  expect(codex.api.npm).toBe("@ai-sdk/openai")
  expect(codex.api.url).toBe("https://oca.example/litellm")
  expect(codex.capabilities.reasoning).toBe(true)
  expect(codex.custom).toBe("keep-me")
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

test("oauth authorize rejects invalid idcs url input", async () => {
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

  try {
    await oauth.authorize({
      idcsUrl: "idcs.example.com",
      clientId: "client-123",
    })
    throw new Error("expected authorize to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toContain("Invalid IDCS URL")
  }
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

test("loader reuses refreshed oauth token when auth store is stale", async () => {
  let tokenRefreshes = 0
  let requestInit: RequestInit | undefined

  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const value = String(url)
    if (value.includes("/oauth2/v1/token")) {
      tokenRefreshes += 1
      if (tokenRefreshes > 1) {
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      }
      return Response.json({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      })
    }

    if (value === "https://api.example.com/v1") {
      requestInit = init
      return new Response("ok", { status: 200 })
    }

    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const staleAuth = {
    type: "oauth" as const,
    refresh: "old-refresh",
    access: "old-access",
    expires: Date.now() - 1000,
    enterpriseUrl: "https://custom-idcs.example.com",
    accountId: "custom-client-id",
  }

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

  const loaded = await loader(async () => ({ ...staleAuth }), {} as never)
  const fn = loaded.fetch as typeof fetch
  await fn("https://api.example.com/v1")

  expect(tokenRefreshes).toBe(1)
  expect(saved.length).toBe(1)
  const headers = new Headers(requestInit?.headers)
  expect(headers.get("Authorization")).toBe("Bearer fresh-access")
})

test("loader uses model limit from api model_info when available", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: {
              is_reasoning_model: true,
              supported_api_list: ["RESPONSES"],
              max_input_tokens: 200_000,
              max_output_tokens: 32_768,
            },
          },
        ],
      })
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

  const codex = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(codex.limit).toEqual({ context: 200_000, output: 32_768 })
})

test("loader uses cost from api model_info when available", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: {
              is_reasoning_model: true,
              supported_api_list: ["RESPONSES"],
              input_cost_per_token: 0.00003,
              output_cost_per_token: 0.00006,
            },
          },
        ],
      })
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

  const codex = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(codex.cost).toEqual({
    input: 0.00003,
    output: 0.00006,
    cache: { read: 0, write: 0 },
  })
})

test("loader falls back to hardcoded defaults when api lacks limit and cost fields", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: {
              is_reasoning_model: true,
              supported_api_list: ["RESPONSES"],
            },
          },
        ],
      })
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

  const codex = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(codex.limit).toEqual({ context: 128_000, output: 16_384 })
  expect(codex.cost).toEqual({ input: 0, output: 0, cache: { read: 0, write: 0 } })
})

test("loader preserves user-configured limit over api-discovered limit", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: {
              is_reasoning_model: true,
              supported_api_list: ["RESPONSES"],
              max_input_tokens: 200_000,
              max_output_tokens: 32_768,
              input_cost_per_token: 0.00003,
              output_cost_per_token: 0.00006,
            },
          },
        ],
      })
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

  const provider = {
    id: "oca",
    name: "Oracle Code Assist",
    source: "custom",
    env: ["OCA_API_KEY"],
    options: {},
    models: {
      "gpt-5.3-codex": {
        limit: { context: 64_000, output: 8_192 },
        cost: { input: 0.001, output: 0.002, cache: { read: 0, write: 0 } },
      },
    },
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

  const codex = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  // User-configured values should be preserved, not overwritten by API
  expect(codex.limit).toEqual({ context: 64_000, output: 8_192 })
  expect(codex.cost).toEqual({ input: 0.001, output: 0.002, cache: { read: 0, write: 0 } })
})

test("loader uses context_window field from model_info (OCA primary field)", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-4.1", max_tokens: 1047576 },
            model_info: {
              is_reasoning_model: false,
              context_window: 1047576,
              max_output_tokens: 32768,
            },
          },
        ],
      })
    }
    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const input = {
    client: { auth: { set: async () => ({}) } },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
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

  const model = (provider.models as Record<string, any>)["gpt-4.1"]
  expect(model.limit).toEqual({ context: 1047576, output: 32768 })
})

test("loader treats max_output_tokens=0 as sentinel and falls back to hardcoded default", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-oss-120b", max_tokens: 128000 },
            model_info: {
              is_reasoning_model: false,
              context_window: 128000,
              max_output_tokens: 0,
            },
          },
        ],
      })
    }
    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const input = {
    client: { auth: { set: async () => ({}) } },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
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

  const model = (provider.models as Record<string, any>)["gpt-oss-120b"]
  // context_window=128000 should be used; max_output_tokens=0 is sentinel => hardcoded 16_384
  expect(model.limit).toEqual({ context: 128000, output: 16_384 })
})

test("loader prefers /v1/model/info over /models when both succeed", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  const hits: string[] = []
  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    const u = String(url)
    if (u === "https://oca.example/litellm/models") {
      hits.push("/models")
      // Returns models but NO model_info (realistic OCA behaviour)
      return Response.json({
        data: [{ id: "gpt-5.3-codex" }],
      })
    }
    if (u === "https://oca.example/litellm/v1/model/info") {
      hits.push("/v1/model/info")
      return Response.json({
        data: [
          {
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: {
              is_reasoning_model: true,
              context_window: 272000,
              max_output_tokens: 128000,
            },
          },
        ],
      })
    }
    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const input = {
    client: { auth: { set: async () => ({}) } },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
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

  const codex = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  // /v1/model/info should have been used, providing rich limit data
  expect(codex.limit).toEqual({ context: 272000, output: 128000 })
  // /v1/model/info must have been hit
  expect(hits).toContain("/v1/model/info")
})

test("loader uses model_name/supports_vision/reasoning_effort_options from endpoint", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            model_name: "Endpoint Name",
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: {
              is_reasoning_model: true,
              supported_api_list: ["RESPONSES"],
              supports_vision: false,
              reasoning_effort_options: ["low", "medium"],
              context_window: 272000,
              max_output_tokens: 128000,
            },
          },
        ],
      })
    }
    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const input = {
    client: { auth: { set: async () => ({}) } },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
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

  const model = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(model.name).toBe("Endpoint Name")
  expect(model.capabilities.input.image).toBe(false)
  expect(Object.keys(model.variants).sort()).toEqual(["low", "medium"])
  expect(model.variants.low).toEqual({
    reasoningEffort: "low",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"],
  })
})

test("loader preserves unknown endpoint fields under options.oca.endpoint", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            model_name: "Future Field Model",
            extra_top_level_field: { nested: true },
            litellm_params: { model: "oca/gpt-5.3-codex", extra_litellm_field: 42 },
            model_info: {
              context_window: 272000,
              max_output_tokens: 128000,
              new_future_field: ["a", "b"],
            },
          },
        ],
      })
    }
    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const input = {
    client: { auth: { set: async () => ({}) } },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
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

  const model = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(model.options.oca.endpoint.extra_top_level_field).toEqual({ nested: true })
  expect(model.options.oca.endpoint.litellm_params.extra_litellm_field).toBe(42)
  expect(model.options.oca.endpoint.model_info.new_future_field).toEqual(["a", "b"])
})

test("loader merges endpoint payload without dropping user endpoint annotations", async () => {
  delete process.env.OCA_BASE_URL
  process.env.OCA_BASE_URLS = "https://oca.example/litellm"

  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url) === "https://oca.example/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            model_name: "Endpoint Name",
            litellm_params: { model: "oca/gpt-5.3-codex", max_tokens: 272000 },
            model_info: {
              context_window: 272000,
              max_output_tokens: 128000,
            },
          },
        ],
      })
    }
    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const input = {
    client: { auth: { set: async () => ({}) } },
  } as unknown as Parameters<typeof plugin>[0]
  const hooks = await plugin(input)
  const loader = hooks.auth?.loader
  if (!loader) throw new Error("missing loader")

  const provider = {
    id: "oca",
    name: "Oracle Code Assist",
    source: "custom",
    env: ["OCA_API_KEY"],
    options: {},
    models: {
      "gpt-5.3-codex": {
        options: {
          oca: {
            endpoint: {
              custom_note: "keep-me",
            },
          },
        },
      },
    },
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

  const model = (provider.models as Record<string, any>)["gpt-5.3-codex"]
  expect(model.options.oca.endpoint.custom_note).toBe("keep-me")
  expect(model.options.oca.endpoint.model_info.context_window).toBe(272000)
})

test("expired oauth token refresh failure includes relogin hint", async () => {
  globalThis.fetch = (async (url: RequestInfo | URL, _init?: RequestInit) => {
    if (String(url).includes("/oauth2/v1/token")) {
      return Response.json(
        {
          error: "invalid_grant",
          error_description: "Refresh token expired",
        },
        { status: 400 },
      )
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

  try {
    await loader(
      async () => ({
        type: "oauth",
        refresh: "bad-refresh",
        access: "old-access",
        expires: Date.now() - 1000,
        enterpriseUrl: "https://custom-idcs.example.com",
        accountId: "custom-client-id",
      }),
      {} as never,
    )
    throw new Error("expected loader to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toContain("invalid_grant")
    expect(message).toContain("opencode auth login")
  }
})
