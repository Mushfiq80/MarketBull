import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { SampleBanner } from "@/components/shell/sample-banner";
import { loadSourceStatuses } from "@/db/queries/common";
import { sampleDataPresent } from "@/db/queries/quality";
import { sourceStatusFrom } from "@/lib/api/envelope";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // The shell degrades rather than crashing when the database is unreachable —
  // a dev without Postgres running should still see a useful screen.
  let sourceStatus = {};
  let hasSample = false;
  try {
    const [rows, sample] = await Promise.all([loadSourceStatuses(), sampleDataPresent()]);
    sourceStatus = sourceStatusFrom(rows);
    hasSample = sample;
  } catch {
    sourceStatus = {};
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar sourceStatus={sourceStatus} />
        {hasSample ? <SampleBanner /> : null}
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
