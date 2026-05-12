export function StreamStatusBar({
  streamer = "DEEN",
  isLive = true,
  viewers = 12847,
}: {
  streamer?: string;
  isLive?: boolean;
  viewers?: number;
}) {
  return (
    <div className="border-b border-blood/40 bg-panel px-6 py-2.5 flex items-center gap-4 text-xs font-mono">
      {isLive ? (
        <>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blood animate-pulse-dot" />
            <span className="text-blood font-bold tracking-widest">LIVE</span>
          </div>
          <span className="text-foreground font-bold tracking-wider">
            {streamer}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-gold">
            {viewers.toLocaleString()} viewers
          </span>
        </>
      ) : (
        <>
          <span className="w-2 h-2 rounded-full bg-muted-foreground" />
          <span className="text-muted-foreground tracking-widest">OFFLINE</span>
        </>
      )}
      <span className="ml-auto text-muted-foreground tracking-widest">
        {new Date().toUTCString().slice(17, 25)} UTC
      </span>
    </div>
  );
}
