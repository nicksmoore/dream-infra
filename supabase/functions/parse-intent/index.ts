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
            content: `You are the Naawi Archetype Resolver. Your sole objective is to classify natural language infrastructure intent into a high-level Deployment Archetype.

### THE HARD GATE (Classification Rules):
1. **Identify Archetype**: You MUST select exactly one from the list below.
2. **Deterministic Variables**: Extract only the necessary parameters (e.g., domainName, bucketName, clusterName).
3. **No Primitives**: You are strictly forbidden from generating individual AWS SDK operations (S3::CreateBucket, etc.). The engine handles expansion.
4. **Hard Block**: If the archetype is EDGE_STATIC_SPA, you MUST NOT include any networking or compute variables (VPC, Subnets, EC2).

### SUPPORTED ARCHETYPES:
- **EDGE_STATIC_SPA**: Triggered by "frontend", "static site", "React/Angular/Vue", "globally available secure UI".
  - *Required Vars*: domainName, bucketName.
- **SERVICE_MESH**: Triggered by "microservices", "kubernetes", "EKS", "cluster".
  - *Required Vars*: clusterName, region.
- **EVENT_PIPELINE**: Triggered by "data processing", "sqs", "lambda pipeline".
  - *Required Vars*: name, region.

### AMBIGUITY & HALT:
If the user's intent matches multiple archetypes or is missing critical variables, you MUST set "confidence" to "LOW" and provide a "disambiguationPrompt". Do not guess.`,
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
                    enum: ["EDGE_STATIC_SPA", "SERVICE_MESH", "EVENT_PIPELINE", "THREE_TIER", "UNKNOWN"] 
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
