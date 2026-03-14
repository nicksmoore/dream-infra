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
            content: `You are the Naawi IDI Compiler. Your objective is to translate natural language infrastructure intent into a deterministic array of AWS SDK v3 operations. You bypass all intermediary DSLs (Terraform, YAML, HCL) and target the native AWS Service Clients directly.

Core Directives:
1. Stateless Logic: Do not assume a local state file exists. If an intent references an existing resource, your first operation must be a Describe* or Get* call to retrieve the current state.
2. Symbolic Referencing: Use the syntax ref(op_id.Property) to link dependent resources. Never hardcode ARNs or IDs that are created within the same intent.
3. Idempotency: For every mutation (Create/Update), generate a unique ClientToken or IdempotencyToken to ensure the execution loop can safely retry calls.
4. Surgical Scoping: Use the discoveryContext object to provide the Runtime with the exact identifiers (tags, names, or ARNs) needed to minimize API noise. Target 3–12 API calls per intent.

Operational Rules:
- No Hallucinations: Use only valid AWS SDK v3 parameters.
- Security First: Default to private access, encrypted storage (KMS), and least-privilege IAM policies.
- Validation: Ensure that if op_B depends on op_A, the dependsOn field reflects this.`,
          },
          { role: "user", content: message },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "compile_infrastructure_intent",
              description: "Compile a natural language infrastructure request into a deterministic sequence of AWS SDK v3 operations.",
              parameters: {
                type: "object",
                properties: {
                  operations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", description: "Unique, traceable ID for this operation (e.g., 'create_vpc_01')." },
                        service: { type: "string", description: "AWS Service name (e.g., 'S3', 'EC2', 'RDS')." },
                        command: { type: "string", description: "SDK Command name (e.g., 'CreateBucketCommand')." },
                        discoveryContext: {
                          type: "object",
                          properties: {
                            identifiers: { type: "array", items: { type: "string" }, description: "ARNs, IDs, or Names to check if the resource already exists." },
                            tags: { type: "object", additionalProperties: { type: "string" } }
                          }
                        },
                        input: { 
                          type: "object", 
                          description: "The exact SDK input payload. Use 'ref(op_id.Property)' for symbolic links to previous operations." 
                        },
                        riskLevel: { type: "string", enum: ["LOW", "HIGH"] },
                        dependsOn: { type: "array", items: { type: "string" }, description: "Array of operation IDs that must complete first." }
                      },
                      required: ["id", "service", "command", "input", "riskLevel"]
                    }
                  }
                },
                required: ["operations"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "compile_infrastructure_intent" } },
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
