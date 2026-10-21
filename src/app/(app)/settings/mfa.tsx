"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Field, inputClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function MfaSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function begin(fd: FormData) {
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password: String(fd.get("password")) });
    setPending(false);
    if (error || !data || !("totpURI" in data)) return setError("Password was not accepted.");
    setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }
  async function verify(fd: FormData) {
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: String(fd.get("code")).replace(/\s/g, "") });
    setPending(false);
    if (error) return setError("That code was not accepted.");
    setSetup(null);
    router.refresh();
  }
  async function disable(fd: FormData) {
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.disable({ password: String(fd.get("password")) });
    setPending(false);
    if (error) return setError("Password was not accepted.");
    router.refresh();
  }

  if (enabled) {
    return (
      <form action={disable} className="max-w-sm space-y-3">
        <p className="text-sm">Two-step verification: <Badge tone="ok">On</Badge></p>
        <Field label="Password to turn off" htmlFor="mfa-off-pw" error={error ?? undefined}><input id="mfa-off-pw" name="password" type="password" required className={inputClass} /></Field>
        <Button type="submit" variant="danger" disabled={pending}>Turn off two-step verification</Button>
      </form>
    );
  }
  if (setup) {
    const secret = new URL(setup.totpURI).searchParams.get("secret");
    return (
      <form action={verify} className="max-w-lg space-y-3">
        <p className="text-sm">Add this account to an authenticator app using the setup key, then enter a code to finish.</p>
        <p className="text-sm">Setup key: <code className="break-all rounded bg-canvas px-1">{secret}</code></p>
        <details className="text-xs text-ink-3"><summary>Show otpauth URI</summary><code className="break-all">{setup.totpURI}</code></details>
        <div className="rounded-md bg-warn-soft p-3 text-xs text-warn">
          Save these backup codes now; they are shown once: <code className="break-all">{setup.backupCodes.join("  ")}</code>
        </div>
        <Field label="6-digit code" htmlFor="mfa-code" error={error ?? undefined}><input id="mfa-code" name="code" inputMode="numeric" required className={inputClass} /></Field>
        <Button type="submit" variant="primary" disabled={pending}>Verify and turn on</Button>
      </form>
    );
  }
  return (
    <form action={begin} className="max-w-sm space-y-3">
      <p className="text-sm">Two-step verification (TOTP authenticator app): <Badge>Off</Badge></p>
      <Field label="Confirm your password" htmlFor="mfa-pw" error={error ?? undefined}><input id="mfa-pw" name="password" type="password" required className={inputClass} /></Field>
      <Button type="submit" variant="primary" disabled={pending}>Set up two-step verification</Button>
      <p className="text-xs text-ink-3">Requiring MFA for every member is planned as an owner policy before commercial release.</p>
    </form>
  );
}
