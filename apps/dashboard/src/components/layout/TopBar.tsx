import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setTheme, getTheme } from "@/lib/theme";
import { useState } from "react";

export function TopBar() {
  const [dark, setDark] = useState(() => getTheme() === "dark");

  function toggle() {
    const next = dark ? "light" : "dark";
    setTheme(next);
    setDark(!dark);
  }

  return (
    <header
      className="flex h-14 items-center justify-end border-b bg-card px-6"
      data-testid="layout-topbar-header-container"
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label="Toggle dark mode"
        data-testid="layout-topbar-darkmode-button"
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  );
}
