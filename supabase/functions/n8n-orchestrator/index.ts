import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workflowId, inputs } = await req.json();

    if (!workflowId) {
      return new Response(
        JSON.stringify({ error: "workflowId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The n8n MCP connector handles execution via the Lovable platform.
    // This edge function acts as a thin relay that formats the request
    // and returns the orchestrator response to the UI.

    // For now, construct the webhook URL from the workflow configuration
    // The n8n workflow has a webhook at: /webhook/uidi-orchestrator
    const N8N_WEBHOOK_URL = Deno.env.get("N8N_WEBHOOK_URL");
    
    if (!N8N_WEBHOOK_URL) {
      return new Response(
        JSON.stringify({ 
          error: "N8N_WEBHOOK_URL is not configured. Set your n8n production webhook URL.",
          hint: "Your webhook URL is: https://aurasolutions.app.n8n.cloud/webhook/uidi-orchestrator"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the chat input to extract the intent payload
    let payload: Record<string, unknown>;
    if (inputs?.type === "chat" && inputs?.chatInput) {
      try {
        payload = JSON.parse(inputs.chatInput);
      } catch {
        payload = { intent: "sre-supreme", chatInput: inputs.chatInput };
      }
    } else {
      payload = inputs ?? {};
    }

    console.log(`n8n orchestrator → workflow ${workflowId}`, JSON.stringify(payload).slice(0, 500));

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`n8n webhook error [${response.status}]:`, errorText);
      return new Response(
        JSON.stringify({
          status: "error",
          error: `n8n returned ${response.status}: ${errorText.slice(0, 500)}`,
        }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("n8n-orchestrator error:", e);
    return new Response(
      JSON.stringify({
        status: "error",
        error: e instanceof Error ? e.message : "Internal orchestrator error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
