import type { Theme, Vertical } from "./models";

export type ThemePresetId = "warm" | "premium" | "bold" | "clinical";

export const themePresetOptions: Array<{ id: ThemePresetId; label: string }> = [
  { id: "warm", label: "Warm" },
  { id: "premium", label: "Premium" },
  { id: "bold", label: "Bold" },
  { id: "clinical", label: "Clinical" }
];

export function themeForPreset(vertical: Vertical, preset: ThemePresetId, base: Theme): Theme {
  const theme = structuredClone(base);
  theme.paletteName = `${vertical}-${preset}-curated`;
  theme.mood = preset === "clinical" ? "clinical" : preset === "premium" ? "premium" : preset === "bold" ? "bold" : "warm";

  if (preset === "premium") {
    theme.colors = {
      background: "#f9f8f6",
      surface: "#ffffff",
      text: "#171717",
      muted: "#666666",
      primary: "#222222",
      primaryText: "#ffffff",
      accent: "#b7a17a",
      border: "#ded8cf"
    };
    return theme;
  }

  if (preset === "bold") {
    theme.colors = {
      background: "#f7f8f4",
      surface: "#ffffff",
      text: "#141414",
      muted: "#555f66",
      primary: "#0f3d46",
      primaryText: "#ffffff",
      accent: "#df7a34",
      border: "#d6ddd9"
    };
    return theme;
  }

  if (preset === "clinical") {
    theme.colors = {
      background: "#f5fbff",
      surface: "#ffffff",
      text: "#132434",
      muted: "#5d7180",
      primary: "#176b88",
      primaryText: "#ffffff",
      accent: "#8bc6ce",
      border: "#d6e8ef"
    };
    return theme;
  }

  theme.colors = {
    background: "#fff8f0",
    surface: "#ffffff",
    text: "#261c16",
    muted: "#6f625a",
    primary: "#8f3f2a",
    primaryText: "#ffffff",
    accent: "#d99a3f",
    border: "#eadbc9"
  };
  return theme;
}
