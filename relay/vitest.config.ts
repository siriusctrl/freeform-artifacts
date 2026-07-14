import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./relay/wrangler.jsonc" },
      miniflare: {
        bindings: {
          ALLOWED_ORIGINS: "http://127.0.0.1:4177",
          ENVIRONMENT: "development",
          RELAY_ROUTING_SECRET: "development-only-relay-routing-secret-0001",
        },
      },
    }),
  ],
  test: {
    include: ["relay/test/**/*.test.ts"],
  },
});
