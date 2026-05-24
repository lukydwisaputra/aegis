import { Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { initTheme } from "@/lib/theme";

import RunsPage from "@/routes/index";
import RunDetailPage from "@/routes/runs.$runId";
import DefectsPage from "@/routes/defects";
import CasesPage from "@/routes/cases";
import CoveragePage from "@/routes/coverage";
import GatesPage from "@/routes/gates";
import CompliancePage from "@/routes/compliance";
import PromotionsPage from "@/routes/promotions";
import KnowledgePage from "@/routes/knowledge";
import AgentsPage from "@/routes/agents";
import SettingsPage from "@/routes/settings";

export default function App() {
  useEffect(() => initTheme(), []);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<RunsPage />} />
        <Route path="runs/:runId" element={<RunDetailPage />} />
        <Route path="defects" element={<DefectsPage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="coverage" element={<CoveragePage />} />
        <Route path="gates" element={<GatesPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="promotions" element={<PromotionsPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
