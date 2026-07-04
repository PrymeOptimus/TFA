import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/app/dashboard/DashboardShell";
import { OnboardingForm } from "@/app/dashboard/OnboardingForm";
import { HouseholdProvider } from "@/app/dashboard/HouseholdContext";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const membership = await prisma.householdMember.findFirst({
    where: { userId },
    include: { household: true },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) {
    return <OnboardingForm />;
  }

  return (
    <HouseholdProvider
      value={{
        householdId: membership.household.id,
        householdName: membership.household.name,
        timezone: membership.household.timezone,
        role: membership.role,
      }}
    >
      <DashboardShell householdName={membership.household.name}>{children}</DashboardShell>
    </HouseholdProvider>
  );
}
