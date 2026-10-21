/**
 * A15 — Browser journey: public form → contact → opportunity → assigned task → local
 * acknowledgment → timeline; an authorized staff member completes the task.
 * Also exercises A6/A1 at the HTTP layer (direct API calls with a real session cookie).
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Demo-Password-2026!";
const FORM = "/f/demo-brightline-lead-form-local-token";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("lead form submission becomes assigned staff work with an auditable timeline", async ({ page }) => {
  const last = `Journey${Date.now().toString().slice(-6)}`;
  // 1. Public lead form (unauthenticated), with UTM source captured.
  await page.goto(`${FORM}?utm_source=e2e-test`);
  await page.getByLabel("First name").fill("Pat");
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Mobile phone").fill("(404) 555-0142");
  await page.getByLabel("How can we help?").fill("Synthetic inquiry about lower back pain");
  await page.getByRole("checkbox", { name: /may text me about this inquiry/ }).check();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: /we received your request/ })).toBeVisible();

  // 2. Front-desk staff sign in and see the assigned task on Today.
  await login(page, "frontdesk@brightline.test");
  const taskRow = page.getByRole("row").filter({ hasText: `Call Pat about their web inquiry` }).filter({ hasText: `Pat ${last}` });
  await expect(async () => {
    await page.reload();
    await expect(taskRow).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(taskRow).toContainText("Jordan Frontdesk");
  await expect(taskRow).toContainText(/Due in/);

  // 3. Contact record: opportunity + full timeline including the simulated acknowledgment.
  await taskRow.getByRole("link", { name: `Pat ${last}` }).click();
  await expect(page.getByRole("heading", { name: `Pat ${last}` })).toBeVisible();
  const timeline = page.getByTestId("timeline");
  await expect(async () => {
    await page.reload();
    await expect(timeline.locator('[data-action="message.provider_accepted"]')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  for (const action of ["form.submitted", "contact.created", "consent.granted", "workflow_run.started", "opportunity.created", "task.created", "message.queued", "message.provider_accepted"]) {
    await expect(timeline.locator(`[data-action="${action}"]`).first()).toBeVisible();
  }
  await expect(timeline.locator('[data-action="message.provider_accepted"]')).toContainText("LOCAL SIMULATOR");
  await expect(timeline.getByText("Local simulation").first()).toBeVisible();
  await expect(page.getByText(`Pat ${last} — web inquiry`, { exact: true })).toBeVisible();
  await expect(page.getByText("SMS · transactional")).toBeVisible();

  // 4. The staff member completes the task; the timeline records it.
  const task = page.getByTestId("contact-task").filter({ hasText: "Call Pat about their web inquiry" });
  await task.getByRole("button", { name: "Complete" }).click();
  await expect(task.getByText("completed")).toBeVisible();
  await page.reload();
  await expect(timeline.locator('[data-action="task.completed"]')).toBeVisible();

  // 5. The run is inspectable with its pinned version.
  await page.goto("/automations");
  await expect(page.getByTestId("run-row").filter({ hasText: `Pat ${last}` })).toBeVisible();
});

test("direct API calls enforce permissions and tenant isolation (A6/A1 over HTTP)", async ({ page, browser }) => {
  // Restricted staff: publish and export are refused even when called directly.
  await login(page, "restricted@brightline.test");
  const contacts = await page.request.get("/api/v1/contacts");
  expect(contacts.status()).toBe(200);
  const body = await contacts.json();
  expect(body.rows[0].masked).toBe(true);
  const exportRes = await page.request.get("/api/v1/exports/contacts.csv");
  expect(exportRes.status()).toBe(403);
  const publishRes = await page.request.post("/api/v1/workflows/00000000-0000-4000-8000-000000000000/publish", {
    data: { changeSummary: "restricted attempt" },
    headers: { origin: "http://localhost:3100" },
  });
  expect(publishRes.status()).toBe(403);

  // Manager in tenant A can export; owner of tenant B cannot read tenant A's contact by id.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  const contactA: string = body.rows[0].id;
  await login(pageB, "owner@harbor.test");
  const cross = await pageB.request.get(`/api/v1/contacts/${contactA}`);
  expect(cross.status()).toBe(404);
  const listB = await (await pageB.request.get("/api/v1/contacts")).json();
  expect(listB.rows.map((r: { id: string }) => r.id)).not.toContain(contactA);
  await ctxB.close();

  // Cross-site POST with a valid session cookie is rejected.
  const csrf = await page.request.post(`/api/v1/tasks/00000000-0000-4000-8000-000000000000/complete`, { headers: { origin: "https://evil.example" } });
  expect(csrf.status()).toBe(403);

  // Unauthenticated API access is refused.
  const anon = await (await browser.newContext()).request.get("http://localhost:3100/api/v1/contacts");
  expect(anon.status()).toBe(401);
});

test("manager can export CSV and sees the failed-automation review queue control", async ({ page }) => {
  await login(page, "manager@brightline.test");
  const res = await page.request.get("/api/v1/exports/contacts.csv");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv.split("\r\n")[0]).toBe("id,first_name,last_name,email,phone_e164,source,owner_user_id,created_at,updated_at");
  expect(csv).not.toContain("Tesla"); // a tenant-B synthetic contact
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Failed automations — review queue" })).toBeVisible();
});
