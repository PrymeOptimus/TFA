export const metadata = { title: "Thank you" };

export default function Thanks() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Thanks — we received your request</h1>
      <p className="mt-2 text-sm text-ink-3">A team member will follow up. If you agreed to texts, you may receive a confirmation message.</p>
    </main>
  );
}
