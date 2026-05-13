import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 noise">
      <div className="max-w-md text-center">
        <h1 className="font-display text-8xl text-blood text-glow-red">404</h1>
        <h2 className="mt-4 font-display text-2xl tracking-widest">SIGNAL LOST</h2>
        <p className="mt-2 text-sm text-muted-foreground font-mono tracking-widest">
          THIS PAGE IS OFF-AIR.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center bg-blood px-6 py-3 font-display text-sm tracking-widest text-blood-foreground hover:shadow-glow-red"
          >
            BACK TO QUEUE
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 noise">
      <div className="max-w-md text-center">
        <h1 className="font-display text-3xl tracking-widest text-blood">SYSTEM ERROR</h1>
        <p className="mt-2 text-sm text-muted-foreground font-mono">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="bg-blood px-4 py-2 font-display text-sm tracking-widest text-blood-foreground hover:shadow-glow-red"
          >
            RETRY
          </button>
          <a
            href="/"
            className="border border-blood px-4 py-2 font-display text-sm tracking-widest text-foreground hover:bg-blood/10"
          >
            HOME
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "GREATS CLIPPER — Stream Clip Automation" },
      {
        name: "description",
        content:
          "Fight-night terminal for monitoring streams, scoring viral moments with AI, and approving clips for download.",
      },
      { name: "author", content: "GREATS CLIPPER" },
      { property: "og:title", content: "GREATS CLIPPER — Stream Clip Automation" },
      { property: "og:description", content: "Stream Spark Clips automates the creation of highlight videos from live streams by identifying and clipping energetic moments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "GREATS CLIPPER — Stream Clip Automation" },
      { name: "description", content: "Stream Spark Clips automates the creation of highlight videos from live streams by identifying and clipping energetic moments." },
      { name: "twitter:description", content: "Stream Spark Clips automates the creation of highlight videos from live streams by identifying and clipping energetic moments." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4572fdad-2024-40ea-8abc-0cf19ad64996/id-preview-9ce0c6ef--f25d50e3-8b88-4a00-abe1-abbf74e02448.lovable.app-1778691284442.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4572fdad-2024-40ea-8abc-0cf19ad64996/id-preview-9ce0c6ef--f25d50e3-8b88-4a00-abe1-abbf74e02448.lovable.app-1778691284442.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
