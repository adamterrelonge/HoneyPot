/**
 * Onboarding wizard (build.md §8 Phase 3): collect a BusinessSpec, preview the generated
 * network, then load it into the map and the simulation.
 */
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { generateBusiness, summarise } from "../engine/gen/generate";
import {
  BUDGET_INFO, BusinessSpecSchema, COMPLIANCE_INFO, HOSTING_INFO, INDUSTRY_INFO, SITE_RANGE, SIZE_LABELS, STAFF_RANGE,
  defaultSpec, randomSpec, type BusinessSpec,
} from "../engine/gen/spec";
import { BUDGETS, BUSINESS_SIZES, COMPLIANCE, HOSTING, INDUSTRIES, type BusinessSize, type Industry } from "../engine/model";
import { asset } from "../render/theme";
import { sampleTopology, useApp } from "../state/store";
import { Logo } from "./logo";
import { useDialogFocus } from "./a11y";
import { DontAskAgain, tour } from "./tour";
import { formatRate } from "./sim-panels";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const BRANCH_NOUN: Record<Industry, [string, string]> = {
  professional: ["branch office", "branch offices"],
  retail: ["store", "stores"],
  healthcare: ["clinic", "clinics"],
  manufacturing: ["branch office", "branch offices"],
  education: ["campus", "campuses"],
  logistics: ["depot", "depots"],
};

export function Wizard() {
  const open = useApp((s) => s.wizardOpen);
  const setOpen = useApp((s) => s.setWizardOpen);
  const loadBusiness = useApp((s) => s.loadBusiness);
  const [spec, setSpec] = useState<BusinessSpec>(() => defaultSpec("professional", "sme", 1337));
  const [nameTouched, setNameTouched] = useState(false);
  const [complianceTouched, setComplianceTouched] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Generating is fast, but defer it so dragging the staff slider stays smooth.
  const deferred = useDeferredValue(spec);
  const preview = useMemo(() => {
    const parsed = BusinessSpecSchema.safeParse(deferred);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" } as const;
    return { summary: summarise(generateBusiness(parsed.data)) } as const;
  }, [deferred]);

  if (!open) return null;

  const patch = (p: Partial<BusinessSpec>) => setSpec((s) => ({ ...s, ...p }));
  const setIndustry = (industry: Industry) =>
    patch({
      industry,
      ...(nameTouched ? {} : { name: INDUSTRY_INFO[industry].names[0]! }),
      ...(complianceTouched ? {} : { compliance: [...INDUSTRY_INFO[industry].compliance] }),
    });
  const setSize = (size: BusinessSize) => {
    const [slo, shi] = SITE_RANGE[size];
    patch({ size, employees: defaultSpec(spec.industry, size).employees, sites: clamp(spec.sites, slo, shi) });
  };
  const surprise = () => {
    setSpec(randomSpec(Math.floor(Math.random() * 1e9)));
    setNameTouched(false);
    setComplianceTouched(false);
  };
  const create = () => {
    const parsed = BusinessSpecSchema.safeParse(spec);
    if (parsed.success) {
      loadBusiness(generateBusiness(parsed.data));
      tour.afterBusinessCreated();
    }
  };

  const [staffLo, staffHi] = STAFF_RANGE[spec.size];
  const [siteLo, siteHi] = SITE_RANGE[spec.size];
  const branches = spec.sites - 1;
  const noun = BRANCH_NOUN[spec.industry][branches === 1 ? 0 : 1];

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-surface/35 p-3 backdrop-blur-[6px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      ref={dialogRef}
    >
      {/* Short screens (e.g. 200–400% zoom): the whole card scrolls, so the form isn't squeezed between header and footer. */}
      <div className="glass flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] bg-surface/85 [@media(max-height:600px)]:overflow-y-auto">
        <header className="flex items-start gap-3 px-5 sm:px-7 pt-6 pb-4">
          <Logo className="mt-1.5 h-6 sm:mt-1 sm:h-10" />
          <div className="flex-1">
            <h1 id="wizard-title" className="text-[22px] font-semibold tracking-tight">Create a business</h1>
            <p className="text-[13px] text-ink-2">
              Describe the organisation and Honeypot will build its network, traffic and weak spots.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={() => tour.start()}
                className="h-7 rounded-[8px] bg-accent/10 px-2.5 text-[12px] font-semibold text-accent-ink hover:bg-accent/15"
              >
                Take the tour
              </button>
              <DontAskAgain />
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-fill/[0.05] text-[13px] text-ink-2 hover:bg-fill/[0.09]"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 sm:px-7 pb-5 [@media(max-height:600px)]:flex-none [@media(max-height:600px)]:overflow-visible">
          <Field label="Business name">
            <div className="flex gap-2">
              <input
                value={spec.name}
                onChange={(e) => {
                  setNameTouched(true);
                  patch({ name: e.target.value });
                }}
                maxLength={60}
                aria-label="Business name"
                className="h-9 min-w-0 flex-1 rounded-[10px] bg-fill/[0.045] px-3 text-[14px] outline-none focus:bg-surface focus:ring-[3px] focus:ring-accent/25"
              />
              <button
                onClick={surprise}
                className="h-9 shrink-0 whitespace-nowrap rounded-[10px] bg-fill/[0.05] px-3 text-[13px] font-medium text-ink-2 hover:bg-fill/[0.08]"
              >
                🎲 Surprise me
              </button>
            </div>
          </Field>

          <Field label="Industry">
            <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 sm:grid-cols-3">
              {INDUSTRIES.map((id) => {
                const info = INDUSTRY_INFO[id];
                const on = spec.industry === id;
                return (
                  <button
                    key={id}
                    onClick={() => setIndustry(id)}
                    aria-pressed={on}
                    className={`flex flex-col items-start rounded-[14px] p-3 text-left transition-all ${
                      on
                        ? "bg-surface shadow-[0_0_0_2px_var(--color-accent),0_4px_14px_rgba(0,113,227,0.15)]"
                        : "bg-surface/60 shadow-[inset_0_0_0_0.5px_rgb(var(--shade)/0.1)] hover:bg-surface"
                    }`}
                  >
                    <img
                      src={asset(info.icon)}
                      alt=""
                      className="h-9 w-9"
                      onError={(e) => {
                        if (!e.currentTarget.src.endsWith("/emoji/hq.png")) e.currentTarget.src = asset("/emoji/hq.png");
                      }}
                    />
                    <span className="mt-2 text-[13px] font-semibold leading-tight">{info.label}</span>
                    <span className="mt-1 text-[11px] leading-snug text-ink-3">{info.blurb}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Size">
              <Segmented
                value={spec.size}
                options={BUSINESS_SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s] }))}
                onChange={(s) => setSize(s as BusinessSize)}
              />
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="range"
                  min={staffLo}
                  max={staffHi}
                  value={spec.employees}
                  onChange={(e) => patch({ employees: Number(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                  aria-label="Staff"
                />
                <span className="w-[86px] text-right text-[13px] tabular-nums">
                  <b className="font-semibold">{spec.employees.toLocaleString()}</b> staff
                </span>
              </div>
            </Field>

            <Field label="Sites">
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-[10px] bg-fill/[0.05] p-0.5">
                  <StepButton
                    label="Fewer sites"
                    onClick={() => patch({ sites: clamp(spec.sites - 1, siteLo, siteHi) })}
                    disabled={spec.sites <= siteLo}
                  >
                    −
                  </StepButton>
                  <span className="w-9 text-center text-[15px] font-semibold tabular-nums">{spec.sites}</span>
                  <StepButton
                    label="More sites"
                    onClick={() => patch({ sites: clamp(spec.sites + 1, siteLo, siteHi) })}
                    disabled={spec.sites >= siteHi}
                  >
                    +
                  </StepButton>
                </div>
                <span className="text-[12px] leading-snug text-ink-3">
                  {branches === 0 ? "One location" : `Head office + ${branches} ${noun}`}
                  <br />
                  {SIZE_LABELS[spec.size]}: {siteLo}–{siteHi} sites
                </span>
              </div>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Hosting">
              <Segmented
                value={spec.hosting}
                options={HOSTING.map((h) => ({ value: h, label: HOSTING_INFO[h].label }))}
                onChange={(h) => patch({ hosting: h as BusinessSpec["hosting"] })}
              />
              <Hint>{HOSTING_INFO[spec.hosting].blurb}</Hint>
            </Field>
            <Field label="IT budget">
              <Segmented
                value={spec.budget}
                options={BUDGETS.map((b) => ({ value: b, label: BUDGET_INFO[b].label }))}
                onChange={(b) => patch({ budget: b as BusinessSpec["budget"] })}
              />
              <Hint>{BUDGET_INFO[spec.budget].blurb}</Hint>
            </Field>
          </div>

          <Field label="Compliance">
            <div className="flex flex-wrap gap-2">
              {COMPLIANCE.map((c) => {
                const on = spec.compliance.includes(c);
                return (
                  <button
                    key={c}
                    title={COMPLIANCE_INFO[c].blurb}
                    aria-pressed={on}
                    onClick={() => {
                      setComplianceTouched(true);
                      patch({ compliance: on ? spec.compliance.filter((x) => x !== c) : [...spec.compliance, c] });
                    }}
                    className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${
                      on ? "bg-accent text-white" : "bg-fill/[0.05] text-ink-2 hover:bg-fill/[0.08]"
                    }`}
                  >
                    <span className="text-[10px]">{on ? "✓" : "+"}</span>
                    {COMPLIANCE_INFO[c].label}
                  </button>
                );
              })}
            </div>
            <Hint>
              {spec.compliance.length
                ? spec.compliance.map((c) => COMPLIANCE_INFO[c].blurb).join(" ")
                : "No compliance requirements: expect a flatter network with more shortcuts."}
            </Hint>
          </Field>
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-hairline bg-surface/60 px-5 sm:px-7 py-4">
          <div className="min-w-[220px] flex-1 text-[12px] text-ink-2" aria-live="polite">
            {"error" in preview ? (
              <span className="text-bad-ink">{preview.error}</span>
            ) : (
              <>
                <b className="font-semibold text-ink">≈ {preview.summary.devices.toLocaleString()} devices</b> ·{" "}
                {preview.summary.nodes} on the map · {preview.summary.zones} zones · {preview.summary.sites}{" "}
                {preview.summary.sites === 1 ? "site" : "sites"} · {formatRate(preview.summary.internetMbps)} internet
              </>
            )}
          </div>
          <button
            onClick={() => {
              useApp.getState().setWizardOpen(false);
              useApp.getState().setSavesOpen(true);
            }}
            className="h-9 rounded-[10px] px-3 text-[13px] font-medium text-accent-ink hover:bg-accent/10"
          >
            Open a save…
          </button>
          <button
            onClick={() => {
              loadBusiness(sampleTopology);
              tour.afterBusinessCreated();
            }}
            className="h-9 rounded-[10px] px-3 text-[13px] font-medium text-accent-ink hover:bg-accent/10"
          >
            Use the sample business
          </button>
          <button
            onClick={create}
            disabled={"error" in preview}
            className="h-9 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(0,113,227,0.3)] hover:bg-accent-hover disabled:opacity-40"
          >
            Create network
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</h2>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[12px] leading-snug text-ink-3">{children}</p>;
}

function Segmented({
  value, options, onChange,
}: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-[10px] bg-fill/[0.05] p-0.5" role="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`h-8 flex-1 rounded-[8px] px-2 text-[12px] font-semibold transition-all ${
              on ? "bg-surface text-ink shadow-[0_1px_3px_rgb(var(--shade)/0.12)]" : "text-ink-2 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StepButton({
  onClick, disabled, label, children,
}: { onClick: () => void; disabled: boolean; label: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[16px] text-ink-2 hover:bg-surface disabled:opacity-30"
    >
      {children}
    </button>
  );
}
