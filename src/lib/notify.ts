import { prisma } from "./db";

export async function sendMail(input: { to: string; subject: string; text: string; employeeId?: string | null }): Promise<void> {
  const provider = (process.env.EMAIL_PROVIDER || "log").toLowerCase();
  let channel = "log";
  let status = "logged";
  let error: string | null = null;
  try {
    if (provider === "smtp" && process.env.SMTP_HOST) {
      channel = "smtp";
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      });
      await transport.sendMail({
        from: process.env.EMAIL_FROM || "GMT Leave <leave@gmt.example>",
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      status = "sent";
    } else if (provider === "graph" && process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_SENDER) {
      channel = "graph";
      await sendGraph(input.to, input.subject, input.text);
      status = "sent";
    } else {
      console.log(`[leave-mail] To: ${input.to}\nSubject: ${input.subject}\n${input.text}\n`);
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : "Email failed";
    console.error("Email notification failed:", error);
  }
  try {
    await prisma.notification.create({
      data: {
        employeeId: input.employeeId || null,
        toEmail: input.to,
        subject: input.subject,
        body: input.text,
        channel,
        status,
        error,
      },
    });
  } catch (err) {
    console.error("Could not store notification:", err);
  }
}

async function sendGraph(to: string, subject: string, text: string): Promise<void> {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID || "",
      client_secret: process.env.GRAPH_CLIENT_SECRET || "",
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Microsoft Graph token request failed (${tokenRes.status})`);
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Microsoft Graph token was missing");
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.GRAPH_SENDER || "")}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: text },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) throw new Error(`Microsoft Graph send failed (${res.status})`);
}
