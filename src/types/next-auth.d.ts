import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      employeeId?: string;
      role?: string;
      pdpaAccepted?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    employeeId?: string;
    role?: string;
    pdpa?: boolean;
  }
}
