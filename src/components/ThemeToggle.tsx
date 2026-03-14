import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return true;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }, [isDark]);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") {
      setIsDark(false);
    }
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <Sun className="h-3.5 w-3.5 text-muted-foreground" />
      <Switch checked={isDark} onCheckedChange={setIsDark} aria-label="Toggle dark mode" />
      <Moon className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}
