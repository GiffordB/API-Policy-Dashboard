import { loadCoverage } from "@/lib/coverage";
import Coverage from "@/components/Coverage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coverage — Policy Radar" };

export default async function Page() {
  return <Coverage data={await loadCoverage()} />;
}
