import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { KeyRound, ShieldAlert } from "lucide-react";
import type { AwsCredentials } from "@/lib/intent-types";

interface CredentialsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (creds: AwsCredentials) => void;
}

export function CredentialsModal({ open, onOpenChange, onSave }: CredentialsModalProps) {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  const handleSave = () => {
    if (accessKeyId.trim() && secretAccessKey.trim()) {
      onSave({ accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            AWS Credentials
          </DialogTitle>
          <DialogDescription>
            Enter your AWS credentials. They are stored in memory only and never persisted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-md bg-muted text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Credentials are used solely for EC2 provisioning and cleared when you close this tab.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="access-key">Access Key ID</Label>
            <Input
              id="access-key"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secret-key">Secret Access Key</Label>
            <Input
              id="secret-key"
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              className="font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!accessKeyId.trim() || !secretAccessKey.trim()}>
            Save Credentials
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
