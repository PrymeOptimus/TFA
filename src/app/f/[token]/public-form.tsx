"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

type Errors = Record<string, string[] | undefined>;

export function PublicLeadForm(props: { token: string; submissionId: string; attribution: Record<string, string>; smsConsentText: string; marketingConsentText: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(fd: FormData) {
    setPending(true);
    setMessage(null);
    const fields = {
      firstName: String(fd.get("firstName") ?? ""),
      lastName: String(fd.get("lastName") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      message: String(fd.get("message") ?? ""),
      smsConsent: fd.get("smsConsent") === "on",
      marketingConsent: fd.get("marketingConsent") === "on",
      website: String(fd.get("website") ?? ""),
    };
    const attribution = { ...props.attribution, referrer: document.referrer, page_url: window.location.href.split("?")[0] ?? "" };
    try {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(props.token)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": props.submissionId },
        body: JSON.stringify({ fields, attribution }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return router.push(`/f/${props.token}/thanks`);
      setErrors((body?.error?.details as Errors) ?? {});
      setMessage(body?.error?.message ?? "Something went wrong. Please try again.");
    } catch {
      setMessage("Network error. Your request was not sent; please try again.");
    } finally {
      setPending(false);
    }
  }

  const err = (k: string) => errors[k]?.[0];
  return (
    <form action={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName" error={err("firstName")}><input id="firstName" name="firstName" required autoComplete="given-name" className={inputClass} aria-invalid={Boolean(err("firstName"))} /></Field>
        <Field label="Last name" htmlFor="lastName" error={err("lastName")}><input id="lastName" name="lastName" autoComplete="family-name" className={inputClass} /></Field>
      </div>
      <Field label="Email" htmlFor="email" error={err("email")}><input id="email" name="email" type="email" autoComplete="email" className={inputClass} aria-invalid={Boolean(err("email"))} /></Field>
      <Field label="Mobile phone" htmlFor="phone" error={err("phone")} hint="Provide an email, a phone number, or both."><input id="phone" name="phone" type="tel" autoComplete="tel" className={inputClass} aria-invalid={Boolean(err("phone"))} /></Field>
      <Field label="How can we help?" htmlFor="message" error={err("message")}><textarea id="message" name="message" rows={3} maxLength={2000} className={inputClass} /></Field>
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink-2">Contact preferences (optional)</legend>
        <label className="flex items-start gap-2 text-sm text-ink-2"><input type="checkbox" name="smsConsent" className="mt-1" /> <span>{props.smsConsentText}</span></label>
        <label className="flex items-start gap-2 text-sm text-ink-2"><input type="checkbox" name="marketingConsent" className="mt-1" /> <span>{props.marketingConsentText}</span></label>
      </fieldset>
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>{pending ? "Sending…" : "Send"}</Button>
    </form>
  );
}
