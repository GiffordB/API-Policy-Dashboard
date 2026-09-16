import Dashboard from "@/components/Dashboard";
import type { DashboardData } from "@/lib/dto";

/** A fixture page for checking the dashboard's own behaviour without a database. */
const mk = (n: number) => ({
  id: `i${n}`, docket: `EPA-HQ-OAR-2026-${1000 + n}`,
  title: n % 3 === 0 ? `Class VI injection well requirements ${n}` : `Methane emissions rule ${n}`,
  agency: n % 2 ? "EPA" : "PHMSA", unit: "Office of Air",
  track: "FEDERAL", stage: "Comment open", stageIndex: 2,
  nextLabel: "Comments due soon", days: n, isCommentPeriod: true,
  divisionId: n % 2 ? "up" : "mid", ownerId: "p1", ownerName: "Lena Warren",
  priority: "MEDIUM", priorityConfirmed: true,
  position: "Position pending", topics: [n % 3 === 0 ? "Water" : "Emissions"],
  standards: [], draftState: null,
  sourceUrl: null, frCitation: null, abstract: null, lastFinding: null,
});

const data = {
  divisions: [
    { id: "up", name: "Upstream", colorVar: "var(--s1)" },
    { id: "mid", name: "Midstream", colorVar: "var(--s2)" },
  ],
  people: [{ id: "p1", name: "Lena Warren", divisionId: "up" }],
  items: Array.from({ length: 20 }, (_, i) => mk(i + 1)),
  audits: [], runs: [], monthly: {},
} as unknown as DashboardData;

export default function Probe() { return <Dashboard data={data} />; }
