import { PageHeader, Card } from "@/components/ui";
import { authorize } from "@/server/authz";
import { requireActor } from "@/server/session";
import { NewContactForm } from "./form";

export const metadata = { title: "New contact" };

export default async function NewContactPage() {
  const actor = await requireActor();
  authorize(actor, "contacts.write");
  return (
    <>
      <PageHeader title="New contact" description="Use synthetic details only in this prototype." />
      <Card><NewContactForm /></Card>
    </>
  );
}
