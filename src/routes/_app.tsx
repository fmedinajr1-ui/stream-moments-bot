import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar, SidebarContent } from "@/components/sidebar";
import { StreamStatusBar } from "@/components/stream-status";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background text-foreground noise">
      <Sidebar agentActive />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 border-b border-blood/40 bg-sidebar px-4 py-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="p-2 -ml-2 text-foreground hover:bg-blood/10"
            >
              <Menu className="w-6 h-6" />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="p-0 w-64 bg-sidebar border-r border-blood text-foreground"
            >
              <SidebarContent agentActive onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <h1 className="font-display text-xl text-foreground text-glow-red leading-none tracking-wider">
            GREATS <span className="text-blood">CLIPPER</span>
          </h1>
        </header>

        <StreamStatusBar />
        <main className="flex-1 p-3 sm:p-6 scanlines">
          <Outlet />
        </main>
      </div>
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}
