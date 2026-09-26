import { PageHeader } from "@/components/shell/page-header";
import { WhyMovingForm } from "@/components/research/why-moving-form";

export const metadata = { title: "Why moving?" };

export default async function WhyMovingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageHeader
        title="Why is this stock moving?"
        description="Decomposes a move against the market and its sector, then ranks candidate explanations by timing, source quality and corroboration."
      />
      <WhyMovingForm initialIssuerId={params.issuerId} />
    </>
  );
}
