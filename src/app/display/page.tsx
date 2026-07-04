import { customAlphabet } from "nanoid";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const displayCodeId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 24);
const pairingCodeId = customAlphabet("0123456789", 6);

// This mints a new row on every visit — it must never be statically
// prerendered or cached, otherwise every device would be handed the same
// displayCode.
export const dynamic = "force-dynamic";

/** Visiting /display with no code mints a fresh, unclaimed display and hands the browser its permanent URL. */
export default async function NewDisplayPage() {
  const display = await prisma.display.create({
    data: { displayCode: displayCodeId(), pairingCode: pairingCodeId() },
    select: { displayCode: true },
  });

  redirect(`/display/${display.displayCode}`);
}
