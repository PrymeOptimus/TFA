import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Button } from "@/components/ui/Button";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-hearth-bg px-6 text-center">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Hearth</h1>
        <p className="mt-3 max-w-md text-lg text-hearth-muted">
          One calm screen for the whole family — calendar, chores, meals, and notes, glanceable from across the kitchen.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/login">
          <Button size="lg">Get started</Button>
        </Link>
        <Link href="/display">
          <Button size="lg" variant="secondary">
            Set up a display
          </Button>
        </Link>
      </div>
    </main>
  );
}
