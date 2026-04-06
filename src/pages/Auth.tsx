import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Mail, Lock, User, ArrowRight, Box, Check } from "lucide-react";

/* ─── Typing effect ─── */
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

/* ─── Preflight terminal ─── */
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
    <div className="rounded-2xl bg-[#1a1a1a] overflow-hidden shadow-[0_20px_60px_-16px_rgba(0,0,0,0.2)]">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.06]">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[10px] text-white/25 font-mono tracking-wider">PREFLIGHT</span>
      </div>
      <div className="p-5 font-mono text-xs leading-6 min-h-[200px]">
        {lines.map((line, i) => (
          <div
            key={`${i}-${line}`}
            className={`${
              i === 0 ? "text-white font-semibold" :
              line?.startsWith("⬢") ? "text-[hsl(199,89%,65%)] font-semibold mt-1" :
              line?.includes("✓") ? "text-[hsl(160,84%,55%)]" :
              "text-white/30"
            }`}
          >
            {line}
          </div>
        ))}
        {lines.length < steps.length && (
          <span className="inline-block w-2 h-4 bg-white/40 animate-pulse" />
        )}
      </div>
    </div>
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");

  const typedText = useTypingEffect([
    "Deploy a production EKS cluster",
    "Set up VPC with multi-AZ subnets",
    "Create serverless API with Lambda",
    "Migrate legacy infrastructure",
  ], 50, 2500);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
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
      options: { data: { display_name: signupName }, emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) {
      toast({ title: "Signup failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent a verification link to confirm your account." });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent a password reset link to your email." });
      setMode("login");
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-[#1a1a1a] relative overflow-hidden" style={{ fontFamily: "'Instrument Sans', 'Inter', sans-serif" }}>
      <div className="min-h-screen flex">
        {/* Left — brand + terminal */}
        <div className="hidden lg:flex flex-col justify-center flex-1 px-16 xl:px-24">
          <div className="max-w-lg">
            {/* Logo */}
            <div className="flex items-center gap-3 mb-12">
              <div className="h-9 w-9 rounded-full bg-[#1a1a1a] flex items-center justify-center">
                <Box className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-semibold tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>naawi</span>
            </div>

            <h1 className="text-[clamp(2.5rem,4vw,3.5rem)] font-normal leading-[1.1] tracking-[-0.02em]" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Infrastructure where{" "}
              <em className="not-italic text-[hsl(199,89%,48%)]">intent</em>{" "}
              becomes reality
            </h1>

            <p className="mt-5 text-lg text-[#888] leading-relaxed max-w-md">
              No YAML. No Terraform. Describe what you need — the engine validates, provisions, and verifies.
            </p>

            {/* Typing demo */}
            <div className="mt-8 px-5 py-4 rounded-2xl bg-white border border-[#e8e7e4] shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 text-[10px] text-[#bbb] uppercase tracking-widest font-mono mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(160,84%,39%)]" />
                Intent Input
              </div>
              <div className="font-mono text-sm text-[#1a1a1a]">
                <span className="text-[#ccc]">$ </span>
                <span>{typedText}</span>
                <span className="inline-block w-2 h-4 bg-[hsl(199,89%,48%)] animate-pulse ml-0.5 align-middle" />
              </div>
            </div>

            {/* Mini terminal */}
            <div className="mt-6">
              <PreflightTerminal />
            </div>

            {/* Trust signals */}
            <div className="mt-10 flex items-center gap-6 text-xs text-[#999]">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(160,84%,39%)]" />
                Zero Standing Credentials
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(199,89%,48%)]" />
                TEE-Attested Audit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(262,83%,58%)]" />
                Patent Pending
              </span>
            </div>
          </div>
        </div>

        {/* Right — auth form */}
        <div className="flex flex-col items-center justify-center w-full lg:w-[480px] lg:min-w-[480px] px-6 lg:px-12 bg-white lg:border-l border-[#e8e7e4]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-10">
            <div className="h-8 w-8 rounded-full bg-[#1a1a1a] flex items-center justify-center">
              <Box className="h-4 w-4 text-white" />
            </div>
            <span className="text-base font-semibold tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>naawi</span>
          </div>

          <div className="w-full max-w-sm">
            <div className="mb-8">
              <h2 className="text-2xl font-normal tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>
                {mode === "login" ? "Welcome back" : mode === "forgot" ? "Reset your password" : "Create your account"}
              </h2>
              <p className="text-sm text-[#888] mt-2">
                {mode === "login"
                  ? "Sign in to access the intent-driven console."
                  : mode === "forgot"
                  ? "Enter your email and we'll send you a reset link."
                  : "Get started with infrastructure as intent."}
              </p>
            </div>

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-xs font-medium text-[#888] flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Email
                  </Label>
                  <Input
                    id="login-email" type="email" value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-12 rounded-xl bg-[#fafaf8] border-[#e8e7e4] focus:border-[hsl(199,89%,48%)] text-sm"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-xs font-medium text-[#888] flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Password
                  </Label>
                  <Input
                    id="login-password" type="password" value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-12 rounded-xl bg-[#fafaf8] border-[#e8e7e4] focus:border-[hsl(199,89%,48%)] text-sm"
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-12 rounded-full text-sm font-medium bg-[#1a1a1a] text-white hover:bg-[#333] gap-2" disabled={loading}>
                  {loading ? "Signing in…" : <>Sign In <ArrowRight className="h-4 w-4" /></>}
                </Button>
                <div className="text-right">
                  <button type="button" onClick={() => { setMode("forgot"); setForgotEmail(loginEmail); }}
                    className="text-xs text-[hsl(199,89%,48%)] hover:underline font-medium">
                    Forgot password?
                  </button>
                </div>
              </form>
            ) : mode === "forgot" ? (
              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="forgot-email" className="text-xs font-medium text-[#888] flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Email
                  </Label>
                  <Input
                    id="forgot-email" type="email" value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-12 rounded-xl bg-[#fafaf8] border-[#e8e7e4] focus:border-[hsl(199,89%,48%)] text-sm"
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-12 rounded-full text-sm font-medium bg-[#1a1a1a] text-white hover:bg-[#333] gap-2" disabled={loading}>
                  {loading ? "Sending…" : <>Send Reset Link <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSignup} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="signup-name" className="text-xs font-medium text-[#888] flex items-center gap-1.5">
                    <User className="h-3 w-3" /> Display Name
                  </Label>
                  <Input
                    id="signup-name" value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    placeholder="Nick Moore"
                    className="h-12 rounded-xl bg-[#fafaf8] border-[#e8e7e4] focus:border-[hsl(199,89%,48%)] text-sm"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-xs font-medium text-[#888] flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> Email
                  </Label>
                  <Input
                    id="signup-email" type="email" value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-12 rounded-xl bg-[#fafaf8] border-[#e8e7e4] focus:border-[hsl(199,89%,48%)] text-sm"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-xs font-medium text-[#888] flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Password
                  </Label>
                  <Input
                    id="signup-password" type="password" value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="h-12 rounded-xl bg-[#fafaf8] border-[#e8e7e4] focus:border-[hsl(199,89%,48%)] text-sm"
                    minLength={6} required
                  />
                </div>
                <Button type="submit" className="w-full h-12 rounded-full text-sm font-medium bg-[#1a1a1a] text-white hover:bg-[#333] gap-2" disabled={loading}>
                  {loading ? "Creating account…" : <>Create Account <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </form>
            )}

            <div className="mt-6 text-center space-y-2">
              {mode === "forgot" ? (
                <button onClick={() => setMode("login")} className="text-xs text-[#888] hover:text-[#1a1a1a] transition-colors">
                  Back to <span className="text-[hsl(199,89%,48%)] font-medium">Sign in</span>
                </button>
              ) : (
                <button onClick={() => setMode(mode === "login" ? "signup" : "login")}
                  className="text-xs text-[#888] hover:text-[#1a1a1a] transition-colors">
                  {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                  <span className="text-[hsl(199,89%,48%)] font-medium">
                    {mode === "login" ? "Create one" : "Sign in"}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
