import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandAssets } from "@/components/brand/BrandAssets";
import { BrandAgent } from "@/components/brand/BrandAgent";
// Clay aesthetic
import { UserMenu } from "@/components/UserMenu";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Palette, Bot, Zap } from "lucide-react";

export default function BrandHub() {
  const [activeTab, setActiveTab] = useState("assets");

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-[#1a1a1a]" style={{ fontFamily: "'Instrument Sans', 'Inter', sans-serif" }}>
      <header className="sticky top-0 z-50 bg-[#f5f4f0]/80 backdrop-blur-xl border-b border-[#e8e7e4]">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between px-8 h-[64px]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#1a1a1a] flex items-center justify-center">
                <Palette className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>naawi</span>
            </div>
            <span className="text-[#ddd]">/</span>
            <span className="text-sm font-medium text-[#1a1a1a]">Brand Hub</span>
          </div>
          <div className="flex items-center gap-3">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl tracking-tight mb-1" style={{ fontFamily: "'DM Serif Display', serif" }}>Brand Hub</h1>
          <p className="text-sm text-[#888]">Single source of truth for Naawi brand assets, guidelines, and AI-powered compliance.</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-[#e8e7e4] h-10 p-1 rounded-full">
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
