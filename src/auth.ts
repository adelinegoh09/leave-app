import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Nodemailer from "next-auth/providers/nodemailer";
import type { Provider } from "next-auth/providers";
import { authConfig } from "./auth.config";
import { prisma } from "./lib/db";
import { sendMail } from "./lib/notify";

const providers: Provider[] = [
  Credentials({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = String(credentials?.email || "").toLowerCase().trim();
      const password = String(credentials?.password || "");
      if (!email || !password) return null;
      const employee = await prisma.employee.findUnique({ where: { email } });
      if (!employee?.passwordHash || !employee.active) return null;
      const ok = await bcrypt.compare(password, employee.passwordHash);
      if (!ok) return null;
      return { id: employee.id, email: employee.email, name: employee.name };
    },
  }),
];

if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET && process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  );
}

const mailConfigured = Boolean(process.env.SMTP_HOST || process.env.EMAIL_SERVER);
if (mailConfigured || process.env.EMAIL_PROVIDER === "log" || process.env.EMAIL_PROVIDER === "graph") {
  providers.push(
    Nodemailer({
      server: process.env.EMAIL_SERVER || {
        host: process.env.SMTP_HOST || "localhost",
        port: Number(process.env.SMTP_PORT || 587),
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      },
      from: process.env.EMAIL_FROM || "GMT Leave <leave@gmt.example>",
      async sendVerificationRequest({ identifier, url }) {
        await sendMail({
          to: identifier,
          subject: "Your Global Marine Transportation sign-in link",
          text: `Use this link to sign in to the leave app. It expires shortly.\n\n${url}\n\nIf you did not ask for this, you can ignore the email.`,
        });
      },
    }),
  );
}

export const providerFlags = {
  entra: Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET && process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER),
  magicLink: Boolean(process.env.SMTP_HOST || process.env.EMAIL_SERVER || process.env.EMAIL_PROVIDER === "log" || process.env.EMAIL_PROVIDER === "graph" || process.env.EMAIL_PROVIDER === "smtp"),
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (account?.provider === "credentials") return true;
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const employee = await prisma.employee.findUnique({ where: { email } });
      return Boolean(employee?.active);
    },
    async jwt({ token, user }) {
      const email = (user?.email || token.email || "").toLowerCase();
      if (email) {
        const employee = await prisma.employee.findUnique({ where: { email } });
        if (employee) {
          token.employeeId = employee.id;
          token.role = employee.role;
          token.pdpa = Boolean(employee.pdpaAcceptedAt);
          token.email = employee.email;
          token.name = employee.name;
        }
      }
      return token;
    },
  },
});
