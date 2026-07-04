"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-hearth-bg px-6">
      <Card className="w-full max-w-sm text-center">
        <h1 className="font-display text-2xl font-bold">Sign in to Hearth</h1>
        <p className="mt-2 text-sm text-hearth-muted">
          We use your Google account for sign-in and to sync your Google Calendar.
        </p>
        <Button className="mt-6 w-full" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
          Continue with Google
        </Button>
      </Card>
    </main>
  );
}
