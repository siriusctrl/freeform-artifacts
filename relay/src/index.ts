import { jsonResponse, log } from "./http";
import { routeRequest } from "./router";
import { allowedOriginForRequest } from "./security";

export { BuildSession } from "./build-session";
export { developmentTurnstileBypassAllowed } from "./http";
export { normalizeRateLimitSource, relayConfigurationReady } from "./security";

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      log("error", "unhandled_request_error", {
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse(
        { error: "internal_error" },
        500,
        allowedOriginForRequest(request, env),
      );
    }
  },
} satisfies ExportedHandler<Env>;
