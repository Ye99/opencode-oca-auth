import { afterEach, expect, test } from "bun:test"

import {
  DEFAULT_IDCS_CLIENT_ID,
  DEFAULT_IDCS_URL,
  corePackageName,
  discoverProvider,
  exchangeCodeForTokens,
  refreshAccessToken,
  resolveOauthConfig,
} from "../packages/oca-auth-core"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

test("core package exports a stable name", () => {
  expect(corePackageName).toBe("oca-auth-core")
})

test("resolveOauthConfig falls back to defaults when env vars are blank", () => {
  expect(
    resolveOauthConfig(undefined, {
      OCA_IDCS_URL: "   ",
      OCA_CLIENT_ID: "",
    }),
  ).toEqual({
    idcsUrl: DEFAULT_IDCS_URL,
    clientId: DEFAULT_IDCS_CLIENT_ID,
  })
})

test("refreshAccessToken rejects invalid idcs URL", async () => {
  expect.assertions(1)
  try {
    await refreshAccessToken("idcs.example.com", "client-123", "refresh-token")
    throw new Error("expected refreshAccessToken to fail")
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toBe(
      "Invalid IDCS URL: idcs.example.com",
    )
  }
})

test("exchangeCodeForTokens reports compact text detail from token endpoint", async () => {
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
    expect(error instanceof Error ? error.message : String(error)).toBe(
      "Token exchange failed: 502 (upstream error)",
    )
  }
})

test("discoverProvider prefers /v1/model/info and normalizes model metadata", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url))
    if (String(url) === "https://oca.test.oraclecloud.com/litellm/v1/model/info") {
      return Response.json({
        data: [
          {
            id: "oca/gpt-5.3-codex",
            model_name: "GPT 5.3 Codex",
            litellm_params: { model: "oca/gpt-5.3-codex" },
            model_info: {
              supported_api_list: ["RESPONSES"],
              reasoning_effort_options: ["low", "high"],
              supports_vision: true,
              context_window: 400000,
              max_output_tokens: 32000,
              input_cost_per_token: 0.000001,
              output_cost_per_token: 0.000002,
            },
          },
        ],
      })
    }

    return new Response("nope", { status: 404 })
  }) as unknown as typeof fetch

  const result = await discoverProvider({
    token: "token-123",
    baseUrls: ["https://oca.test.oraclecloud.com/litellm"],
  })

  expect(calls[0]).toBe("https://oca.test.oraclecloud.com/litellm/v1/model/info")
  expect(result?.baseURL).toBe("https://oca.test.oraclecloud.com/litellm")
  expect(result?.models).toEqual([
    {
      id: "gpt-5.3-codex",
      name: "GPT 5.3 Codex",
      npmPackage: "@ai-sdk/openai",
      reasoning: true,
      supportsVision: true,
      contextWindow: 400000,
      maxOutputTokens: 32000,
      costs: {
        input: 0.000001,
        output: 0.000002,
      },
      variants: {
        low: {
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
        high: {
          reasoningEffort: "high",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
      endpoint: {
        id: "oca/gpt-5.3-codex",
        model_name: "GPT 5.3 Codex",
        litellm_params: { model: "oca/gpt-5.3-codex" },
        model_info: {
          supported_api_list: ["RESPONSES"],
          reasoning_effort_options: ["low", "high"],
          supports_vision: true,
          context_window: 400000,
          max_output_tokens: 32000,
          input_cost_per_token: 0.000001,
          output_cost_per_token: 0.000002,
        },
      },
    },
  ])
})
