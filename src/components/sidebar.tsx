import { Link, useLocation } from "@tanstack/react-router";

const NAV = [
  { to: "/", label: "QUEUE" },
  { to: "/sources", label: "SOURCES" },
  { to: "/template", label: "TEMPLATE" },
  { to: "/pipeline", label: "PIPELINE" },
  { to: "/library", label: "LIBRARY" },
  { to: "/analytics", label: "ANALYTICS" },
  { to: "/campaigns", label: "CAMPAIGNS" },
  { to: "/settings", label: "SETTINGS" },
] as const;

export function Sidebar({ agentActive = true }: { agentActive?: boolean }) {
  const { pathname } = useLocation();

  return (
    <aside className="w-60 shrink-0 bg-sidebar border-r border-blood flex flex-col h-screen sticky top-0 noise">
      {/* Logo */}
      <div className="relative px-5 py-6 border-b border-blood/40">
        <div className="absolute inset-0 bg-radial-blood opacity-60 pointer-events-none" />
        <h1 className="relative font-display text-3xl text-foreground text-glow-red leading-none">
          GREATS
          <br />
          <span className="text-blood">CLIPPER</span>
        </h1>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4">
        {NAV.map((item) => {
          const active =
            item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`block px-5 py-3 text-sm font-display tracking-wider border-l-2 transition-colors ${
                active
                  ? "border-blood text-foreground bg-blood/10"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-blood/5"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Agent status */}
      <div className="px-5 py-4 border-t border-blood/40">
        <div className="flex items-center gap-2 text-xs font-mono">
          <span
            className={`w-2 h-2 rounded-full animate-pulse-dot ${
              agentActive ? "bg-live" : "bg-blood"
            }`}
          />
          <span className="tracking-widest">
            AGENT: {agentActive ? "ACTIVE" : "PAUSED"}
          </span>
        </div>
      </div>
    </aside>
  );
}
