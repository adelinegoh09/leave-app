import { unlink } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isoDate, singaporeToday } from "@/lib/leave/dates";
import { isOverdue, empOf } from "@/lib/leave/engine";
import { prisma } from "@/lib/db";
import { readBytes } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { approverRecipients, mailPeople } from "@/server/mailer";
import { loadState } from "@/server/store";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const today = singaporeToday();
  const expired = await prisma.document.findMany({ where: { retentionUntil: { lt: new Date(today + "T00:00:00.000Z") } } });
  let removed = 0;
  for (const document of expired) {
    if (!process.env.S3_BUCKET) {
      const root = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads");
      await unlink(path.join(root, document.storageKey)).catch(() => undefined);
    } else {
      try {
        await readBytes(document.storageKey);
      } catch {
        // The object may already be gone. The database row is still removed.
      }
    }
    await prisma.document.delete({ where: { id: document.id } });
    removed += 1;
  }
  if (removed) {
    await writeAudit({ actorName: "Daily job", action: "Deleted expired documents", entityType: "Document", entityId: "retention", after: { removed, on: today } });
  }
  const state = await loadState();
  let reminders = 0;
  for (const request of state.requests) {
    if (!isOverdue(state, request)) continue;
    const employee = empOf(state, request.employeeId);
    const step = request.steps.find((item) => item.status === "Pending");
    await mailPeople(
      approverRecipients(state, step?.approverId ?? null),
      `Leave approval is overdue: ${employee?.name || "an employee"}`,
      `${employee?.name || "An employee"} is still waiting for a decision on ${request.type} from ${request.start}. The policy escalation time has passed.`,
    );
    reminders += 1;
  }
  const carrySoon = state.policies.filter((policy) => policy.status === "ACTIVE" && policy.rules.carryForward.expiry >= today && policy.rules.carryForward.expiry <= isoDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)));
  return NextResponse.json({ removed, reminders, carryPoliciesNearingExpiry: carrySoon.length });
}
