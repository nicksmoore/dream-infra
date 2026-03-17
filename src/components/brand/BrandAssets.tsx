import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Copy, Check, Download, Type, Palette as PaletteIcon, Image } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ── Brand Data ──

const BRAND_COLORS = [
  { name: "Primary Blue", hex: "#2563EB", hsl: "215 80% 52%", tailwind: "primary", usage: "CTAs, links, active states" },
  { name: "Primary Dark", hex: "#1E40AF", hsl: "215 80% 40%", tailwind: "primary/80", usage: "Hover states, emphasis" },
  { name: "Background Dark", hex: "#0F1219", hsl: "225 20% 7%", tailwind: "background", usage: "Page backgrounds (dark)" },
  { name: "Surface", hex: "#1A1F2E", hsl: "225 18% 11%", tailwind: "card", usage: "Cards, panels, elevated surfaces" },
  { name: "Surface Elevated", hex: "#242A3A", hsl: "225 16% 16%", tailwind: "secondary", usage: "Modals, dropdowns" },
  { name: "Foreground", hex: "#E2E4EA", hsl: "220 14% 90%", tailwind: "foreground", usage: "Primary text" },
  { name: "Muted", hex: "#7C8294", hsl: "220 10% 52%", tailwind: "muted-foreground", usage: "Secondary text, labels" },
  { name: "Border", hex: "#2A3040", hsl: "225 14% 18%", tailwind: "border", usage: "Borders, dividers" },
  { name: "Success", hex: "#22C55E", hsl: "142 60% 45%", tailwind: "success", usage: "Positive states, confirmations" },
  { name: "Warning", hex: "#F59E0B", hsl: "38 92% 50%", tailwind: "warning", usage: "Caution states" },
  { name: "Destructive", hex: "#B91C1C", hsl: "0 62.8% 30.6%", tailwind: "destructive", usage: "Error states, danger actions" },
  { name: "Nexus Glow", hex: "#22C55E", hsl: "150 80% 50%", tailwind: "nexus-glow", usage: "Community accents" },
  { name: "Nexus Magenta", hex: "#D946EF", hsl: "320 80% 55%", tailwind: "nexus-magenta", usage: "Community highlights" },
  { name: "Nexus Cyan", hex: "#22D3EE", hsl: "185 90% 55%", tailwind: "nexus-cyan", usage: "Community accents" },
];

const TYPOGRAPHY = [
  { name: "Space Grotesk", role: "Display / Headings", weights: ["400", "500", "600", "700"], sample: "Naawi Infrastructure Compiler", className: "font-display" },
  { name: "Inter", role: "Body / UI", weights: ["300", "400", "500", "600", "700"], sample: "Deploy payments-core in Zig with PCI-DSS compliance.", className: "font-sans" },
  { name: "JetBrains Mono", role: "Code / Terminal", weights: ["400", "500", "600"], sample: "naawi dry-run --intent scale-deployment", className: "font-mono" },
];

const LOGOS = [
  { name: "Naawi Mark", variant: "Icon", description: "Gradient icon for compact spaces", format: "SVG", element: (
    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
      <span className="text-2xl font-display font-bold text-primary-foreground">N</span>
    </div>
  )},
  { name: "Naawi Wordmark", variant: "Full", description: "Wordmark + badge for headers", format: "SVG", element: (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
        <span className="text-sm font-display font-bold text-primary-foreground">N</span>
      </div>
      <span className="font-display font-semibold text-lg tracking-tight text-foreground">naawi</span>
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono border-primary/30 text-primary">v1</Badge>
    </div>
  )},
  { name: "Naawi Mono", variant: "Terminal", description: "Monospace for CLI / terminal contexts", format: "SVG", element: (
    <div className="flex items-center gap-1.5 font-mono text-sm">
      <span className="text-primary font-semibold">▸</span>
      <span className="text-foreground font-medium">naawi</span>
      <span className="text-muted-foreground">//</span>
      <span className="text-muted-foreground text-xs">infra-compiler</span>
    </div>
  )},
];

export function BrandAssets() {
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    toast({ title: "Copied", description: `${label} copied to clipboard` });
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredColors = BRAND_COLORS.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.usage.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search assets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 glass-input"
        />
      </div>

      {/* Logos */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Image className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-semibold uppercase tracking-wider text-muted-foreground">Logos</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {LOGOS.map((logo) => (
            <Card key={logo.name} className="glass-panel border-border/50 hover:border-primary/30 transition-colors group">
              <CardContent className="p-6">
                <div className="h-24 flex items-center justify-center mb-4 rounded-lg bg-background/50">
                  {logo.element}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{logo.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 h-4 font-mono">{logo.format}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{logo.description}</p>
                  <Badge variant="secondary" className="text-[10px] mt-1">{logo.variant}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Typography */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Type className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-semibold uppercase tracking-wider text-muted-foreground">Typography</h2>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {TYPOGRAPHY.map((font) => (
            <Card key={font.name} className="glass-panel border-border/50">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{font.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 h-4">{font.role}</Badge>
                    </div>
                    <p className={`text-xl ${font.className} text-foreground`}>{font.sample}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {font.weights.map(w => (
                        <Badge key={w} variant="secondary" className="text-[10px] font-mono">{w}</Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs shrink-0"
                    onClick={() => copyToClipboard(font.className.replace("font-", ""), font.name)}
                  >
                    {copied === font.name ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    Copy class
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Color Palette */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <PaletteIcon className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-display font-semibold uppercase tracking-wider text-muted-foreground">Color Palette</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredColors.map((color) => (
            <Card key={color.name} className="glass-panel border-border/50 hover:border-primary/30 transition-colors overflow-hidden group">
              <div className="h-16 w-full" style={{ backgroundColor: color.hex }} />
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{color.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyToClipboard(color.hex, color.name)}
                  >
                    {copied === color.name ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">HEX</span>
                    <span className="text-xs font-mono text-foreground">{color.hex}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">HSL</span>
                    <span className="text-xs font-mono text-foreground">{color.hsl}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">TW</span>
                    <span className="text-xs font-mono text-primary">{color.tailwind}</span>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">{color.usage}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
