import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Mail, Lock, User, ArrowRight, Terminal } from "lucide-react";

/* ─── Animated typing hook ─── */
function useTypingEffect(texts: string[], speed = 40, pause = 2000) {
  const [display, setDisplay] = useState("");
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = texts[lineIndex];
    if (!isDeleting && charIndex < current.length) {
      const t = setTimeout(() => setCharIndex(c => c + 1), speed);
      return () => clearTimeout(t);
    }
    if (!isDeleting && charIndex === current.length) {
      const t = setTimeout(() => setIsDeleting(true), pause);
      return () => clearTimeout(t);
    }
    if (isDeleting && charIndex > 0) {
      const t = setTimeout(() => setCharIndex(c => c - 1), speed / 2);
      return () => clearTimeout(t);
    }
    if (isDeleting && charIndex === 0) {
      setIsDeleting(false);
      setLineIndex(i => (i + 1) % texts.length);
    }
  }, [charIndex, isDeleting, lineIndex, texts, speed, pause]);

  useEffect(() => {
    setDisplay(texts[lineIndex].slice(0, charIndex));
  }, [charIndex, lineIndex, texts]);

  return display;
}

/* ─── Floating nodes canvas ─── */
function NodeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const nodes: { x: number; y: number; vx: number; vy: number; r: number; hue: number }[] = [];
    const NODE_COUNT = 40;

    const resize = () => {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 1,
        hue: [199, 160, 270, 38][Math.floor(Math.random() * 4)],
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

      // Draw edges
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            const alpha = (1 - dist / 120) * 0.12;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `hsla(199, 89%, 48%, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > canvas.offsetWidth) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.offsetHeight) n.vy *= -1;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${n.hue}, 80%, 55%, 0.5)`;
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 3, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3);
        g.addColorStop(0, `hsla(${n.hue}, 80%, 55%, 0.15)`);
        g.addColorStop(1, `hsla(${n.hue}, 80%, 55%, 0)`);
        ctx.fillStyle = g;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

/* ─── Terminal preflight display ─── */
function PreflightTerminal() {
  const [lines, setLines] = useState<string[]>([]);
  const steps = [
    "$ naawi preflight --env production",
    "→ P-1 Parameter validation .......... ✓",
    "→ P-2 Dolt state read (0 API calls) . ✓",
    "→ P-3 RMCM coherence: 0.97 ......... ✓",
    "→ P-4 JIT credential pre-check ...... ✓",
    "→ P-5 Dry-run (shared closure) ...... ✓",
    "→ P-6 PREFLIGHT_COMPLETE ............ ✓",
    "",
    "⬢ Deploy button activated.",
  ];

  useEffect(() => {
    let i = 0;
    let resetting = false;
    const interval = setInterval(() => {
      if (i < steps.length) {
        setLines(prev => [...prev, steps[i]]);
        i++;
      } else if (!resetting) {
        resetting = true;
        setTimeout(() => {
          setLines([]);
          i = 0;
          resetting = false;
        }, 3000);
      }
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-xl border border-border/60 bg-background/80 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-3 text-[10px] text-muted-foreground font-mono tracking-wider">PREFLIGHT</span>
      </div>
      <div className="p-4 font-mono text-xs leading-6 min-h-[200px]">
        {lines.map((line, i) => (
          <div
            key={`${i}-${line}`}
            className={`animate-fade-in ${
              i === 0 ? "text-foreground font-semibold" :
              line?.startsWith("⬢") ? "text-primary font-semibold mt-1" :
              line?.includes("✓") ? "text-[hsl(var(--success))]" :
              "text-muted-foreground"
            }`}
          >
            {line}
          </div>
        ))}
        {lines.length < steps.length && (
          <span className="typing-cursor text-muted-foreground/40" />
        )}
      </div>
    </div>
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");

  const typedText = useTypingEffect([
    "Deploy a production EKS cluster",
    "Set up VPC with multi-AZ subnets",
    "Create serverless API with Lambda",
    "Migrate legacy infrastructure",
    "Scale compute to handle 10x traffic",
  ], 50, 2500);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } else {
      navigate("/console");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        data: { display_name: signupName },
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) {
      toast({ title: "Signup failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent a verification link to confirm your account." });
    }
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Node-edge background */}
      <div className="absolute inset-0 pointer-events-none opacity-60">
        <NodeCanvas />
      </div>

      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[600px] h-[400px] bg-primary/[0.04] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[350px] bg-[hsl(270,80%,55%)]/[0.03] rounded-full blur-[130px]" />
      </div>

      <div className="relative z-10 min-h-screen flex">
        {/* Left — brand + terminal */}
        <div className="hidden lg:flex flex-col justify-center flex-1 px-16 xl:px-24">
          <div className="max-w-lg">
            {/* Logo */}
            <div className="flex items-center gap-3 mb-12">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Terminal className="h-5 w-5 text-primary" />
              </div>
              <span className="text-lg font-bold tracking-tight font-display text-foreground">Naawi</span>
            </div>

            {/* Kinetic heading */}
            <h1 className="text-4xl xl:text-5xl font-bold tracking-tight leading-[1.1] text-foreground font-display">
              Infrastructure where{" "}
              <span className="text-primary">intent</span>{" "}
              becomes reality
            </h1>

            <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-md">
              No YAML. No Terraform. Describe what you need — the engine validates, provisions, and verifies.
            </p>

            {/* Typing demo */}
            <div className="mt-8 px-4 py-3 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 uppercase tracking-widest font-mono mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Intent Input
              </div>
              <div className="font-mono text-sm text-foreground">
                <span className="text-muted-foreground/40">$ </span>
                <span>{typedText}</span>
                <span className="typing-cursor" />
              </div>
            </div>

            {/* Mini terminal */}
            <div className="mt-6">
              <PreflightTerminal />
            </div>

            {/* Trust signals */}
            <div className="mt-10 flex items-center gap-6 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Zero Standing Credentials
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                TEE-Attested Audit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(270,80%,55%)]" />
                Patent Pending
              </span>
            </div>
          </div>
        </div>

        {/* Right — auth form */}
        <div className="flex flex-col items-center justify-center w-full lg:w-[480px] lg:min-w-[480px] px-6 lg:px-12 lg:border-l border-border/30">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-10">
            <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Terminal className="h-4 w-4 text-primary" />
            </div>
            <span className="text-base font-bold tracking-tight font-display text-foreground">Naawi</span>
          </div>

          <div className="w-full max-w-sm">
            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight font-display text-foreground">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5">
                {mode === "login"
                  ? "Sign in to access the intent-driven console."
                  : "Get started with infrastructure as intent."}
              </p>
            </div>

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Email
                  </Label>
                  <Input
                    id="login-email"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-12 rounded-xl bg-card border-border/60 focus:border-primary/50 text-sm"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Password
                  </Label>
                  <Input
                    id="login-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-12 rounded-xl bg-card border-border/60 focus:border-primary/50 text-sm"
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold gap-2" disabled={loading}>
                  {loading ? "Signing in…" : <>Sign In <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="signup-name" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <User className="h-3 w-3" /> Display Name
                  </Label>
                  <Input
                    id="signup-name"
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    placeholder="Nick Moore"
                    className="h-12 rounded-xl bg-card border-border/60 focus:border-primary/50 text-sm"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Email
                  </Label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-12 rounded-xl bg-card border-border/60 focus:border-primary/50 text-sm"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Password
                  </Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="h-12 rounded-xl bg-card border-border/60 focus:border-primary/50 text-sm"
                    minLength={6}
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold gap-2" disabled={loading}>
                  {loading ? "Creating account…" : <>Create Account <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </form>
            )}

            {/* Toggle mode */}
            <div className="mt-6 text-center">
              <button
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                <span className="text-primary font-medium">
                  {mode === "login" ? "Create one" : "Sign in"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
