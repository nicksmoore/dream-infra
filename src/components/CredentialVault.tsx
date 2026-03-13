import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { KeyRound, Plus, Trash2, ShieldCheck, Cloud } from "lucide-react";
import type { CloudProvider, StoredCredential } from "@/lib/platform-types";
import { PROVIDER_OPTIONS } from "@/lib/platform-types";

export function CredentialVault() {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  // Add form state
  const [provider, setProvider] = useState<CloudProvider>("aws");
  const [label, setLabel] = useState("default");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCredentials = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_credentials")
      .select("id, provider, label, created_at, updated_at")
      .eq("user_id", user.id);
    setCredentials((data || []) as StoredCredential[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchCredentials();
  }, [user]);

  const handleAdd = async () => {
    if (!user || !accessKeyId.trim() || !secretAccessKey.trim()) return;
    setSaving(true);

    const { error } = await supabase.functions.invoke("credential-vault", {
      body: {
        action: "store",
        provider,
        label,
        credentials: { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() },
      },
    });

    setSaving(false);
    if (error) {
      toast({ title: "Failed to store credentials", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Credentials stored", description: `${provider.toUpperCase()} credentials encrypted and saved.` });
      setAddOpen(false);
      setAccessKeyId("");
      setSecretAccessKey("");
      fetchCredentials();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("user_credentials")
      .delete()
      .eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Credentials removed" });
      fetchCredentials();
    }
  };

  if (loading) return <div className="text-muted-foreground text-sm">Loading vault…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Credential Vault (BYOC)
        </CardTitle>
        <CardDescription>
          Your cloud credentials are encrypted with AES-256 and stored per-user. Never shared, never logged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {credentials.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No credentials stored. Add your cloud provider keys to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {credentials.map((cred) => (
              <div key={cred.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-3">
                  <Cloud className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{cred.provider.toUpperCase()} — {cred.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(cred.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(cred.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add Credentials
        </Button>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                Store Cloud Credentials
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={provider} onValueChange={(v) => setProvider(v as CloudProvider)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROVIDER_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.icon} {p.value.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="default" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Access Key ID</Label>
                <Input
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Secret Access Key</Label>
                <Input
                  type="password"
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={saving || !accessKeyId.trim() || !secretAccessKey.trim()}>
                {saving ? "Encrypting…" : "Store Securely"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
