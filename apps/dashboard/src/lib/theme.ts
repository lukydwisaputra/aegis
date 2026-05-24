type Theme = "light" | "dark" | "system";

export function getTheme(): Theme {
  return (localStorage.getItem("theme") as Theme | null) ?? "system";
}

export function setTheme(theme: Theme): void {
  localStorage.setItem("theme", theme);
  applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);
}

export function initTheme(): void {
  applyTheme(getTheme());
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (getTheme() === "system") applyTheme("system");
    });
}
