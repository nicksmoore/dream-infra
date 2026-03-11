import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const TERRAFORM_MCP_URL = Deno.env.get("TERRAFORM_MCP_URL");
    if (!TERRAFORM_MCP_URL) {
      return new Response(
        JSON.stringify({ error: "TERRAFORM_MCP_URL is not configured. Please set your Terraform MCP server URL." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const TERRAFORM_MCP_TOKEN = Deno.env.get("TERRAFORM_MCP_TOKEN");

    const body = await req.json();
    const { method: mcpMethod, params, id } = body;

    // Build JSON-RPC 2.0 request for MCP
    const jsonRpcRequest = {
      jsonrpc: "2.0",
      id: id ?? crypto.randomUUID(),
      method: mcpMethod,
      params: params ?? {},
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };

    if (TERRAFORM_MCP_TOKEN) {
      headers["Authorization"] = `Bearer ${TERRAFORM_MCP_TOKEN}`;
    }

    console.log(`MCP proxy → ${mcpMethod}`, JSON.stringify(params ?? {}).slice(0, 500));

    const response = await fetch(TERRAFORM_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(jsonRpcRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`MCP server error [${response.status}]:`, errorText);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: jsonRpcRequest.id,
          error: {
            code: -32000,
            message: `MCP server returned ${response.status}: ${errorText.slice(0, 500)}`,
          },
        }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";

    // Handle SSE stream responses
    if (contentType.includes("text/event-stream")) {
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    // Standard JSON response
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("terraform-mcp-proxy error:", e);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: e instanceof Error ? e.message : "Internal proxy error",
        },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
