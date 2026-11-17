"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { addDays, fmtD } from "@/lib/leave/dates";
import { amendApplication, cancelApplication, decideApplication, empOf, submitApplication } from "@/lib/leave/engine";
import { typeInfo } from "@/lib/leave/types";
import { prisma } from "@/lib/db";
import { saveBytes } from "@/lib/storage";
import { mailDecided, mailPeople, mailSubmitted, approverRecipients } from "./mailer";
import { currentEmployee, draftFromForm, loadState, persistRequest, rememberChild, saveSeq, toActor } from "./store";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

async function readUpload(formData: FormData): Promise<{ error?: string; file?: { name: string; bytes: Buffer; mime: string } }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return {};
  if (file.size > 5 * 1024 * 1024) return { error: "The file must be 5 MB or smaller." };
  if (!ALLOWED.has(file.type)) return { error: "Attach a JPG, PNG, WEBP or PDF." };
  return { file: { name: file.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120), bytes: Buffer.from(await file.arrayBuffer()), mime: file.type } };
}

async function storeDocument(requestId: string, employeeId: string, end: string, type: string, file: { name: string; bytes: Buffer; mime: string }): Promise<void> {
  const key = `leave/${requestId}/${randomUUID()}`;
  await saveBytes(key, file.bytes, file.mime);
  await prisma.document.create({
    data: {
      requestId,
      fileName: file.name,
      mimeType: file.mime,
      sizeBytes: file.bytes.length,
      storageKey: key,
      kind: type === "SL" || type === "HL" ? "MC" : "OTHER",
      uploadedById: employeeId,
      retentionUntil: new Date(addDays(end, 730) + "T00:00:00.000Z"),
    },
  });
}

export async function submitLeave(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  const upload = await readUpload(formData);
  if (upload.error) return { error: upload.error };
  const onBehalf = String(formData.get("employeeId") || me.id);
  if (onBehalf !== me.id && me.role !== "HR_ADMIN") return { error: "Only HR can apply on behalf of someone else." };
  const state = await loadState();
  const draft = draftFromForm(onBehalf, formData, Boolean(upload.file) || state.requests.some((r) => r.id === String(formData.get("existingFile"))));
  if (upload.file) draft.fileName = upload.file.name;
  const result = submitApplication(state, draft, toActor(me), new Date().toISOString());
  if (!result.ok) return { error: result.errors.join(" ") };
  await persistRequest(result.request);
  await saveSeq(result.state.seq);
  await rememberChild(onBehalf, draft);
  if (upload.file) await storeDocument(result.request.id, me.id, result.request.end, result.request.type, upload.file);
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: "Submitted leave",
    entityType: "LeaveRequest",
    entityId: result.request.id,
    after: { type: result.request.type, start: result.request.start, end: result.request.end, days: result.request.days, employeeId: result.request.employeeId },
  });
  await mailSubmitted(result.state, result.request);
  const who = empOf(result.state, result.request.employeeId);
  revalidatePath("/");
  redirect(`/?notice=${encodeURIComponent(`Sent ${fmtD(result.request.days)} day(s) of ${typeInfo(result.request.type).label.toLowerCase()} to ${who?.approverId ? empOf(result.state, who.approverId)?.name || "the approver" : "HR admin"} for approval.`)}`);
}

export async function decideLeave(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  const id = String(formData.get("id") || "");
  const approve = String(formData.get("decision") || "") === "approve";
  const note = String(formData.get("note") || "");
  const state = await loadState();
  const result = decideApplication(state, id, approve, toActor(me), note, new Date().toISOString());
  if (!result.ok) return { error: result.errors.join(" ") };
  await persistRequest(result.request);
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: result.request.trail[result.request.trail.length - 1]?.action || "Decided",
    entityType: "LeaveRequest",
    entityId: id,
    after: { status: result.request.status, pendingAction: result.request.pendingAction, note },
  });
  const finalApproval = approve && result.request.status === "Approved";
  const rejected = result.request.status === "Rejected";
  const cancelDone = result.request.status === "Cancelled";
  if (finalApproval || rejected || cancelDone || result.request.steps.some((step) => step.status === "Pending")) {
    await mailDecided(state, result.request, approve && !rejected);
  }
  revalidatePath("/approvals");
  const employee = empOf(state, result.request.employeeId);
  const word = result.request.status === "Cancelled" ? "Approved the cancellation of" : approve ? "Approved" : "Rejected";
  redirect(`/approvals?notice=${encodeURIComponent(`${word} ${employee?.name || "the employee"}'s request.`)}`);
}

export async function cancelLeave(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  const id = String(formData.get("id") || "");
  const state = await loadState();
  const result = cancelApplication(state, id, toActor(me), new Date().toISOString());
  if (!result.ok) return { error: result.errors.join(" ") };
  await persistRequest(result.request);
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: result.request.status === "Cancelled" ? "Cancelled leave" : "Requested cancellation",
    entityType: "LeaveRequest",
    entityId: id,
    after: { status: result.request.status, pendingAction: result.request.pendingAction },
  });
  if (result.request.pendingAction === "CANCEL") {
    const approverId = result.request.steps[0]?.approverId ?? null;
    const employee = empOf(state, result.request.employeeId);
    await mailPeople(
      approverRecipients(state, approverId),
      `${employee?.name || "An employee"} asked to cancel leave`,
      `${employee?.name || "An employee"} asked to cancel approved leave (${result.request.start}). Confirm it in the approval queue.\n`,
    );
  }
  revalidatePath("/");
  redirect(`/?notice=${encodeURIComponent(result.request.status === "Cancelled" ? "The request was cancelled." : "Your approver has been asked to confirm the cancellation.")}`);
}

export async function amendLeave(formData: FormData): Promise<{ error?: string }> {
  const me = await currentEmployee();
  const id = String(formData.get("id") || "");
  const state = await loadState();
  const existing = state.requests.find((request) => request.id === id);
  if (!existing) return { error: "Request was not found." };
  const upload = await readUpload(formData);
  if (upload.error) return { error: upload.error };
  const draft = draftFromForm(existing.employeeId, formData, Boolean(upload.file) || Boolean(existing.fileName));
  if (upload.file) draft.fileName = upload.file.name;
  else draft.fileName = existing.fileName;
  const result = amendApplication(state, id, draft, toActor(me), new Date().toISOString());
  if (!result.ok) return { error: result.errors.join(" ") };
  await persistRequest(result.request);
  if (upload.file) await storeDocument(result.request.id, me.id, result.request.end, result.request.type, upload.file);
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: "Amended leave",
    entityType: "LeaveRequest",
    entityId: id,
    after: { start: result.request.start, end: result.request.end, days: result.request.days, type: result.request.type },
  });
  revalidatePath("/");
  redirect(`/?notice=${encodeURIComponent("The pending request was updated and sent again.")}`);
}
