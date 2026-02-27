import type { Plugin } from "@opencode-ai/plugin"
import { authLoader } from "./src/auth"
import { oauthMethod } from "./src/oauth"

export const plugin: Plugin = async (input) => {
  return {
    auth: {
      provider: "oca",
      loader: authLoader(input),
      methods: [
        oauthMethod(),
        {
          type: "api",
          label: "Use API Key",
        },
      ],
    },
  }
}

export default plugin
