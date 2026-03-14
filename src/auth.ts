import type { Auth, Provider } from "@opencode-ai/sdk"
import type { PluginInput } from "@opencode-ai/plugin"

import type { ProviderDiscovery, ResolvedOcaModel } from "../packages/oca-auth-core"
import { discoverProvider, isSafeBaseUrl, isRecord, TOKEN_EXPIRY_BUFFER_MS, clampExpiresIn } from "../packages/oca-auth-core"
import { loadEnv } from "./env"
import { oauthConfig, refreshAccessToken } from "./oauth"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

type OAuthAuth = Extract<Auth, { type: "oauth" }> & { accountId?: string }

const OCA_RELOGIN_HINT = "Run `opencode auth login`, then select `oca`, to refresh credentials."

const errorMessage = (value: unknown) =>
  value instanceof Error ? value.message : String(value)

const withReloginHint = (message: string) =>
  message.includes("opencode auth login") ? message : `${message}. ${OCA_RELOGIN_HINT}`

/** @deprecated State is now scoped inside authLoader — this is a no-op kept for backward compatibility. */
export function resetDiscoveryCache() {}

function baseUrl() {
  loadEnv()
  const value = process.env.OCA_BASE_URL
  if (value && !isSafeBaseUrl(value)) return undefined
  return value
}

function baseUrls(): string[] {
  loadEnv()
  return (process.env.OCA_BASE_URLS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter(isSafeBaseUrl)
}

function getNestedOcaEndpoint(existing: Provider["models"][string] | undefined) {
  const existingOptions = isRecord(existing?.options) ? existing.options : {}
  const existingOcaOptions = isRecord(existingOptions.oca) ? existingOptions.oca : {}
  const existingEndpoint = isRecord(existingOcaOptions.endpoint) ? existingOcaOptions.endpoint : {}
  return { existingOptions, existingOcaOptions, existingEndpoint }
}

function buildProviderModel(
  existing: Provider["models"][string] | undefined,
  model: ResolvedOcaModel,
  baseURL: string,
): Provider["models"][string] {
  const { existingOptions, existingOcaOptions, existingEndpoint } = getNestedOcaEndpoint(existing)
  const existingRecord: Record<string, unknown> = isRecord(existing) ? existing : {}
  const variants = (isRecord(existingRecord.variants)
    ? existingRecord.variants as Record<string, Record<string, unknown>>
    : undefined) ?? model.variants

  const entry: Provider["models"][string] = {
    ...(existing ?? {}),
    id: model.id,
    providerID: "oca",
    name: existing?.name ?? model.name ?? model.id,
    api: {
      ...(existing?.api ?? {}),
      id: model.id,
      url: baseURL,
      npm: model.npmPackage,
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
        image: model.supportsVision ?? true,
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
    cost: existing?.cost ?? {
      input: model.costs.input ?? 0,
      output: model.costs.output ?? 0,
      cache: { read: 0, write: 0 },
    },
    limit: existing?.limit ?? {
      context: model.contextWindow ?? 128_000,
      output: model.maxOutputTokens ?? 16_384,
    },
    options: model.endpoint
      ? { ...existingOptions, oca: { ...existingOcaOptions, endpoint: { ...existingEndpoint, ...model.endpoint } } }
      : (existing?.options ?? {}),
    headers: existing?.headers ?? {},
  }

  if (variants) {
    ;(entry as Record<string, unknown>).variants = variants
  }

  return entry
}

function upsertModels(provider: Provider | undefined, baseURL: string, models: ResolvedOcaModel[]) {
  if (!provider?.models) return
  for (const model of models) {
    provider.models[model.id] = buildProviderModel(provider.models[model.id], model, baseURL)
  }
}

async function save(
  input: PluginInput,
  previous: OAuthAuth,
  body: { access_token: string; refresh_token?: string; expires_in?: number },
) {
  const next = {
    type: "oauth" as const,
    refresh: body.refresh_token ?? previous.refresh,
    access: body.access_token,
    expires: Date.now() + clampExpiresIn(body.expires_in) * 1000,
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
    throw new Error(withReloginHint(errorMessage(error)), { cause: error })
  }
}

export function createDiscoveryCache() {
  const NEGATIVE_TTL_MS = 30_000

  let discovered: ProviderDiscovery | undefined
  let discoveryPromise: Promise<ProviderDiscovery | undefined> | undefined
  let failedAt: number | undefined

  return {
    get result() { return discovered },
    async discover(token: string): Promise<string | undefined> {
      if (discovered) return discovered.baseURL
      if (failedAt !== undefined && Date.now() < failedAt + NEGATIVE_TTL_MS) return undefined
      if (!discoveryPromise) {
        discoveryPromise = discoverProvider({ token, baseUrls: baseUrls() })
          .then((result) => {
            discovered = result
            failedAt = result ? undefined : Date.now()
            return result
          })
          .finally(() => {
            discoveryPromise = undefined
          })
      }
      return (await discoveryPromise)?.baseURL
    },
  }
}

export function createTokenManager(input: PluginInput, initial: OAuthAuth) {
  let cached: OAuthAuth = { ...initial }
  let refreshing: Promise<OAuthAuth> | undefined

  const validToken = (value: OAuthAuth | undefined): value is OAuthAuth =>
    Boolean(value?.access) && (value?.expires ?? 0) > Date.now() + TOKEN_EXPIRY_BUFFER_MS

  const newest = (a: OAuthAuth | undefined, b: OAuthAuth | undefined) => {
    if (!a) return b
    if (!b) return a
    return (b.expires ?? 0) > (a.expires ?? 0) ? b : a
  }

  return {
    async ensureFresh(value?: OAuthAuth): Promise<OAuthAuth> {
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
    },
  }
}

function resolveBaseUrl(
  auth: Auth,
  discovery: ReturnType<typeof createDiscoveryCache>,
) {
  const fromEnv = baseUrl()
  if (fromEnv) return Promise.resolve(fromEnv)

  if (auth.type === "oauth") {
    if (!auth.access) return Promise.resolve(undefined)
    return discovery.discover(auth.access)
  }

  if (auth.type === "api") {
    if (!auth.key) return Promise.resolve(undefined)
    return discovery.discover(auth.key)
  }

  return Promise.resolve(undefined)
}

export function authLoader(input: PluginInput) {
  const discovery = createDiscoveryCache()

  return async (getAuth: () => Promise<Auth>, provider?: Provider) => {
    const auth = await getAuth()

    const token = auth.type === "oauth" ? auth.access : auth.type === "api" ? auth.key : undefined
    const discoveredBaseUrl = token ? await discovery.discover(token) : undefined
    if (discoveredBaseUrl && discovery.result) upsertModels(provider, discoveredBaseUrl, discovery.result.models)

    if (auth.type !== "oauth") {
      const url = await resolveBaseUrl(auth, discovery)
      if (!url) return {}
      return { baseURL: url }
    }

    const tokenManager = createTokenManager(input, auth)
    const current = await tokenManager.ensureFresh(auth)
    const url = await resolveBaseUrl(current, discovery)

    return {
      apiKey: OAUTH_DUMMY_KEY,
      ...(url ? { baseURL: url } : {}),
      fetch: async (request: RequestInfo | URL, init?: RequestInit) => {
        const latest = await getAuth()
        if (latest.type !== "oauth") return fetch(request, init)

        const next = await tokenManager.ensureFresh(latest)

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
