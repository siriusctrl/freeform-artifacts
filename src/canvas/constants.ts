import type { CanvasTheme, CanvasViewport } from "../artifacts/types";

export type ThemeMode = "light" | "dark";

export const INITIAL_VIEWPORT: CanvasViewport = { x: 80, y: 80, scale: 1 };

export function themeFor(mode: ThemeMode): CanvasTheme {
  if (mode === "dark") {
    return {
      mode,
      accent: "#35c8dc",
      surface: "#171b1d",
      text: "#eef3f3",
    };
  }

  return {
    mode,
    accent: "#0098b8",
    surface: "#ffffff",
    text: "#171717",
  };
}
