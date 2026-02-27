import type { Auth, Provider } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"

import { oauthConfig, refreshAccessToken } from "./oauth"
import { loadEnv } from "./env"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"
const DEFAULT_OCA_BASE_URLS = [
  "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
  "https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
]

type OAuthAuth = Extract<Auth, { type: "oauth" }> & { accountId?: string }

let discoveredBaseUrl: string | undefined
let discoveredModelIds: string[] | undefined

export function resetDiscoveryCache() {
  discoveredBaseUrl = undefined
  discoveredModelIds = undefined
}

function baseUrl() {
  loadEnv()
  return process.env.OCA_BASE_URL
}

function baseUrls() {
  loadEnv()
  return (process.env.OCA_BASE_URLS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .concat(DEFAULT_OCA_BASE_URLS)
}

async function discoverBaseUrl(token: string) {
  if (discoveredBaseUrl) return discoveredBaseUrl

  for (const baseURL of baseUrls()) {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
    if (!response?.ok) continue
    const type = response.headers.get("content-type") ?? ""
    const body = (type.includes("application/json")
      ? await response.json()
      : {}) as { data?: Array<{ id?: string }> }
    discoveredModelIds = (body.data ?? []).flatMap((item) => {
      if (!item.id) return []
      const id = item.id.startsWith("oca/") ? item.id.slice(4) : item.id
      if (!id) return []
      return [id]
    })
    discoveredBaseUrl = baseURL
    return baseURL
  }
}

function reasoning(id: string) {
  const model = id.toLowerCase()
  if (model.includes("codex")) return true
  if (model.includes("gpt-5")) return true
  if (model.includes("reasoner")) return true
  if (model.includes("thinking")) return true
  if (/^o[134](?:$|[-/])/.test(model)) return true
  if (model.includes("r1")) return true
  return false
}

function upsertModels(provider: Provider | undefined, baseURL: string) {
  if (!provider) return
  if (!provider.models) return
  for (const id of discoveredModelIds ?? []) {
    if (provider.models[id]) continue
    provider.models[id] = {
      id,
      providerID: "oca",
      name: id,
      api: {
        id,
        url: baseURL,
        npm: id.includes("gpt-5") || id.includes("codex") ? "@ai-sdk/openai" : "@ai-sdk/openai-compatible",
      },
      status: "active",
      capabilities: {
        temperature: true,
        reasoning: reasoning(id),
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128_000, output: 16_384 },
      options: {},
      headers: {},
    }
  }
}

async function resolveBaseUrl(auth: Auth) {
  const fromEnv = baseUrl()
  if (fromEnv) return fromEnv

  if (auth.type === "oauth") {
    if (!auth.access) return
    return discoverBaseUrl(auth.access)
  }

  if (auth.type === "api") {
    if (!auth.key) return
    return discoverBaseUrl(auth.key)
  }
}

async function save(input: PluginInput, previous: OAuthAuth, body: { access_token: string; refresh_token?: string; expires_in?: number }) {
  const next = {
    type: "oauth" as const,
    refresh: body.refresh_token ?? previous.refresh,
    access: body.access_token,
    expires: Date.now() + (body.expires_in ?? 3600) * 1000,
    enterpriseUrl: previous.enterpriseUrl,
    accountId: previous.accountId,
  }

  await input.client.auth.set({
    path: { id: "oca" },
    body: next,
  })

  return next
}

async function refresh(input: PluginInput, auth: OAuthAuth) {
  const cfg = oauthConfig(auth)
  const tokens = await refreshAccessToken(cfg.idcsUrl, cfg.clientId, auth.refresh)
  return save(input, auth, tokens)
}

export function authLoader(input: PluginInput) {
  return async (getAuth: () => Promise<Auth>, provider?: Provider) => {
    const auth = await getAuth()

    const token = auth.type === "oauth" ? auth.access : auth.type === "api" ? auth.key : undefined
    const discovered = token ? await discoverBaseUrl(token) : undefined
    if (discovered) upsertModels(provider, discovered)

    if (auth.type !== "oauth") {
      const url = await resolveBaseUrl(auth)
      if (!url) return {}
      return { baseURL: url }
    }

    const valid = auth.access && auth.expires > Date.now()
    const current = valid ? auth : await refresh(input, auth)
    if (!valid) {
      auth.refresh = current.refresh
      auth.access = current.access
      auth.expires = current.expires
    }
    const url = await resolveBaseUrl(current)

    return {
      apiKey: OAUTH_DUMMY_KEY,
      ...(url ? { baseURL: url } : {}),
      fetch: async (request: RequestInfo | URL, init?: RequestInit) => {
        const current = await getAuth()
        if (current.type !== "oauth") return fetch(request, init)

        const valid = current.access && current.expires > Date.now()
        const next = valid ? current : await refresh(input, current)

        const headers = new Headers(init?.headers)
        headers.set("Authorization", `Bearer ${next.access}`)

        return fetch(request, {
          ...init,
          headers,
        })
      },
    }
  }
}
