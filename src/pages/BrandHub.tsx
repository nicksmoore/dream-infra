import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandAssets } from "@/components/brand/BrandAssets";
import { BrandAgent } from "@/components/brand/BrandAgent";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Palette, Bot, Zap } from "lucide-react";

export default function BrandHub() {
  const [activeTab, setActiveTab] = useState("assets");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-border/50">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Palette className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-display font-semibold text-sm tracking-tight">naawi</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono border-primary/30 text-primary">
                brand
              </Badge>
            </div>
            <nav className="hidden md:flex items-center gap-1 ml-4">
              <NavLink to="/">Console</NavLink>
              <NavLink to="/community">Community</NavLink>
              <NavLink to="/brand" activeClassName="text-primary">Brand Hub</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-display font-bold tracking-tight mb-1">Brand Hub</h1>
          <p className="text-sm text-muted-foreground">
            Single source of truth for Naawi brand assets, guidelines, and AI-powered compliance.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="glass-panel border border-border/50 h-10 p-1">
            <TabsTrigger value="assets" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <Palette className="w-3.5 h-3.5" />
              Assets
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <Bot className="w-3.5 h-3.5" />
              Brand Agent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assets" className="animate-fade-in">
            <BrandAssets />
          </TabsContent>

          <TabsContent value="agent" className="animate-fade-in">
            <BrandAgent />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
