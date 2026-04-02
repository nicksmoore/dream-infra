import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Lock, ArrowRight, Terminal, CheckCircle2 } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Check for recovery event from the URL hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    // Also check hash params directly
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please make sure both passwords are identical.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password too short", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
    } else {
      setDone(true);
      toast({ title: "Password updated", description: "Your password has been reset successfully." });
      setTimeout(() => navigate("/console"), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[600px] h-[400px] bg-primary/[0.04] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[350px] bg-[hsl(270,80%,55%)]/[0.03] rounded-full blur-[130px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-10 justify-center">
          <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Terminal className="h-4 w-4 text-primary" />
          </div>
          <span className="text-base font-bold tracking-tight font-display text-foreground">Naawi</span>
        </div>

        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-[hsl(var(--success))] mx-auto" />
            <h2 className="text-2xl font-bold tracking-tight font-display text-foreground">Password Updated</h2>
            <p className="text-sm text-muted-foreground">Redirecting you to the console…</p>
          </div>
        ) : !isRecovery ? (
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold tracking-tight font-display text-foreground">Invalid Reset Link</h2>
            <p className="text-sm text-muted-foreground">
              This link is invalid or has expired. Please request a new password reset.
            </p>
            <Button onClick={() => navigate("/auth")} variant="outline" className="gap-2">
              Back to Sign In <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight font-display text-foreground">Set new password</h2>
              <p className="text-sm text-muted-foreground mt-1.5">
                Enter your new password below.
              </p>
            </div>

            <form onSubmit={handleReset} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Lock className="h-3 w-3" /> New Password
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="h-12 rounded-xl bg-card border-border/60 focus:border-primary/50 text-sm"
                  minLength={6}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Lock className="h-3 w-3" /> Confirm Password
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="h-12 rounded-xl bg-card border-border/60 focus:border-primary/50 text-sm"
                  minLength={6}
                  required
                />
              </div>
              <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold gap-2" disabled={loading}>
                {loading ? "Updating…" : <>Reset Password <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
