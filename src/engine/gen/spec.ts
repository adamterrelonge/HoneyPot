/**
 * Business specification: what the onboarding wizard collects (build.md §8 Phase 3).
 * Validated with Zod so a spec from the UI, a test or a share code is always safe to generate.
 */
import { z } from "zod";
import {
  BUDGETS, BUSINESS_SIZES, COMPLIANCE, HOSTING, INDUSTRIES,
  type Budget, type BusinessSize, type Compliance, type Hosting, type Industry,
} from "../model";
import { mulberry32 } from "../sim/rng";

export const STAFF_RANGE: Record<BusinessSize, [number, number]> = {
  sme: [10, 50],
  mid: [50, 250],
  enterprise: [250, 2000],
};

export const SITE_RANGE: Record<BusinessSize, [number, number]> = {
  sme: [1, 2],
  mid: [2, 3],
  enterprise: [5, 8],
};

export const DEFAULT_STAFF: Record<BusinessSize, number> = { sme: 24, mid: 120, enterprise: 800 };

export const INDUSTRY_INFO: Record<
  Industry,
  { label: string; blurb: string; icon: string; names: string[]; compliance: Compliance[] }
> = {
  professional: {
    label: "Professional services",
    blurb: "Accountants, lawyers, consultancies. Client data, file shares and a client portal.",
    icon: "/emoji/industry-professional.png",
    names: ["Harbour & Finch Accountants", "Marlow Kent Solicitors", "Ashby Rowe Consulting", "Sterling Vale Partners"],
    compliance: ["gdpr", "cyber-essentials"],
  },
  retail: {
    label: "Retail",
    blurb: "Head office plus shops. Card terminals, guest Wi-Fi and an online shop.",
    icon: "/emoji/industry-retail.png",
    names: ["Northwind Outfitters", "Copper Kettle Homeware", "Bramble & Birch", "Lumen Street Stores"],
    compliance: ["gdpr", "pci-dss"],
  },
  healthcare: {
    label: "Healthcare clinic",
    blurb: "Clinics with patient records, imaging devices and a strict clinical zone.",
    icon: "/emoji/industry-healthcare.png",
    names: ["Riverside Family Clinic", "Elmwood Health Partners", "Northgate Medical Practice", "Clearview Diagnostics"],
    compliance: ["gdpr", "health-data"],
  },
  manufacturing: {
    label: "Manufacturing",
    blurb: "Offices beside a factory floor of production-line controllers and SCADA.",
    icon: "/emoji/industry-manufacturing.png",
    names: ["Calder Precision Engineering", "Ironbridge Components", "Fenwick Fabrication", "Albion Plastics"],
    compliance: ["gdpr", "iso27001"],
  },
  education: {
    label: "Education",
    blurb: "Schools and colleges. Staff laptops, busy student Wi-Fi and a student records system.",
    icon: "/emoji/industry-education.png",
    names: ["Oakfield Academy", "St Aldhelm's College", "Brookmere High School", "Westgate Sixth Form"],
    compliance: ["gdpr", "cyber-essentials"],
  },
  logistics: {
    label: "Logistics",
    blurb: "Warehouses and depots. Handheld scanners, a warehouse system and tight dispatch windows.",
    icon: "/emoji/industry-logistics.png",
    names: ["Swift Haul Logistics", "Pennine Freight", "Kingsway Distribution", "Harrow & Lane Logistics"],
    compliance: ["gdpr", "iso27001"],
  },
};

export const SIZE_LABELS: Record<BusinessSize, string> = { sme: "Small (SME)", mid: "Mid-size", enterprise: "Enterprise" };

export const BUDGET_INFO: Record<Budget, { label: string; blurb: string }> = {
  lean: { label: "Lean", blurb: "Tight capacity, single ISP, ageing kit, no offsite backup." },
  standard: { label: "Standard", blurb: "Sensible headroom, fibre core, offsite backup." },
  generous: { label: "Generous", blurb: "Dual ISP, private WAN to branches, modern estate." },
};

export const HOSTING_INFO: Record<Hosting, { label: string; blurb: string }> = {
  "cloud-first": { label: "Cloud-first", blurb: "Email, files, sign-in and the business system are SaaS." },
  "on-prem": { label: "On-premises", blurb: "Domain controller, file and database servers in the server room." },
};

export const COMPLIANCE_INFO: Record<Compliance, { label: string; blurb: string }> = {
  gdpr: { label: "GDPR", blurb: "Personal data is tagged so you can see where it lives." },
  "pci-dss": { label: "PCI DSS", blurb: "Card terminals segregated in their own zone and VLAN." },
  "health-data": { label: "Health data", blurb: "Clinical systems in a separate clinical zone." },
  iso27001: { label: "ISO 27001", blurb: "Managed estate: fewer end-of-life systems and default passwords." },
  "cyber-essentials": { label: "Cyber Essentials", blurb: "Basic hygiene: no default passwords, supported software." },
};

export const BusinessSpecSchema = z
  .object({
    name: z.string().trim().min(1, "Give the business a name").max(60),
    industry: z.enum(INDUSTRIES),
    size: z.enum(BUSINESS_SIZES),
    employees: z.number().int(),
    sites: z.number().int(),
    hosting: z.enum(HOSTING),
    budget: z.enum(BUDGETS),
    compliance: z.array(z.enum(COMPLIANCE)),
    seed: z.number().int(),
  })
  .superRefine((s, ctx) => {
    const [lo, hi] = STAFF_RANGE[s.size];
    if (s.employees < lo || s.employees > hi) {
      ctx.addIssue({ code: "custom", path: ["employees"], message: `${s.size} businesses have ${lo}–${hi} staff` });
    }
    const [slo, shi] = SITE_RANGE[s.size];
    if (s.sites < slo || s.sites > shi) {
      ctx.addIssue({ code: "custom", path: ["sites"], message: `${s.size} businesses have ${slo}–${shi} sites` });
    }
  });

export type BusinessSpec = z.output<typeof BusinessSpecSchema>;

export function defaultSpec(industry: Industry = "professional", size: BusinessSize = "sme", seed = 1337): BusinessSpec {
  return {
    name: INDUSTRY_INFO[industry].names[0]!,
    industry,
    size,
    employees: DEFAULT_STAFF[size],
    sites: SITE_RANGE[size][0],
    hosting: "on-prem",
    budget: "standard",
    compliance: [...INDUSTRY_INFO[industry].compliance],
    seed,
  };
}

/** A random but valid spec (property tests, "Surprise me"). */
export function randomSpec(seed: number): BusinessSpec {
  const r = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[r.int(0, xs.length - 1)]!;
  const industry = pick(INDUSTRIES);
  const size = pick(BUSINESS_SIZES);
  const [lo, hi] = STAFF_RANGE[size];
  const [slo, shi] = SITE_RANGE[size];
  return {
    name: pick(INDUSTRY_INFO[industry].names),
    industry,
    size,
    employees: r.int(lo, hi),
    sites: r.int(slo, shi),
    hosting: pick(HOSTING),
    budget: pick(BUDGETS),
    compliance: COMPLIANCE.filter(() => r.chance(0.4)),
    seed: r.int(1, 1_000_000),
  };
}
