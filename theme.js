const THEME_KEY = "kin-theme";

function updateThemeButton(toggleButton) {
  if (!toggleButton) {
    return;
  }

  const isDark = document.documentElement.dataset.theme === "dark";
  toggleButton.textContent = isDark ? "Light mode" : "Dark mode";
  toggleButton.setAttribute("aria-pressed", String(isDark));
}

function applyTheme(theme, toggleButton, onThemeChange, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    localStorage.setItem(THEME_KEY, theme);
  }
  updateThemeButton(toggleButton);
  if (onThemeChange) {
    onThemeChange();
  }
}

export function initializeThemeToggle(toggleButton, onThemeChange) {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initialTheme = savedTheme || (prefersDark ? "dark" : "light");

  applyTheme(initialTheme, toggleButton, onThemeChange, false);

  if (!toggleButton) {
    return;
  }

  toggleButton.addEventListener("click", () => {
    const currentTheme = document.documentElement.dataset.theme;
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, toggleButton, onThemeChange, true);
  });
}