import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
             content: `You are the IDI Archetype Resolver. Classify natural-language infrastructure intent into ONE deployment archetype and extract practical defaults.

### CLASSIFICATION RULES
1. Select exactly one archetype from the supported list.
2. Extract variables if present (domainName, bucketName, clusterName, name, region).
3. If variables are missing, still classify the archetype and let the engine use defaults.
4. Use LOW confidence only when the request is truly ambiguous between multiple archetypes.

### SUPPORTED ARCHETYPES
- EDGE_STATIC_SPA: frontend, dashboard, static site, SPA, global UI.
- SERVICE_MESH: microservices, kubernetes, EKS, service mesh, circuit breaker.
- EVENT_PIPELINE: queue, event pipeline, SQS, lambda processor, async processing.
- INTERNAL_API: API gateway, internal tooling API, BFF, Postgres/Aurora-backed API.
- THREE_TIER: legacy app, monolith, ASG + ALB + RDS style architecture.

### OUTPUT QUALITY
- Always include confidence.
- Include disambiguationPrompt only when confidence is LOW.
- Do NOT output raw SDK operations; only archetype + variables.`,
          },
          { role: "user", content: message },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "resolve_deployment_archetype",
              description: "Classify the intent into a deployment archetype and extract variables.",
              parameters: {
                type: "object",
                properties: {
                  archetype: { 
                    type: "string", 
                    enum: ["EDGE_STATIC_SPA", "SERVICE_MESH", "EVENT_PIPELINE", "INTERNAL_API", "THREE_TIER", "UNKNOWN"] 
                  },
                  variables: { 
                    type: "object",
                    additionalProperties: { type: "string" },
                    description: "Extracted parameters like domainName, bucketName, etc."
                  },
                  confidence: { type: "string", enum: ["HIGH", "LOW"] },
                  disambiguationPrompt: { 
                    type: "string", 
                    description: "Question to ask the user if confidence is LOW or archetype is UNKNOWN." 
                  }
                },
                required: ["archetype", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "resolve_deployment_archetype" } },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const text = await response.text();
      console.error("AI gateway error:", status, text);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const intent = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ intent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-intent error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
