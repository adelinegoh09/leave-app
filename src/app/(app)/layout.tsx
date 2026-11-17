import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { currentEmployee } from "@/server/store";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const employee = await currentEmployee();
  if (!employee.pdpaAcceptedAt) redirect("/pdpa");
  return <Shell employee={employee}>{children}</Shell>;
}
