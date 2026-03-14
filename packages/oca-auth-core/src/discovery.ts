import {
  DEFAULT_OCA_BASE_URLS,
  MODEL_DISCOVERY_PATHS,
} from "./constants"
import type {
  OcaModelEntry,
  OcaModelsPayload,
  ProviderDiscovery,
  ResolvedModelVariants,
  ResolvedOcaModel,
} from "./types"

type DiscoverProviderOptions = {
  token: string
  baseUrls?: string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

const isSafeBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return false
    if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return false
    }
    if (/^169\.254\./.test(url.hostname)) return false
    return true
  } catch {
    return false
  }
}

function normalizeModelId(item: OcaModelEntry): string | undefined {
  const raw = item.id ?? item.litellm_params?.model
  if (!raw) return
  const id = raw.startsWith("oca/") ? raw.slice(4) : raw
  return id || undefined
}

function modelNameFromEndpoint(item: OcaModelEntry): string | undefined {
  return typeof item.model_name === "string" && item.model_name.trim().length > 0
    ? item.model_name.trim()
    : undefined
}

function npmFromEndpoint(
  id: string,
  item: OcaModelEntry,
): "@ai-sdk/openai" | "@ai-sdk/openai-compatible" {
  const supportedApis = Array.isArray(item.model_info?.supported_api_list)
    ? item.model_info.supported_api_list
    : []
  const supportsResponses = supportedApis.some(
    (api) => String(api).toLowerCase() === "responses",
  )
  return supportsResponses || id.includes("gpt-5") || id.includes("codex")
    ? "@ai-sdk/openai"
    : "@ai-sdk/openai-compatible"
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

function reasoningFromEndpoint(id: string, item: OcaModelEntry): boolean {
  return item.model_info?.is_reasoning_model ?? reasoning(id)
}

function supportsVisionFromEndpoint(item: OcaModelEntry): boolean | undefined {
  return typeof item.model_info?.supports_vision === "boolean"
    ? item.model_info.supports_vision
    : undefined
}

function contextWindowFromEndpoint(item: OcaModelEntry): number | undefined {
  return (
    item.model_info?.context_window ??
    item.model_info?.max_input_tokens ??
    item.model_info?.max_tokens ??
    item.litellm_params?.max_tokens
  )
}

function maxOutputTokensFromEndpoint(item: OcaModelEntry): number | undefined {
  const rawOutput = item.model_info?.max_output_tokens
  return rawOutput != null && rawOutput > 0 ? rawOutput : undefined
}

function costsFromEndpoint(item: OcaModelEntry): { input?: number; output?: number } {
  return {
    input: item.model_info?.input_cost_per_token,
    output: item.model_info?.output_cost_per_token,
  }
}

function variantsFromReasoningEfforts(
  efforts: readonly string[] | undefined,
  npmPackage: "@ai-sdk/openai" | "@ai-sdk/openai-compatible",
): ResolvedModelVariants | undefined {
  const normalized = (efforts ?? [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase())

  if (normalized.length === 0) return

  const variants: ResolvedModelVariants = {}
  for (const effort of normalized) {
    variants[effort] =
      npmPackage === "@ai-sdk/openai"
        ? {
            reasoningEffort: effort,
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          }
        : { reasoningEffort: effort }
  }

  return Object.keys(variants).length > 0 ? variants : undefined
}

export function parseModelsPayload(body: OcaModelsPayload): ResolvedOcaModel[] {
  const models: Record<string, ResolvedOcaModel> = {}

  for (const item of body.data ?? []) {
    const id = normalizeModelId(item)
    if (!id) continue
    const npmPackage = npmFromEndpoint(id, item)
    models[id] = {
      id,
      name: modelNameFromEndpoint(item),
      npmPackage,
      reasoning: reasoningFromEndpoint(id, item),
      supportsVision: supportsVisionFromEndpoint(item),
      contextWindow: contextWindowFromEndpoint(item),
      maxOutputTokens: maxOutputTokensFromEndpoint(item),
      costs: costsFromEndpoint(item),
      variants: variantsFromReasoningEfforts(item.model_info?.reasoning_effort_options, npmPackage),
      endpoint: item,
    }
  }

  return Object.values(models)
}

function candidateBaseUrls(baseUrls?: string[]) {
  return (baseUrls ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(isHttpUrl)
    .filter(isSafeBaseUrl)
    .concat(DEFAULT_OCA_BASE_URLS)
}

export async function discoverProvider({
  token,
  baseUrls,
  fetchImpl = fetch,
  timeoutMs = 10_000,
}: DiscoverProviderOptions): Promise<ProviderDiscovery | undefined> {
  const probeUrl = async (baseURL: string): Promise<ProviderDiscovery> => {
    const normalized = baseURL.replace(/\/+$/, "")
    for (const suffix of MODEL_DISCOVERY_PATHS) {
      const response = await fetchImpl(`${normalized}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => undefined)
      if (!response?.ok) continue
      const type = response.headers.get("content-type") ?? ""
      const body = (type.includes("application/json")
        ? await response.json()
        : {}) as OcaModelsPayload
      return { baseURL, models: parseModelsPayload(body) }
    }
    throw new Error("no working endpoint")
  }

  return Promise.any(candidateBaseUrls(baseUrls).map(probeUrl)).catch(() => undefined)
}
