import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { listPortfolios, portfolioHoldings } from "@/db/queries/portfolio";
import { currentUserId } from "@/lib/auth";
import { analysePortfolio } from "@/lib/portfolio/analysis";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const userId = await currentUserId();
  if (!userId) {
    return (
      <>
        <PageHeader title="Portfolio" />
        <Card>
          <EmptyState reason="no_data" detail="No operator user exists yet. Run `npm run db:seed:reference`." />
        </Card>
      </>
    );
  }

  const portfolios = await listPortfolios(userId);
  if (!portfolios.length) {
    return (
      <>
        <PageHeader title="Portfolio" />
        <Card>
          <EmptyState
            reason="no_data"
            detail="No portfolio yet. Create one and add holdings, or import a CSV of transactions."
          />
        </Card>
      </>
    );
  }

  const portfolio = portfolios[0]!;
  const holdings = await portfolioHoldings(portfolio.id);
  const analysis = analysePortfolio(holdings);

  return (
    <>
      <PageHeader
        title="Portfolio"
        description={`${portfolio.name} · valuations carry an explicit price timestamp`}
      />
      <PortfolioView holdings={holdings} analysis={analysis} />
    </>
  );
}
