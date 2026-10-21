"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/action-form";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";
import { requireActor, TENANT_COOKIE, getSessionUser, getMemberships } from "@/server/session";
import { addNote, completeTask, createContact, moveOpportunity } from "@/server/services/crm";
import { changeMemberRole, rotateFormToken, setSendingPaused } from "@/server/services/settings";
import { publishWorkflow, retryRun, saveDraft, setWorkflowPaused, skipFailedStep } from "@/server/services/workflows";
import type { Issue } from "@/server/workflow/definition";

async function run(fn: () => Promise<string | void>, paths: string[] = []): Promise<ActionResult> {
  try {
    const message = await fn();
    for (const p of paths) revalidatePath(p, "layout");
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    if (e instanceof AppError) {
      const details = Array.isArray(e.details) ? ` ${(e.details as Issue[]).map((i) => i.message).join("; ")}` : "";
      return { ok: false, message: `${e.message}.${details}`.replace("..", ".") };
    }
    log.error({ err: (e as Error).message }, "server action failed");
    return { ok: false, message: "Something went wrong. The error was logged; please try again." };
  }
}

export async function switchTenantAction(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const tenantId = String(fd.get("tenantId") ?? "");
  const ms = await getMemberships(user.id);
  if (ms.some((m) => m.tenantId === tenantId)) {
    (await cookies()).set(TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.APP_ENV === "production", path: "/" });
  }
  redirect("/today");
}

export async function completeTaskAction(taskId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const r = await completeTask(await requireActor(), taskId);
    return r.changed ? "Task completed" : `Task already ${r.status}`;
  }, ["/"]);
}

export async function moveOpportunityAction(opportunityId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const r = await moveOpportunity(await requireActor(), opportunityId, String(fd.get("stageId") ?? ""));
    return r.changed ? "Stage updated" : "Already in that stage";
  }, ["/"]);
}

export async function createContactAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => {
    const c = await createContact(await requireActor(), {
      firstName: fd.get("firstName"),
      lastName: fd.get("lastName") ?? "",
      email: fd.get("email") ?? "",
      phone: fd.get("phone") ?? "",
    });
    id = c.id;
  });
  if (r?.ok) redirect(`/contacts/${id}`);
  return r;
}

export async function addNoteAction(conversationId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await addNote(await requireActor(), conversationId, { body: String(fd.get("body") ?? ""), markAnswered: fd.get("markAnswered") === "on" });
    return "Note added";
  }, ["/"]);
}

export async function saveDraftAction(workflowId: string, definitionJson: string): Promise<{ ok: boolean; message: string; issues: Issue[] }> {
  try {
    const { issues } = await saveDraft(await requireActor(), workflowId, JSON.parse(definitionJson));
    revalidatePath(`/automations/${workflowId}`);
    return { ok: true, message: issues.length ? "Draft saved with issues to fix before publishing" : "Draft saved", issues };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, issues: Array.isArray(e.details) ? (e.details as Issue[]) : [] };
    log.error({ err: (e as Error).message }, "save draft failed");
    return { ok: false, message: "Could not save the draft", issues: [] };
  }
}

export async function publishWorkflowAction(workflowId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const v = await publishWorkflow(await requireActor(), workflowId, String(fd.get("changeSummary") ?? ""));
    return `Published v${v.version}. Runs already in progress stay on their original version.`;
  }, ["/automations"]);
}

export async function setWorkflowPausedAction(workflowId: string, paused: boolean, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await setWorkflowPaused(await requireActor(), workflowId, paused);
    return paused ? "Automation paused" : "Automation resumed";
  }, ["/"]);
}

export async function retryRunAction(runId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await retryRun(await requireActor(), runId, { acknowledgeDuplicateRisk: fd.get("ack") === "on" });
    return "Retry requested; the worker will pick it up shortly";
  }, ["/"]);
}

export async function skipStepAction(runId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await skipFailedStep(await requireActor(), runId, String(fd.get("reason") ?? ""));
    return "Step skipped; the run will continue";
  }, ["/"]);
}

export async function changeRoleAction(userId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await changeMemberRole(await requireActor(), userId, String(fd.get("role") ?? ""));
    return "Role updated";
  }, ["/settings"]);
}

export async function rotateFormTokenAction(formId: string, _p: ActionResult, _fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { token } = await rotateFormToken(await requireActor(), formId);
    return `New public link (shown once): ${process.env.APP_BASE_URL ?? ""}/f/${token}`;
  }, ["/settings"]);
}

export async function setSendingPausedAction(paused: boolean, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await setSendingPaused(await requireActor(), paused, String(fd.get("reason") ?? ""));
    return paused ? "Outbound sending paused" : "Outbound sending resumed";
  }, ["/"]);
}
