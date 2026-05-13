import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/sidebar";
import { StreamStatusBar } from "@/components/stream-status";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background text-foreground noise">
      <Sidebar agentActive />
      <div className="flex-1 flex flex-col min-w-0">
        <StreamStatusBar />
        <main className="flex-1 p-6 scanlines">
          <Outlet />
        </main>
      </div>
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}
