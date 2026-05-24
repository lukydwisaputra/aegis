import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Bug,
  ClipboardList,
  BarChart3,
  Shield,
  GitBranch,
  Zap,
  BookOpen,
  Bot,
  Settings,
} from "lucide-react";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Runs" },
  { to: "/defects", icon: Bug, label: "Defects" },
  { to: "/cases", icon: ClipboardList, label: "Test Cases" },
  { to: "/coverage", icon: BarChart3, label: "Coverage" },
  { to: "/gates", icon: Shield, label: "Gates" },
  { to: "/compliance", icon: GitBranch, label: "Compliance" },
  { to: "/promotions", icon: Zap, label: "Promotions" },
  { to: "/knowledge", icon: BookOpen, label: "Knowledge" },
  { to: "/agents", icon: Bot, label: "Agents" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <nav
      className="flex w-56 shrink-0 flex-col border-r bg-card py-4"
      data-testid="layout-sidebar-nav-container"
    >
      <div className="px-4 pb-4 mb-2 border-b">
        <span className="text-sm font-semibold tracking-tight">Quality Dashboard</span>
      </div>
      <ul className="flex-1 space-y-0.5 px-2">
        {NAV.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
              data-testid={`sidebar-nav-${label.toLowerCase().replace(/\s+/g, "-")}-link`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
