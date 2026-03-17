import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Send, Upload, Image, Sparkles, Palette, Type, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ── Brand Knowledge Base (grounding the agent) ──

const BRAND_KNOWLEDGE = {
  colors: {
    primary: { hex: "#2563EB", hsl: "215 80% 52%", name: "Primary Blue" },
    background: { hex: "#0F1219", hsl: "225 20% 7%", name: "Background Dark" },
    surface: { hex: "#1A1F2E", hsl: "225 18% 11%", name: "Surface" },
    foreground: { hex: "#E2E4EA", hsl: "220 14% 90%", name: "Foreground" },
    muted: { hex: "#7C8294", hsl: "220 10% 52%", name: "Muted" },
    success: { hex: "#22C55E", hsl: "142 60% 45%", name: "Success Green" },
    warning: { hex: "#F59E0B", hsl: "38 92% 50%", name: "Warning Amber" },
    destructive: { hex: "#B91C1C", hsl: "0 62.8% 30.6%", name: "Destructive Red" },
  },
  fonts: {
    display: "Space Grotesk",
    body: "Inter",
    mono: "JetBrains Mono",
  },
  guidelines: {
    logoMinSize: "24px",
    minContrast: 4.5,
    borderRadius: "1rem (--radius)",
    darkModeFirst: true,
  },
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  brandScore?: BrandScore;
};

type BrandScore = {
  score: number;
  checks: { name: string; status: "pass" | "warn" | "fail"; detail: string }[];
};

function analyzeBrandCompliance(query: string, hasImage: boolean): { response: string; brandScore?: BrandScore } {
  const q = query.toLowerCase();

  // Image upload → simulate brand scoring
  if (hasImage) {
    const score: BrandScore = {
      score: 78,
      checks: [
        { name: "Color Palette", status: "pass", detail: "Primary blue (#2563EB) detected correctly" },
        { name: "Typography", status: "warn", detail: "Body text appears to use system font instead of Inter" },
        { name: "Logo Placement", status: "pass", detail: "Logo positioned in top-left with adequate clearspace" },
        { name: "Dark Mode", status: "pass", detail: "Background uses correct dark surface (#1A1F2E)" },
        { name: "Contrast Ratio", status: "warn", detail: "Muted text on dark surface: 3.8:1 (min 4.5:1)" },
        { name: "Border Radius", status: "pass", detail: "Consistent 1rem radius on cards" },
        { name: "Spacing", status: "fail", detail: "Inconsistent padding: 16px and 24px mixed within same card group" },
      ],
    };
    return {
      response: `## Brand Score: ${score.score}/100\n\nI analyzed the uploaded screenshot against the Naawi brand guidelines. Here's the breakdown:\n\n**Strengths:** Color palette alignment and logo placement are correct.\n\n**Issues to fix:**\n- Switch body font from system default to **Inter**\n- Increase contrast on muted text (currently 3.8:1, needs 4.5:1)\n- Standardize card padding to **24px** (p-6)`,
      brandScore: score,
    };
  }

  // Color queries
  if (q.includes("color") || q.includes("palette") || q.includes("hex") || q.includes("blue")) {
    return {
      response: `## Naawi Color System\n\nOur palette is built on HSL tokens for theme flexibility:\n\n| Token | Hex | Usage |\n|-------|-----|-------|\n| \`primary\` | \`#2563EB\` | CTAs, links, active states |\n| \`background\` | \`#0F1219\` | Page backgrounds (dark) |\n| \`surface\` | \`#1A1F2E\` | Cards, panels |\n| \`foreground\` | \`#E2E4EA\` | Primary text |\n| \`muted-foreground\` | \`#7C8294\` | Secondary text |\n\nAlways use semantic Tailwind classes like \`bg-primary\` rather than raw hex values.`,
    };
  }

  // Typography queries
  if (q.includes("font") || q.includes("type") || q.includes("typography") || q.includes("heading")) {
    return {
      response: `## Typography Stack\n\n| Role | Font | Usage |\n|------|------|-------|\n| Display | **Space Grotesk** | Headings, hero text |\n| Body | **Inter** | UI text, paragraphs |\n| Code | **JetBrains Mono** | Terminal, code blocks |\n\nUse \`font-display\`, \`font-sans\`, or \`font-mono\` Tailwind classes. Never use system defaults.`,
    };
  }

  // Logo queries
  if (q.includes("logo") || q.includes("mark") || q.includes("icon")) {
    return {
      response: `## Logo Guidelines\n\n**Three variants:**\n1. **Naawi Mark** — Gradient icon (min 24×24px)\n2. **Naawi Wordmark** — Full logo with badge for headers\n3. **Naawi Mono** — Terminal-style for CLI contexts\n\n**Rules:**\n- Minimum clearspace: 8px on all sides\n- Never stretch or rotate\n- On dark backgrounds, use the gradient mark\n- On light backgrounds, use solid primary blue`,
    };
  }

  // Spacing / layout
  if (q.includes("spacing") || q.includes("padding") || q.includes("layout") || q.includes("grid")) {
    return {
      response: `## Spacing System\n\n- Base unit: **4px** (Tailwind's default)\n- Card padding: \`p-6\` (24px)\n- Section gaps: \`gap-8\` (32px)\n- Border radius: \`rounded-lg\` (var(--radius) = 1rem)\n- Max content width: **1400px**\n\nUse the \`glass-panel\` class for frosted surfaces and \`glass-panel-elevated\` for modals/popovers.`,
    };
  }

  // Default
  return {
    response: `I'm the Naawi Brand Agent. I can help you with:\n\n- 🎨 **Colors** — Ask about our palette, hex values, or Tailwind tokens\n- 🔤 **Typography** — Font families, weights, and usage guidelines\n- 🖼️ **Logos** — Variants, clearspace, and placement rules\n- 📐 **Spacing** — Layout grid, padding, and radius standards\n- 📸 **Brand Score** — Upload a screenshot and I'll analyze brand compliance\n\nWhat would you like to know?`,
  };
}

export function BrandAgent() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Welcome to the Naawi Brand Agent. I have direct access to the brand asset database and can analyze screenshots for compliance. Ask me about colors, typography, logos, or upload a screenshot for a Brand Score.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sendMessage = useCallback((text: string, imageUrl?: string) => {
    if (!text.trim() && !imageUrl) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text || "Analyze this screenshot for brand compliance",
      imageUrl,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsAnalyzing(true);

    // Simulate agent analysis
    setTimeout(() => {
      const { response, brandScore } = analyzeBrandCompliance(text, !!imageUrl);
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response,
        brandScore,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsAnalyzing(false);
    }, 800);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(file);
    sendMessage("Analyze this screenshot for brand compliance", url);
    e.target.value = "";
  };

  const statusIcon = (status: "pass" | "warn" | "fail") => {
    if (status === "pass") return <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--success))]" />;
    if (status === "warn") return <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--warning))]" />;
    return <XCircle className="w-3.5 h-3.5 text-destructive" />;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-220px)]">
      {/* Chat */}
      <div className="lg:col-span-2 flex flex-col glass-panel-elevated rounded-xl border border-border/50 overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
          <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-foreground">Brand Agent</span>
          <Badge variant="outline" className="text-[10px] px-1.5 h-4 font-mono border-primary/30 text-primary">AI</Badge>
          <span className="text-[11px] text-muted-foreground ml-auto">Grounded on Naawi Brand DB</span>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4 max-w-2xl mx-auto">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "glass-panel border border-border/50"
                }`}>
                  {msg.imageUrl && (
                    <img src={msg.imageUrl} alt="Uploaded screenshot" className="rounded-lg mb-2 max-h-48 object-cover" />
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed text-sm">
                    {msg.content.split("\n").map((line, i) => {
                      if (line.startsWith("##")) return <h3 key={i} className="text-sm font-display font-semibold mt-2 mb-1">{line.replace("## ", "")}</h3>;
                      if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-semibold mt-1">{line.replace(/\*\*/g, "")}</p>;
                      if (line.startsWith("- ")) return <p key={i} className="ml-2">{line}</p>;
                      if (line.startsWith("|")) return <pre key={i} className="text-[11px] font-mono text-muted-foreground overflow-x-auto">{line}</pre>;
                      return <p key={i}>{line}</p>;
                    })}
                  </div>

                  {/* Brand Score Card */}
                  {msg.brandScore && (
                    <Card className="mt-3 border border-border/50 bg-background/50">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">Compliance Checks</span>
                          <Badge className={`text-[10px] ${msg.brandScore.score >= 80 ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]" : msg.brandScore.score >= 60 ? "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]" : "bg-destructive/20 text-destructive"}`}>
                            {msg.brandScore.score}/100
                          </Badge>
                        </div>
                        <div className="space-y-1.5">
                          {msg.brandScore.checks.map((check, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              {statusIcon(check.status)}
                              <div>
                                <span className="font-medium text-foreground">{check.name}: </span>
                                <span className="text-muted-foreground">{check.detail}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            ))}

            {isAnalyzing && (
              <div className="flex justify-start">
                <div className="glass-panel border border-border/50 rounded-xl px-4 py-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Sparkles className="w-3.5 h-3.5 animate-glow-pulse text-primary" />
                    <span>Analyzing against brand database…</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t border-border/50 p-3">
          <div className="flex items-center gap-2 max-w-2xl mx-auto">
            <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-9 w-9"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" />
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
              placeholder="Ask about colors, typography, logos, or upload a screenshot…"
              className="glass-input text-sm"
            />
            <Button
              size="icon"
              className="shrink-0 h-9 w-9"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isAnalyzing}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Quick Reference Sidebar */}
      <div className="hidden lg:block space-y-4">
        <Card className="glass-panel border-border/50">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-primary" />
              Quick Reference
            </h3>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(BRAND_KNOWLEDGE.colors).slice(0, 8).map(([key, c]) => (
                <div key={key} className="group cursor-pointer" onClick={() => navigator.clipboard.writeText(c.hex)}>
                  <div className="w-full aspect-square rounded-md border border-border/30 group-hover:ring-1 group-hover:ring-primary/50 transition-all" style={{ backgroundColor: c.hex }} />
                  <p className="text-[9px] font-mono text-muted-foreground mt-0.5 truncate">{c.hex}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel border-border/50">
          <CardContent className="p-4 space-y-2">
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-primary" />
              Fonts
            </h3>
            {Object.entries(BRAND_KNOWLEDGE.fonts).map(([role, name]) => (
              <div key={role} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground capitalize">{role}</span>
                <span className="text-xs font-medium text-foreground">{name}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="glass-panel border-border/50">
          <CardContent className="p-4 space-y-2">
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Try Asking
            </h3>
            {[
              "What's the primary color hex?",
              "Which font for headings?",
              "Logo clearspace rules",
              "Upload a screenshot for scoring",
            ].map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md px-2 py-1.5 transition-colors"
              >
                {q}
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
