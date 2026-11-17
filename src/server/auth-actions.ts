"use server";

import { AuthError } from "next-auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function signInWithPassword(formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof AuthError) return { error: "That email or password was not recognised." };
    throw error;
  }
  return {};
}

export async function sendMagicLink(formData: FormData): Promise<{ error?: string; ok?: string }> {
  const email = String(formData.get("email") || "").toLowerCase().trim();
  if (!email) return { error: "Enter your work email." };
  try {
    await signIn("nodemailer", { email, redirect: false, redirectTo: "/" });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (error instanceof AuthError) return { error: "A sign-in link could not be sent. Check that this email is on the staff list." };
    throw error;
  }
  return { ok: "If that email is on the staff list, a sign-in link is on its way. With email logging, the link is also printed in the server log." };
}

export async function signInWithEntra(): Promise<void> {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function acceptPdpa(): Promise<void> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/login");
  const employee = await prisma.employee.findUnique({ where: { email } });
  if (!employee) redirect("/login");
  await prisma.employee.update({ where: { id: employee.id }, data: { pdpaAcceptedAt: new Date() } });
  await writeAudit({
    actorId: employee.id,
    actorName: employee.name,
    action: "Accepted PDPA notice",
    entityType: "Employee",
    entityId: employee.id,
    after: { pdpaAcceptedAt: new Date().toISOString() },
  });
  redirect("/");
}
