export type OAuthConfigInput = {
  enterpriseUrl?: string
  accountId?: string
}

export type TokenResponse = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
}

export type OcaModelEntry = {
  [key: string]: unknown
  id?: string
  model_name?: string
  litellm_params?: {
    [key: string]: unknown
    model?: string
    max_tokens?: number
  }
  model_info?: {
    [key: string]: unknown
    is_reasoning_model?: boolean
    supported_api_list?: string[]
    supports_vision?: boolean
    reasoning_effort_options?: string[]
    context_window?: number
    max_tokens?: number
    max_input_tokens?: number
    max_output_tokens?: number
    input_cost_per_token?: number
    output_cost_per_token?: number
  }
}

export type OcaModelsPayload = {
  data?: OcaModelEntry[]
}

export type ResolvedModelVariants = Record<string, Record<string, unknown>>

export type ResolvedOcaModel = {
  id: string
  name?: string
  npmPackage: "@ai-sdk/openai" | "@ai-sdk/openai-compatible"
  reasoning: boolean
  supportsVision?: boolean
  contextWindow?: number
  maxOutputTokens?: number
  costs: {
    input?: number
    output?: number
  }
  variants?: ResolvedModelVariants
  endpoint: OcaModelEntry
}

export type ProviderDiscovery = {
  baseURL: string
  models: ResolvedOcaModel[]
}
