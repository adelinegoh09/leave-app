import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (path.startsWith("/api/auth") || path.startsWith("/api/cron") || path === "/login") return true;
      return Boolean(auth?.user);
    },
    session({ session, token }) {
      if (session.user) {
        session.user.employeeId = typeof token.employeeId === "string" ? token.employeeId : undefined;
        session.user.role = typeof token.role === "string" ? token.role : undefined;
        session.user.pdpaAccepted = Boolean(token.pdpa);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
