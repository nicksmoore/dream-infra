import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";

interface IntentInputProps {
  onParse: (input: string) => void;
  isLoading: boolean;
}

export function IntentInput({ onParse, isLoading }: IntentInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = () => {
    if (input.trim()) onParse(input.trim());
  };

  const suggestions = [
    "Deploy a production EKS cluster in us-west-2",
    "Set up a VPC with 3 subnets across AZs",
    "Create a serverless API with Lambda and DynamoDB",
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight font-display text-foreground leading-tight">
          What do you want to deploy?
        </h2>
        <p className="text-base text-muted-foreground mt-2 max-w-lg">
          Describe your infrastructure in plain English. The engine resolves intent to a validated Golden Path.
        </p>
      </div>

      <div className="relative group">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Deploy a production-ready Kubernetes cluster..."
          className="w-full h-14 pl-5 pr-14 rounded-2xl bg-card border border-border text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
        />
        <Button
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          size="icon"
          className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => { setInput(s); onParse(s); }}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
