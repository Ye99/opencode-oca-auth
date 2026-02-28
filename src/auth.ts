import type { Auth, Provider } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"

import { oauthConfig, refreshAccessToken } from "./oauth"
import { loadEnv } from "./env"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"
const DEFAULT_OCA_BASE_URLS = [
  "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
  "https://code.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
]
const MODEL_DISCOVERY_PATHS = ["/models", "/v1/models", "/v1/model/info"] as const

type DiscoveredModel = {
  id: string
  reasoning: boolean
  npm: "@ai-sdk/openai" | "@ai-sdk/openai-compatible"
}

type OcaModelsPayload = {
  data?: Array<{
    id?: string
    litellm_params?: {
      model?: string
    }
    model_info?: {
      is_reasoning_model?: boolean
      supported_api_list?: string[]
    }
  }>
}

type OAuthAuth = Extract<Auth, { type: "oauth" }> & { accountId?: string }

let discoveredBaseUrl: string | undefined
let discoveredModels: DiscoveredModel[] | undefined
const OCA_RELOGIN_HINT = "Run `opencode auth login`, then select `oca`, to refresh credentials."

const errorMessage = (value: unknown) =>
  value instanceof Error ? value.message : String(value)

const withReloginHint = (message: string) =>
  message.includes("opencode auth login") ? message : `${message}. ${OCA_RELOGIN_HINT}`

export function resetDiscoveryCache() {
  discoveredBaseUrl = undefined
  discoveredModels = undefined
}

function baseUrl() {
  loadEnv()
  return process.env.OCA_BASE_URL
}

const isSafeBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return false
    // Require https for non-localhost to prevent token leakage over plain HTTP
    if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false
    // Block cloud metadata and link-local ranges (169.254.x.x)
    if (/^169\.254\./.test(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

function baseUrls(): string[] {
  loadEnv()
  return (process.env.OCA_BASE_URLS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter(isSafeBaseUrl)
    .concat(DEFAULT_OCA_BASE_URLS)
}

function parseModelsPayload(body: OcaModelsPayload): DiscoveredModel[] {
  const models: Record<string, DiscoveredModel> = {}
  for (const item of body.data ?? []) {
    const raw = item.id ?? item.litellm_params?.model
    if (!raw) continue
    const id = raw.startsWith("oca/") ? raw.slice(4) : raw
    if (!id) continue

    const supportedApis = Array.isArray(item.model_info?.supported_api_list)
      ? item.model_info.supported_api_list
      : []
    const supportsResponses = supportedApis.some(
      (api) => String(api).toLowerCase() === "responses",
    )
    const npm = supportsResponses || id.includes("gpt-5") || id.includes("codex")
      ? "@ai-sdk/openai"
      : "@ai-sdk/openai-compatible"

    models[id] = {
      id,
      reasoning: item.model_info?.is_reasoning_model ?? reasoning(id),
      npm,
    }
  }
  return Object.values(models)
}

async function discoverBaseUrl(token: string) {
  if (discoveredBaseUrl) return discoveredBaseUrl

  type Discovery = { baseURL: string; models: DiscoveredModel[] }

  // Each base URL probes paths sequentially; all base URLs run in parallel.
  // This cuts latency when early URLs are unreachable without firing every path simultaneously.
  const probeUrl = async (baseURL: string): Promise<Discovery> => {
    const normalized = baseURL.replace(/\/+$/, "")
    for (const suffix of MODEL_DISCOVERY_PATHS) {
      const response = await fetch(`${normalized}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined)
      if (!response?.ok) continue
      const type = response.headers.get("content-type") ?? ""
      const body = (type.includes("application/json") ? await response.json() : {}) as OcaModelsPayload
      return { baseURL, models: parseModelsPayload(body) }
    }
    throw new Error("no working endpoint")
  }

  const result = await Promise.any(baseUrls().map(probeUrl)).catch(() => undefined)
  if (!result) return

  discoveredModels = result.models
  discoveredBaseUrl = result.baseURL
  return result.baseURL
}

function reasoning(id: string) {
  const model = id.toLowerCase()
  if (model.includes("codex")) return true
  if (model.includes("gpt-5")) return true
  if (model.includes("reasoner")) return true
  if (model.includes("thinking")) return true
  if (/^o[134](?:$|[-/])/.test(model)) return true // OpenAI o-series reasoning models (o1, o3, o4)
  if (model.includes("r1")) return true
  return false
}

function upsertModels(provider: Provider | undefined, baseURL: string) {
  if (!provider) return
  if (!provider.models) return
  for (const model of discoveredModels ?? []) {
    const id = model.id
    const existing = provider.models[id] as Provider["models"][string] | undefined

    provider.models[id] = {
      ...(existing ?? {}),
      id,
      providerID: "oca",
      name: existing?.name ?? id,
      api: {
        ...(existing?.api ?? {}),
        id,
        url: baseURL,
        npm: model.npm,
      },
      status: existing?.status ?? "active",
      capabilities: {
        ...(existing?.capabilities ?? {}),
        temperature: true,
        reasoning: model.reasoning,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: true,
          ...(existing?.capabilities?.input ?? {}),
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
          ...(existing?.capabilities?.output ?? {}),
        },
      },
      cost: existing?.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: existing?.limit ?? { context: 128_000, output: 16_384 },
      options: existing?.options ?? {},
      headers: existing?.headers ?? {},
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
  if (!auth.refresh) {
    throw new Error(withReloginHint("OCA OAuth session is missing a refresh token"))
  }

  const cfg = oauthConfig(auth)
  try {
    const tokens = await refreshAccessToken(cfg.idcsUrl, cfg.clientId, auth.refresh)
    return save(input, auth, tokens)
  } catch (error) {
    throw new Error(withReloginHint(errorMessage(error)))
  }
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

    const validToken = (value: OAuthAuth | undefined): value is OAuthAuth =>
      Boolean(value?.access) && (value?.expires ?? 0) > Date.now()
    const newest = (a: OAuthAuth | undefined, b: OAuthAuth | undefined) => {
      if (!a) return b
      if (!b) return a
      return (b.expires ?? 0) > (a.expires ?? 0) ? b : a
    }

    let cached: OAuthAuth = { ...auth }
    let refreshing: Promise<OAuthAuth> | undefined
    const ensureFresh = async (value?: OAuthAuth): Promise<OAuthAuth> => {
      const candidate = newest(cached, value)
      if (validToken(candidate)) {
        cached = { ...candidate }
        return cached
      }

      if (!refreshing) {
        const source = candidate ?? cached
        refreshing = refresh(input, source)
          .then((next) => {
            cached = { ...next }
            return cached
          })
          .finally(() => {
            refreshing = undefined
          })
      }

      return refreshing as Promise<OAuthAuth>
    }

    const current = await ensureFresh(auth)
    const url = await resolveBaseUrl(current)

    return {
      apiKey: OAUTH_DUMMY_KEY,
      ...(url ? { baseURL: url } : {}),
      fetch: async (request: RequestInfo | URL, init?: RequestInit) => {
        const latest = await getAuth()
        if (latest.type !== "oauth") return fetch(request, init)

        const next = await ensureFresh(latest)

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
