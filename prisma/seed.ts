/**
 * Optional local dev seed: creates a household with a couple of family
 * members and a starter layout so /dashboard/widgets and /display have
 * something to show before Google Calendar is connected.
 *
 * Run with: npm run prisma:seed
 * Requires a User row to already exist (sign in once via Google first),
 * then pass its id: SEED_USER_ID=<id> npm run prisma:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userId = process.env.SEED_USER_ID;
  if (!userId) {
    console.log("Set SEED_USER_ID to an existing User.id (sign in once first) before seeding.");
    return;
  }

  const household = await prisma.household.create({
    data: { name: "The Sample Family", timezone: "America/New_York" },
  });

  await prisma.householdMember.create({ data: { householdId: household.id, userId, role: "OWNER" } });

  const [ada, sam] = await Promise.all([
    prisma.familyMember.create({ data: { householdId: household.id, name: "Ada", color: "#6366F1", initials: "AD" } }),
    prisma.familyMember.create({ data: { householdId: household.id, name: "Sam", color: "#EC4899", initials: "SA", isChild: true } }),
  ]);

  const layout = await prisma.layout.create({
    data: { householdId: household.id, name: "Family Dashboard", isPreset: true, columns: 12, rows: 8 },
  });

  await prisma.widget.createMany({
    data: [
      { householdId: household.id, layoutId: layout.id, type: "CLOCK", x: 0, y: 0, w: 4, h: 2 },
      { householdId: household.id, layoutId: layout.id, type: "WEATHER", x: 4, y: 0, w: 4, h: 2 },
      { householdId: household.id, layoutId: layout.id, type: "CALENDAR_WEEK", x: 0, y: 2, w: 8, h: 4 },
      { householdId: household.id, layoutId: layout.id, type: "CHORES", x: 8, y: 0, w: 4, h: 4 },
      { householdId: household.id, layoutId: layout.id, type: "NOTES", x: 8, y: 4, w: 4, h: 2 },
      { householdId: household.id, layoutId: layout.id, type: "MEAL_PLAN", x: 0, y: 6, w: 8, h: 2 },
    ],
  });

  await prisma.chore.createMany({
    data: [
      { householdId: household.id, familyMemberId: sam.id, title: "Feed the dog", points: 5, recurrence: "DAILY" },
      { householdId: household.id, familyMemberId: ada.id, title: "Take out recycling", points: 10, recurrence: "WEEKLY" },
    ],
  });

  await prisma.note.create({
    data: { householdId: household.id, body: "Picture day is Friday — wear the blue shirt!", color: "#FDE68A", pinned: true },
  });

  console.log(`Seeded household ${household.id} for user ${userId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
