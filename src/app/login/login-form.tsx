"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPassword(fd: FormData) {
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email: String(fd.get("email")), password: String(fd.get("password")) });
    setPending(false);
    if (error) return setError(error.status === 429 ? "Too many attempts. Wait a minute and try again." : "Email or password is incorrect.");
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("totp");
    router.push("/today");
    router.refresh();
  }

  async function onTotp(fd: FormData) {
    setPending(true);
    setError(null);
    const code = String(fd.get("code") ?? "").replace(/\s/g, "");
    const { error } = code.length > 6 ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return setError("That code was not accepted. Check your authenticator app and try again.");
    router.push("/today");
    router.refresh();
  }

  if (step === "totp") {
    return (
      <form action={onTotp} className="space-y-4">
        <p className="text-sm text-ink-2">Enter the 6-digit code from your authenticator app, or a backup code.</p>
        <Field label="Verification code" htmlFor="code" error={error ?? undefined}>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required className={inputClass} autoFocus />
        </Field>
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>{pending ? "Verifying…" : "Verify"}</Button>
      </form>
    );
  }
  return (
    <form action={onPassword} className="space-y-4">
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </Field>
      <Field label="Password" htmlFor="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
