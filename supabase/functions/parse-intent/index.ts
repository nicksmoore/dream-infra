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
            content: `You are an infrastructure intent parser. Extract structured intent from natural language infrastructure requests. Use the tool provided to return the result.`,
          },
          { role: "user", content: message },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "parse_infrastructure_intent",
              description: "Parse a natural language infrastructure request into structured intent fields.",
              parameters: {
                type: "object",
                properties: {
                  workloadType: {
                    type: "string",
                    enum: ["general", "compute", "memory"],
                    description: "Type of workload: general purpose, compute intensive, or memory intensive",
                  },
                  costSensitivity: {
                    type: "string",
                    enum: ["cheapest", "balanced", "production"],
                    description: "Cost preference: cheapest possible, balanced, or production grade",
                  },
                  environment: {
                    type: "string",
                    enum: ["dev", "staging", "prod"],
                    description: "Target environment",
                  },
                  region: {
                    type: "string",
                    enum: ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"],
                    description: "AWS region",
                  },
                  os: {
                    type: "string",
                    enum: ["amazon-linux-2023", "ubuntu"],
                    description: "Operating system",
                  },
                },
                required: ["workloadType", "costSensitivity", "environment", "region", "os"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "parse_infrastructure_intent" } },
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
