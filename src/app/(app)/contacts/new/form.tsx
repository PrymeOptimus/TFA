"use client";
import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { createContactAction } from "../../actions";

export function NewContactForm() {
  const [state, action, pending] = useActionState(createContactAction, null);
  return (
    <form action={action} className="grid max-w-xl gap-4 sm:grid-cols-2">
      <Field label="First name" htmlFor="firstName"><input id="firstName" name="firstName" required className={inputClass} /></Field>
      <Field label="Last name" htmlFor="lastName"><input id="lastName" name="lastName" className={inputClass} /></Field>
      <Field label="Email" htmlFor="email"><input id="email" name="email" type="email" className={inputClass} /></Field>
      <Field label="Phone" htmlFor="phone"><input id="phone" name="phone" type="tel" className={inputClass} /></Field>
      <div className="sm:col-span-2">
        {state && !state.ok && <p role="alert" className="mb-2 text-sm text-danger">{state.message}</p>}
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Creating…" : "Create contact"}</Button>
      </div>
    </form>
  );
}
