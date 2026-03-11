import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mcpListTools } from "@/lib/terraform-mcp";
import { Plug, PlugZap, Loader2, AlertCircle } from "lucide-react";

interface McpConnectionStatusProps {
  onConnected?: (tools: unknown) => void;
}

export function McpConnectionStatus({ onConnected }: McpConnectionStatusProps) {
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [toolCount, setToolCount] = useState(0);

  const testConnection = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const result = await mcpListTools();
      const tools = (result as { tools?: unknown[] })?.tools ?? [];
      setToolCount(tools.length);
      setStatus("connected");
      onConnected?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setStatus("error");
    }
  }, [onConnected]);

  return (
    <div className="flex items-center gap-3">
      {status === "disconnected" && (
        <Button variant="outline" size="sm" onClick={testConnection}>
          <Plug className="h-3 w-3 mr-1" /> Test MCP Connection
        </Button>
      )}
      {status === "connecting" && (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Connecting...
        </Badge>
      )}
      {status === "connected" && (
        <Badge variant="default" className="gap-1 bg-primary">
          <PlugZap className="h-3 w-3" /> MCP Connected ({toolCount} tools)
        </Badge>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" /> MCP Error
          </Badge>
          <Button variant="ghost" size="sm" onClick={testConnection}>Retry</Button>
          {error && <span className="text-xs text-destructive max-w-[200px] truncate">{error}</span>}
        </div>
      )}
    </div>
  );
}
