import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "bekiuz-trade-ai",
    entrypoint: "./src/index.js",
    compatibilityDate: "2026-11-18",
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 0.1 }
    }
  },
  env: {
    AI: bindings.ai()
  }
});
