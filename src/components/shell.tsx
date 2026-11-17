import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { signOutAction } from "@/server/auth-actions";
import { queueFor } from "@/lib/leave/engine";
import { loadState, toActor } from "@/server/store";
import type { Role } from "@prisma/client";

const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: "Employee",
  MANAGER: "Manager",
  HR_ADMIN: "HR admin",
};

export async function Shell({
  children,
  employee,
}: {
  children: React.ReactNode;
  employee: { id: string; name: string; role: Role };
}) {
  const state = await loadState();
  const queue = queueFor(state, toActor(employee)).length;
  const delegated = state.delegations.some((item) => item.toId === employee.id && item.start <= state.today && item.end >= state.today);
  const links = [
    { href: "/", label: "My leave" },
    ...(employee.role !== "EMPLOYEE" || delegated || queue > 0 ? [{ href: "/approvals", label: queue ? `Approvals (${queue})` : "Approvals" }] : []),
    { href: "/calendar", label: "Team calendar" },
    ...(employee.role !== "EMPLOYEE" ? [{ href: "/team", label: "Team balances" }, { href: "/reports", label: "Reports" }] : []),
    ...(employee.role === "HR_ADMIN" ? [{ href: "/hr", label: "HR admin" }] : []),
  ];
  return (
    <>
      <header className="top">
        <Link className="brand" href="/">
          <span className="mark">GMT</span>
          <span>
            <strong>Global Marine Transportation</strong>
            <small>Leave · shore staff and vessel crew</small>
          </span>
        </Link>
        <div className="who">
          <span className="name">{employee.name}</span>
          <span className="pill">{ROLE_LABEL[employee.role]}</span>
          <form action={signOutAction}>
            <button className="linkish" type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <NavLinks links={links} />
      <main id="content" className="page">{children}</main>
      <p className="page footer">Global Marine Transportation Pte Ltd · Singapore. Medical certificates are visible only to you, your approver and HR. <Link href="/pdpa">Privacy notice</Link></p>
    </>
  );
}
