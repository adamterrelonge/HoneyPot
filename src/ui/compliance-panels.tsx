/**
 * Cyber Essentials gap report (Phase 14): the five controls, each gap with a one-click fix where the
 * game has one, and a Markdown export. The assessment itself is `engine/compliance/cyber-essentials.ts`.
 */
import { useMemo } from "react";
import {
  CE_SOURCE, assessCyberEssentials, ceInputFrom, cyberEssentialsMarkdown, type CeAction, type CeFinding,
} from "../engine/compliance/cyber-essentials";
import { sim, useSim } from "../state/sim";
import { useApp } from "../state/store";
import { H, Modal, card } from "./game-panels";

const quiet = "h-7 shrink-0 rounded-[8px] bg-fill/[0.05] px-2.5 text-[12px] font-medium text-ink-2 hover:bg-fill/[0.08] hover:text-ink";
const fixBtn = "h-7 shrink-0 rounded-[8px] bg-accent px-2.5 text-[12px] font-semibold text-white hover:bg-accent-hover";

/** Controls passed, for the top-bar badge (null before the first snapshot). */
export function useCePassed(): number | null {
  const topology = useApp((s) => s.topology);
  const snap = useSim((s) => s.snap);
  return useMemo(() => (snap ? assessCyberEssentials(ceInputFrom(snap, topology)).passed : null), [snap, topology]);
}

export function ComplianceButton() {
  const setOpen = useApp((s) => s.setComplianceOpen);
  const passed = useCePassed();
  return (
    <button onClick={() => setOpen(true)} className={`flex items-center gap-1.5 ${quiet}`}>
      Cyber Essentials
      {passed !== null && (
        <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${passed === 5 ? "bg-ok/15 text-ok-ink" : "bg-warn/15 text-warn-ink"}`}>
          {passed}/5<span className="sr-only"> controls pass</span>
        </span>
      )}
    </button>
  );
}

function actionLabel(a: CeAction): string {
  switch (a.kind) {
    case "password": return "Change password";
    case "access": return "Disable access";
    case "firmware": return "Update tonight";
    case "mfa": return "Turn on MFA";
    case "rule": return "Open policy";
    case "control": return "Deploy EDR";
  }
}

export function ComplianceSheet() {
  const open = useApp((s) => s.complianceOpen);
  const setOpen = useApp((s) => s.setComplianceOpen);
  const setPolicyOpen = useApp((s) => s.setPolicyOpen);
  const select = useApp((s) => s.select);
  const topology = useApp((s) => s.topology);
  const snap = useSim((s) => (open ? s.snap : null));
  const report = useMemo(() => (snap ? assessCyberEssentials(ceInputFrom(snap, topology)) : null), [snap, topology]);
  if (!open || !report || !snap) return null;

  const close = () => setOpen(false);
  const run = (a: CeAction) => {
    switch (a.kind) {
      case "password": return void sim.dispatch({ type: "node.setPassword", nodeId: a.nodeId, changed: true });
      case "access": return void sim.dispatch({ type: "node.setAccess", nodeId: a.nodeId, blocked: true });
      case "firmware": {
        const latest = snap.devices[a.nodeId]?.latest;
        if (latest) void sim.dispatch({ type: "firmware.install", nodeId: a.nodeId, version: latest, when: "tonight" });
        return;
      }
      case "mfa": return void sim.dispatch({ type: "identity.setMfa", role: a.role, enabled: true });
      case "rule": close(); return setPolicyOpen("rules");
      case "control": return void sim.dispatch({ type: "control.set", control: a.control, owned: true });
    }
  };
  const scheduled = (f: CeFinding) => f.action?.kind === "firmware" && snap.devices[f.action.nodeId]?.scheduled !== undefined;
  const show = (id: string) => {
    close();
    select(id, { focus: true });
  };
  const exportMd = () => {
    const md = cyberEssentialsMarkdown(report, topology.meta.name);
    const slug = topology.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-cyber-essentials-gaps.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sim.notify(`Gap report exported: ${a.download}`);
  };

  return (
    <Modal title="Cyber Essentials gap report" icon="/emoji/shield.png" onClose={close}>
      <div className={`${card} flex flex-wrap items-center gap-3`}>
        <div className="flex-1 text-[13px] leading-relaxed text-ink-2">
          <p>
            <strong className="text-ink">{report.passed} of 5 controls pass.</strong>{" "}
            {report.ready
              ? "Nothing the simulation can check stands in the way of certification."
              : "Cyber Essentials is the UK government's baseline: every control must pass before you can certify."}
          </p>
          <p className="mt-1 text-[12px] text-ink-3">
            Checked against the NCSC's Requirements for IT Infrastructure {report.version}.{" "}
            <a href={CE_SOURCE} target="_blank" rel="noreferrer" className="text-accent-ink underline">
              Source
            </a>
          </p>
        </div>
        <button onClick={exportMd} className={quiet}>
          Export (.md)
        </button>
      </div>

      {report.controls.map((c) => (
        <section key={c.id} aria-labelledby={`ce-${c.id}`}>
          <H>
            <span id={`ce-${c.id}`} className="flex items-center gap-2">
              <span className={`rounded-full px-1.5 py-px text-[10px] ${c.pass ? "bg-ok/15 text-ok-ink" : "bg-bad/12 text-bad-ink"}`}>
                {c.pass ? "Pass" : `${c.findings.length} gap${c.findings.length === 1 ? "" : "s"}`}
              </span>
              {c.name}
            </span>
          </H>
          <div className={card}>
            <p className="text-[12px] italic text-ink-3">“{c.requirement}”</p>
            {c.findings.length > 0 && (
              <ul className="mt-2 divide-y divide-hairline">
                {c.findings.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                    <div className="min-w-[240px] flex-1">
                      <p className="text-ink">{f.text}</p>
                      <p className="text-[12px] text-ink-3">{f.fix}</p>
                    </div>
                    {f.nodeIds?.length === 1 && (
                      <button onClick={() => show(f.nodeIds![0]!)} className={quiet}>
                        Show
                      </button>
                    )}
                    {f.action &&
                      (scheduled(f) ? (
                        <span className="text-[12px] text-ink-3">Update scheduled for tonight</span>
                      ) : (
                        <button onClick={() => run(f.action!)} className={fixBtn}>
                          {actionLabel(f.action)}
                        </button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
            {c.notes.map((n, i) => (
              <p key={i} className="mt-2 text-[12px] text-ink-2">
                Note: {n}
              </p>
            ))}
            {c.pass && !c.notes.length && <p className="mt-2 text-[13px] text-ok-ink">No gaps found.</p>}
          </div>
        </section>
      ))}

      <H>Not assessed by the simulation</H>
      <div className={`${card} text-[12px] text-ink-2`}>
        <ul className="list-disc pl-4">
          {report.notAssessed.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="mt-2">{report.backups}</p>
      </div>
    </Modal>
  );
}
