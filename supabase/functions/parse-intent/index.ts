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

### PRE-ROUTING ARCHETYPES:
Before generating primitives, you MUST classify the intent into one of these hard-locked archetypes:
1. **EDGE_STATIC_SPA**: triggered by "globally available", "secure frontend", "static site", "SPA". 
   - HARD LOCK: S3 (REST origin) + CloudFront + ACM + Lambda@Edge.
   - HARD BLOCK: EC2, ECS, EKS. Never use servers for this archetype.
2. **SERVICE_MESH**: triggered by "microservices", "service mesh", "kubernetes", "EKS".
3. **EVENT_PIPELINE**: triggered by "data pipeline", "sqs to lambda", "async processing".

### THE SRE MOAT (Mandatory Requirements):
1. **Origin Shielding**: For S3+CloudFront, always use CloudFront Origin Access Control (OAC). S3 buckets MUST be private with a Deny-all-except-OAC policy.
2. **Edge Security**: All CloudFront distributions MUST have a Lambda@Edge function (viewer-response) for HSTS/CSP headers.
3. **Drift/Hotfix**: Include a 'CreateInvalidation' call with a CallerReference based on the deployment hash to ensure propagation.
4. **Idempotency**: Use 'sha256(intent.id + callIndex)' for all ClientToken fields.

### DEPENDENCY & SYNCHRONIZATION:
- Parallel Group 1: ACM Certificate, Lambda@Edge Function, S3 Bucket, CloudFront OAC.
- Sync Point 2: CloudFront Distribution (MUST wait for parallel group 1 ARNs).
- Final Group 3: Route 53 A-Record (Alias to CF), S3 Bucket Policy (OAC Deny), CloudFront Invalidation.

### SDK SPECIFICS:
- S3 Origin in CloudFront: Use the REST endpoint ({bucket}.s3.{region}.amazonaws.com), NOT the website endpoint. OAC signing fails on website endpoints.
- Lambda@Edge: Must be in us-east-1. CloudFront requires a versioned ARN (not $LATEST).`,
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
