import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { writeAudit } from "@/lib/audit";
import { isoDate, singaporeToday } from "@/lib/leave/dates";
import { prisma } from "@/lib/db";
import { readBytes } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return new NextResponse("Sign in required", { status: 401 });
  const me = await prisma.employee.findUnique({ where: { email } });
  if (!me?.active) return new NextResponse("Sign in required", { status: 401 });
  const { id } = await context.params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { request: { include: { employee: true, steps: true } } },
  });
  if (!document) return new NextResponse("Document not found", { status: 404 });
  const today = singaporeToday();
  const delegations = await prisma.delegation.findMany({ where: { toId: me.id } });
  const approverIds = new Set(document.request.steps.map((step) => step.approverId).filter(Boolean));
  if (document.request.employee.approverId) approverIds.add(document.request.employee.approverId);
  const covering = delegations.some((row) => approverIds.has(row.fromId) && isoDate(row.startDate) <= today && isoDate(row.endDate) >= today);
  const allowed = me.role === "HR_ADMIN" || me.id === document.request.employeeId || approverIds.has(me.id) || covering;
  if (!allowed) return new NextResponse("You cannot view this document", { status: 403 });
  if (isoDate(document.retentionUntil) < today) return new NextResponse("This document has passed its retention date.", { status: 410 });
  const bytes = await readBytes(document.storageKey);
  await writeAudit({
    actorId: me.id,
    actorName: me.name,
    action: "Viewed document",
    entityType: "Document",
    entityId: document.id,
    after: { requestId: document.requestId, fileName: document.fileName },
  });
  const safe = document.fileName.replace(/["\r\n]/g, "");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
