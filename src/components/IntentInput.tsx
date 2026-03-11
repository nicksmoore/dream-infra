import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";

interface IntentInputProps {
  onParse: (input: string) => void;
  isLoading: boolean;
}

export function IntentInput({ onParse, isLoading }: IntentInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = () => {
    if (input.trim()) onParse(input.trim());
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Describe your infrastructure</h2>
      </div>
      <div className="relative">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='e.g. "Deploy a small dev server for testing" or "I need a high-performance compute instance in EU for production"'
          className="min-h-[100px] resize-none font-mono text-sm bg-card border-border"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Press ⌘+Enter to parse</p>
        <Button onClick={handleSubmit} disabled={!input.trim() || isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Parse Intent
        </Button>
      </div>
    </div>
  );
}
