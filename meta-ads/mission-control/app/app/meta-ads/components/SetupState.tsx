"use client";

// Shown when the agent has no Meta credentials yet: what to add, where, and a
// link to the agent's own setup check. Credential values never appear here;
// the agent only reports which names are present.

import { useEffect, useRef, useState } from "react";
import { KeyRound, Stethoscope } from "lucide-react";
import type { Freshness } from "./types";
import { Notice } from "./ui";

const WHAT_EACH_IS: Record<string, string> = {
  META_ADS_ACCESS_TOKEN: "a long-lived System User token from Meta Business Settings (ads_read, ads_management)",
  META_ADS_ACCOUNT_ID: "your ad account id in act_ form, from Ads Manager",
  META_ADS_APP_ID: "the id of your Meta app",
  META_ADS_APP_SECRET: "that app's secret, from the app dashboard",
};

type DoctorReport = {
  status?: string;
  env?: { name: string; present: boolean }[];
  liveChecks?: { name: string; status: string; detail?: string }[];
  integrity?: { ok?: boolean; message?: string };
  policyGuide?: { ok?: boolean; message?: string };
  nextSteps?: string[];
};
type DoctorState = { loading: boolean; report: DoctorReport | null; error: string | null };

export function SetupState({ freshness }: { freshness: Freshness }) {
  const [doctor, setDoctor] = useState<DoctorState>({ loading: false, report: null, error: null });
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  async function runDoctor() {
    if (busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    const deadline = setTimeout(() => controller.abort(), 35000);
    setDoctor({ loading: true, report: null, error: null });
    try {
      const response = await fetch("/api/meta-ads/doctor", { cache: "no-store", signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload?.report || typeof payload.report !== "object" || Array.isArray(payload.report)) throw new Error("The setup check could not finish. Try again, or ask your setup assistant to review the local diagnostic log.");
      if (mounted.current) setDoctor({ loading: false, report: payload.report as DoctorReport, error: null });
    } catch {
      if (mounted.current) setDoctor({ loading: false, report: null, error: "The setup check could not finish. Check that the Meta Ads module is available, then try again." });
    } finally { clearTimeout(deadline); busy.current = false; }
  }
  const report = doctor.report;
  const checks = [
    ...(Array.isArray(report?.env) ? report.env.filter(row => row && typeof row === "object" && !Array.isArray(row) && typeof row.name === "string").slice(0, 30).map(row => ({ name: String(row.name || "Configuration"), status: row.present === true ? "pass" : "fail", detail: row.present === true ? "Configured. Secret values stay private." : "This setting still needs setup." })) : []),
    ...(Array.isArray(report?.liveChecks) ? report.liveChecks.filter(row => row && typeof row === "object" && !Array.isArray(row) && typeof row.name === "string").slice(0, 30) : []),
    ...(report?.integrity ? [{ name: "Module integrity", status: report.integrity.ok === true ? "pass" : "fail", detail: report.integrity.message }] : []),
    ...(report?.policyGuide ? [{ name: "Policy guidance", status: report.policyGuide.ok === true ? "pass" : "fail", detail: report.policyGuide.message }] : []),
  ];
  return (
    <section className="mx-auto max-w-2xl space-y-4 pb-20">
      <div className="rounded-xl border border-dark-border bg-dark-panel p-6">
        <KeyRound className="h-8 w-8 text-cm-purple" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold text-dark-text">Connect your Meta ad account</h2>
        <p className="mt-2 text-sm leading-6 text-dark-muted">
          The dashboard reads your campaigns, spend and results from your own ad account. It needs {freshness.missing.length} more setting{freshness.missing.length === 1 ? "" : "s"} in the agent&apos;s <code className="font-mono text-dark-text">{freshness.envFile}</code> file. Nothing is sent anywhere until they are there, and the agent never prints their values.
        </p>
        <ol className="mt-4 space-y-2 text-sm leading-6 text-dark-text">
          {freshness.missing.map((name) => (
            <li key={name} className="rounded-md bg-dark-panel2/70 px-3 py-2">
              <code className="font-mono font-medium">{name}</code>
              <span className="text-dark-muted">: {WHAT_EACH_IS[name] || "see the setup guide"}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-6 text-dark-muted">
          Add each as <code className="font-mono text-dark-text">NAME=value</code> on its own line, then run <code className="font-mono text-dark-text">node src/index.js doctor</code> in the agent folder and press Refresh here. The full walkthrough is in <code className="font-mono text-dark-text">{freshness.setupDoc}</code>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={runDoctor} disabled={doctor.loading} aria-expanded={Boolean(report)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[color:var(--color-border-strong)] bg-dark-panel2 px-3.5 text-sm font-medium text-dark-text hover:border-cm-purple/70 disabled:opacity-60">
            <Stethoscope size={16} aria-hidden="true" /> {doctor.loading ? "Checking setup..." : "Open the Setup Checkup Doctor"}
          </button>
        </div>
      </div>
      <div aria-live="polite" aria-busy={doctor.loading}>
        {doctor.error && <p role="alert" className="rounded-xl border border-dark-border bg-dark-panel p-4 text-sm text-dark-text">{doctor.error}</p>}
        {report && <section aria-label="Setup Checkup Doctor" className="space-y-4 rounded-xl border border-dark-border bg-dark-panel p-6">
          <h2 className="text-xl font-semibold text-dark-text">Setup Checkup Doctor</h2>
          <p className="text-sm text-dark-muted">Read-only checks of configuration, permissions and account connection.</p>
          <p className="font-medium text-dark-text">{checks.some(row => row.status === "fail") ? "Setup needs attention" : checks.length > 0 && (report.status === "ready_for_live_api" || report.status === "connector_mode") ? "Setup checks are ready" : "Setup checks are incomplete"}</p>
          <ul className="space-y-2">
            {checks.map((row, index) => <li key={`${row.name}-${index}`} className="rounded-lg bg-dark-panel2 p-3 text-sm">
              <p className="font-medium text-dark-text">{String(row.name).replace(/_/g, " ").slice(0, 120)}: {row.status === "pass" ? "Passed" : row.status === "fail" ? "Needs attention" : row.status === "skipped" ? "Skipped" : "Not verified"}</p>
              {typeof row.detail === "string" && <p className="mt-1 text-dark-muted">{row.detail.slice(0, 600)}</p>}
            </li>)}
          </ul>
          {Array.isArray(report.nextSteps) && <div><h3 className="font-semibold text-dark-text">Next steps</h3><ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-dark-muted">{report.nextSteps.filter(step => typeof step === "string").slice(0, 12).map((step, index) => <li key={index}>{step.slice(0, 600)}</li>)}</ol></div>}
        </section>}
      </div>
      <Notice>
        While you set this up, the agent still works offline: it can draft campaigns, preview carousel creatives and show this page. Live writes stay off ({freshness.writesEnabled ? "they are on right now" : "META_ADS_WRITES_ENABLED is not true"}), and every budget write is capped at {freshness.budgetCap.limitCents !== null ? `${(freshness.budgetCap.limitCents / 100).toFixed(2)} ${freshness.account.currency} a day` : "an invalid value, so budget writes are refused"}.
      </Notice>
    </section>
  );
}
