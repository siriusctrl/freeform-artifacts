declare global {
  interface Env {
    RELAY_ROUTING_SECRET: string;
    TURNSTILE_SECRET: string;
  }
}

export {};
