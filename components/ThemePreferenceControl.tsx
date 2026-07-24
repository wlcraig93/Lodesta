"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "lodesta:theme-preference";
const THEME_CHANGE_EVENT = "lodesta:theme-preference-change";
const preferences: ThemePreference[] = ["system", "light", "dark"];

export function ThemePreferenceManager() {
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return;
      applyThemePreference(parseThemePreference(event.newValue), false);
    }

    const colorQuery = window.matchMedia("(prefers-color-scheme: dark)");
    function onSystemThemeChange() {
      if (parseThemePreference(document.documentElement.dataset.themePreference) !== "system") return;
      applyResolvedTheme("system");
    }

    window.addEventListener("storage", onStorage);
    colorQuery.addEventListener("change", onSystemThemeChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      colorQuery.removeEventListener("change", onSystemThemeChange);
    };
  }, []);

  return null;
}

export function ThemePreferenceControl({ compact = false }: { compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const rootPreference = parseThemePreference(document.documentElement.dataset.themePreference);
    setPreference(rootPreference);

    function onThemeChange(event: Event) {
      const customEvent = event as CustomEvent<{ preference?: string }>;
      setPreference(parseThemePreference(customEvent.detail?.preference));
    }

    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);

  function selectPreference(next: ThemePreference) {
    applyThemePreference(next, true);
    setPreference(next);
  }

  function onRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + preferences.length) % preferences.length;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % preferences.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = preferences.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const next = preferences[nextIndex];
    selectPreference(next);
    const radioOptions = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radioOptions?.[nextIndex]?.focus();
  }

  return (
    <fieldset className="theme-preference" data-compact={compact ? "true" : undefined}>
      <legend>Appearance</legend>
      <div role="radiogroup" aria-label="Appearance">
        {preferences.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={preference === option}
            aria-label={`${capitalize(option)} appearance`}
            tabIndex={preference === option ? 0 : -1}
            title={capitalize(option)}
            onClick={() => selectPreference(option)}
            onKeyDown={(event) => onRadioKeyDown(event, preferences.indexOf(option))}
          >
            <ThemeIcon preference={option} />
            <span>{capitalize(option)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function applyThemePreference(preference: ThemePreference, persist: boolean) {
  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Storage can be unavailable in hardened or private browsing contexts.
    }
  }
  applyResolvedTheme(preference);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { preference } }));
}

function applyResolvedTheme(preference: ThemePreference) {
  const resolved = preference === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return <Icon><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></Icon>;
  }
  if (preference === "dark") {
    return <Icon><path d="M19.2 15.3A8 8 0 0 1 8.7 4.8 8 8 0 1 0 19.2 15.3Z" /></Icon>;
  }
  return <Icon><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></Icon>;
}

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
