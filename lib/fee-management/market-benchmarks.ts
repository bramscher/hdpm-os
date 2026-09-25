/**
 * Market reference — published residential property management fee
 * schedules from Central Oregon, the rest of Oregon, and the PNW.
 *
 * Static, dated research (web, 2026-09-24): figures come from each company's
 * own pricing/fees page unless sourceType says otherwise. null = not
 * published (never inferred). Fees change — the source link is the check.
 * To refresh, re-verify each URL and update BENCHMARK_CHECKED.
 */

export const BENCHMARK_CHECKED = 'September 24, 2026';

export type RegionKey = 'central_or' | 'oregon' | 'pnw';

export interface BenchmarkCompany {
  company: string;
  market: string;
  url: string;
  sourceType: 'company site' | 'third-party guide';
  mgmtFee: string | null;
  leasingFee: string | null;
  renewalFee: string | null;
  setupFee: string | null;
  maintenanceMarkup: string | null;
  otherFees: string | null;
  notes: string | null;
  /** Short verbatim snippet from the source supporting the main numbers. */
  quote: string | null;
}

export interface BenchmarkRegion {
  key: RegionKey;
  label: string;
  summary: {
    mgmtFee: string;
    leasingFee: string;
    renewalFee: string;
    setupFee: string;
    maintenanceMarkup: string;
    other: string;
  };
  companies: BenchmarkCompany[];
  notes?: string;
}

const CENTRAL_OREGON: BenchmarkRegion = {
  key: 'central_or',
  label: 'Central Oregon',
  summary: {
    mgmtFee: '8–10% of collected rent is standard (10% most common; Legacy 8%). Outliers: Asset Protection 5% tiering down by door count; Ziprent $150/mo flat.',
    leasingFee: '50% of one month is most common. Low: 25% (Preferred, A Superior), $495 flat (Rental PM Bend), free (Utopia). High: $1,500 flat (Ziprent).',
    renewalFee: '$200–$250 where charged (RPM Ignite, Ziprent), or 3/8 of a month (Asset Protection). 3 firms charge none.',
    setupFee: '$100–$200 where charged (Wild West, RPM Ignite). 3 firms charge none; others silent.',
    maintenanceMarkup: 'Split: 4 firms take no markup; RPM Ignite and Asset Protection charge 15%.',
    other: 'No monthly vacancy fees published; 5 firms say no fee while vacant. Inspection fee published by one firm ($95).',
  },
  notes:
    'Well-known local firms that do not publish fees online: PMI Central Oregon, Arise, Summit Property Solutions, Mt. Bachelor PM, Plus Property Management, La Pine PM Services, Cascade Home Rentals, Ponderosa Properties.',
  companies: [
    {
      company: 'Real Property Management Ignite',
      market: 'Bend · Redmond, Sisters, Sunriver, Prineville',
      url: 'https://www.rpmignite.com/pricing',
      sourceType: 'company site',
      mgmtFee: '10% of monthly rent',
      leasingFee: "50% of one month's rent",
      renewalFee: '$250',
      setupFee: '$200',
      maintenanceMarkup: '15% maintenance coordination',
      otherFees: null,
      notes: 'Franchise "Value" plan; the fullest traditional schedule in the region.',
      quote: '10% of monthly rent · $200 Setup Fee · 50% Leasing Fee · $250 Lease Renewal Fee · 15% Maintenance Coordination',
    },
    {
      company: 'Legacy Property Management',
      market: 'Bend · Redmond, Sisters',
      url: 'https://legacypropertymanagement.com/property-management-cost-in-bend/',
      sourceType: 'company site',
      mgmtFee: '8% of collected rent',
      leasingFee: "50% of one month's rent",
      renewalFee: 'None',
      setupFee: 'None',
      maintenanceMarkup: 'None (vendor invoices at cost)',
      otherFees: null,
      notes: 'States it charges "nothing else" beyond 8% + placement.',
      quote: "Legacy charges 8% of collected rent, 50% of one month's rent for placement, and nothing else.",
    },
    {
      company: 'Rental Property Management Bend',
      market: 'Bend',
      url: 'https://rentalpropertymanagementbend.com/pricing-services-bend/',
      sourceType: 'company site',
      mgmtFee: '10% of rent collected',
      leasingFee: '$495 flat',
      renewalFee: 'None',
      setupFee: 'None',
      maintenanceMarkup: 'None',
      otherFees: 'In-house handyman $100 first hour, $80/hr after',
      notes: 'Two-fee model; explicitly no setup, renewal, vacancy or markup fees.',
      quote: 'charges 10% of monthly rent collected and a flat $495 tenant placement fee.',
    },
    {
      company: 'Preferred Residential',
      market: 'Bend · Redmond, Sisters, Prineville',
      url: 'https://prbend.com/property-management-cost-redmond-oregon/',
      sourceType: 'company site',
      mgmtFee: 'From 10% of rent collected (as low as 5%, quoted per property)',
      leasingFee: "25% of first month's rent",
      renewalFee: 'None',
      setupFee: 'None',
      maintenanceMarkup: 'None',
      otherFees: 'No inspection or admin fees',
      notes: 'Lowest percentage placement fee found.',
      quote: 'Our tenant-placement fee is 25% of the rent collected in the first month of a new tenancy.',
    },
    {
      company: 'A Superior Property Management',
      market: 'Bend · Redmond, Sisters, Prineville, Madras',
      url: 'https://www.rentaroundbend.com/management-services',
      sourceType: 'company site',
      mgmtFee: '9% of collected rent (Owner FAQ page says 10%)',
      leasingFee: "25% of one month's rent (placement-only: 50%)",
      renewalFee: '$200+ plus lease forms (placement-only clients)',
      setupFee: '$250 to take over an existing tenant',
      maintenanceMarkup: 'None',
      otherFees: 'Virtual tours ~$150',
      notes: 'Month-to-month contracts; multi-property discounts. Its two pages disagree on 9% vs 10%.',
      quote: 'No charge until we find a renter, then 25% of one months rent, 9% of collected rent after that.',
    },
    {
      company: 'Asset Protection Property Management',
      market: 'Bend · Redmond, Sisters, Prineville, La Pine, Sunriver',
      url: 'https://www.assetprotectionpm.com/owners/prices',
      sourceType: 'company site',
      mgmtFee: '5% (1–2 doors), 4% (3+), 3% (10+), 2% (20+), 1% (60+)',
      leasingFee: "½ of first month's rent",
      renewalFee: "⅜ of one month's rent",
      setupFee: null,
      maintenanceMarkup: '15% on vendor invoices',
      otherFees: 'Inspections $95; $500/unit retainer',
      notes: 'Only published door-count discount schedule; offsets low % with markup and renewal fee.',
      quote: 'If you have one or two residential properties … the management fee would be 5% of the collected rents.',
    },
    {
      company: 'Utopia Management (Bend office)',
      market: 'Bend · Redmond',
      url: 'https://utopiamanagement.com/how-much-does-property-management-cost-in-bend',
      sourceType: 'company site',
      mgmtFee: '8–10% of monthly rent',
      leasingFee: 'Free under full management',
      renewalFee: null,
      setupFee: null,
      maintenanceMarkup: null,
      otherFees: null,
      notes: 'Multi-state company; gives a range, not a single rate.',
      quote: '8%-10% of monthly rent ... Free leasing on properties under full management',
    },
    {
      company: 'Thorn Property Management',
      market: 'Bend · Sisters, Redmond, Sunriver',
      url: 'https://thornpropertymanagement.com/',
      sourceType: 'company site',
      mgmtFee: 'Typically 8–10% (long-term rentals)',
      leasingFee: null,
      renewalFee: null,
      setupFee: null,
      maintenanceMarkup: null,
      otherFees: 'STR 15–25%; commercial fees quoted separately',
      notes: 'Quotes per property.',
      quote: 'Fees are competitive, typically 8-10% of monthly rent for full management of long term rentals',
    },
    {
      company: 'Ziprent',
      market: 'Bend · Redmond (Portland-based)',
      url: 'https://ziprent.com/property-management/bend/',
      sourceType: 'company site',
      mgmtFee: '$150/mo flat per property ($100 each additional); guarantee plan $250/mo',
      leasingFee: '$1,500 flat (included in guarantee plan)',
      renewalFee: '$250 (included in guarantee plan)',
      setupFee: null,
      maintenanceMarkup: null,
      otherFees: null,
      notes: 'Flat-fee model, not a percentage.',
      quote: 'Tenant Placement $1,500 — Due at lease signing and security deposit receipt.',
    },
    {
      company: 'Wild West Property Management',
      market: 'Prineville',
      url: 'http://www.prineville.org/real-estate-properties/wild-west-property-management-llc/',
      sourceType: 'third-party guide',
      mgmtFee: '10% (typical)',
      leasingFee: null,
      renewalFee: null,
      setupFee: '$100 per unit, one-time',
      maintenanceMarkup: null,
      otherFees: 'Owner reserve required',
      notes: 'From a Prineville business-directory listing (undated).',
      quote: 'Our typical management rate is 10%. A one-time setup fee of $100.00 per unit as well as an owner reserve are required.',
    },
  ],
};

const OREGON: BenchmarkRegion = {
  "key": "oregon" as const,
  "label": "Oregon (excl. Central OR)",
  "summary": {
    "mgmtFee": "5–11% for a single unit; most 8–10% (median ~8%). Volume discounts of 1–2 pts at 5+ units are common; one $85 minimum.",
    "leasingFee": "Typically 40–50% of one month with management (range 15–58%); $500 flat at two firms; one charges none. Placement-only: 75–150% of a month.",
    "renewalFee": "$150 flat, 10–37.5% of a month's rent, or included. Typical ~$150–$300 equivalent.",
    "setupFee": "$90–$475 where charged (typical $90–$275); one firm none.",
    "maintenanceMarkup": "0–10% typical (3 firms none, Grid 10%); 15% outlier; $35/work order flat at one firm; 10–12% on projects.",
    "other": "New recurring admin/tech fees: $199/yr (Centurion), $145/owner + $48/unit per yr (Connection). Inspections $95–$150; eviction handling $250."
  },
  "notes": "Firms that publish no fees online (excluded): Legacy PM, Burgess Elliot, McNeeley (Portland); Vallis PM (Salem); Ashland PM, Lithia Property, Sterling West (Rogue Valley).",
  "companies": [
    {
      "company": "Grid Property Management",
      "market": "Beaverton / Portland metro",
      "url": "https://www.gridpropertymanagement.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "10% SFR/condo; 9% (2–4 units), 8% (5–10), 7% (11+)",
      "leasingFee": "50% of first month's rent",
      "renewalFee": "None",
      "setupFee": "None",
      "maintenanceMarkup": "10% maintenance management fee",
      "otherFees": "None (\"We charge no other fees\")",
      "notes": null,
      "quote": "10% of each month's collected rent for single family/condo properties ... 50% of the first month's rent"
    },
    {
      "company": "Green Keys Property Management",
      "market": "Portland",
      "url": "https://www.greenkeyspdx.com/owner-price-list",
      "sourceType": "company site" as const,
      "mgmtFee": "7.9% (Portland), 8.5% outside; 7.6–7.8% multi-unit",
      "leasingFee": "40% of rent (placement-only: one month)",
      "renewalFee": "$150",
      "setupFee": "$90 one-time new client",
      "maintenanceMarkup": "None (coordination included)",
      "otherFees": "Inspection $150 on request; $500 only if cancelled before first placement",
      "notes": "No fee when rent isn’t collected.",
      "quote": "If we don't collect rent, you don't pay the fee"
    },
    {
      "company": "LongStreet Property Management",
      "market": "Portland metro · Salem · Corvallis/Albany",
      "url": "https://longstreetpropertymanagement.com/pricing/",
      "sourceType": "company site" as const,
      "mgmtFee": "9.95% (1–4 units); 8.95% (5–10)",
      "leasingFee": "½ of one month's rent",
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": "0% on vendors; 10% on supplies",
      "otherFees": "In-house maintenance $75/hr",
      "notes": "Month-to-month; 90-day money-back guarantee.",
      "quote": "No management fee charged until rent is collected"
    },
    {
      "company": "ProFast Property Management",
      "market": "Portland",
      "url": "https://profastpropertymanagement.com/portland-property-management-fees/",
      "sourceType": "company site" as const,
      "mgmtFee": "11% of monthly rents",
      "leasingFee": null,
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": null,
      "notes": "Markets one all-in fee; other fees not itemized.",
      "quote": "11% of monthly rents, PERIOD."
    },
    {
      "company": "Centurion Real Estate Management",
      "market": "Salem / Keizer",
      "url": "https://www.c-rem.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "7% (SFR, 2–4 units); 6% (5–12)",
      "leasingFee": "27% of one month (SFR/2–4); 17% (5–12); lease-only 75%",
      "renewalFee": "10% of a month's rent",
      "setupFee": "$273 (SFR/2–4); $373; $473",
      "maintenanceMarkup": null,
      "otherFees": "Tech fee $199/yr",
      "notes": null,
      "quote": "27% of one month's rent"
    },
    {
      "company": "Nest West Property",
      "market": "Eugene / Springfield",
      "url": "https://www.nestwestproperty.com/management-fees",
      "sourceType": "company site" as const,
      "mgmtFee": "8% per unit or $85, whichever is greater",
      "leasingFee": "None",
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": "None on routine repairs",
      "otherFees": null,
      "notes": "Fully bundled; no placement fee.",
      "quote": "8% Flat Rate Management Fee PER UNIT (or $85, whichever is greater)"
    },
    {
      "company": "Trio Property Management",
      "market": "Eugene",
      "url": "https://www.triopm.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "10%",
      "leasingFee": "15% of one month with management; placement-only 75%",
      "renewalFee": null,
      "setupFee": "Optional: $99 rental analysis, $125 photos",
      "maintenanceMarkup": "$35 per work order (flat)",
      "otherFees": "Zillow $3/day; video tour $125; evaluations $79–$150",
      "notes": "\"Additional charges may apply.\"",
      "quote": "15% of one month's rent ... 10% ... $35 per work order"
    },
    {
      "company": "Connection Property Management",
      "market": "Eugene",
      "url": "https://www.connectionoregon.com/pricing/",
      "sourceType": "company site" as const,
      "mgmtFee": "9.5% (1–4 units); 8.5% (5–19); 7.75% (20+)",
      "leasingFee": "58% of one month ($595 min, $2,495 max)",
      "renewalFee": "22.5% of one month ($275 min, $975 max)",
      "setupFee": "$245 new owner + $45/unit; $199 tenant takeover",
      "maintenanceMarkup": "12% project management fee",
      "otherFees": "$145/owner/yr compliance + $48/unit/yr tech; optional $83/mo maintenance plan",
      "notes": "The most itemized schedule found.",
      "quote": "you only pay when we collect rent"
    },
    {
      "company": "D&A, Inc. (Duerksen & Associates)",
      "market": "Corvallis / Albany",
      "url": "https://www.duerksenrentals.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "Plans: 8% / 10% / 15% (Bronze / Silver / Gold)",
      "leasingFee": "$500 (Bronze/Silver); included (Gold)",
      "renewalFee": "Included (lease-only: $250)",
      "setupFee": "$250 one-time (included with Gold)",
      "maintenanceMarkup": null,
      "otherFees": "Lease-only turnover + move-in inspection $425",
      "notes": null,
      "quote": "Management Fee (We only get paid when you do)"
    },
    {
      "company": "Asset Protection Property Management",
      "market": "Corvallis / Albany (also Central OR)",
      "url": "https://www.assetprotectionpm.com/owners/prices",
      "sourceType": "company site" as const,
      "mgmtFee": "5% (1–2 units) tiering to 1% (60+)",
      "leasingFee": "½ of first month's rent",
      "renewalFee": "⅜ of one month's rent",
      "setupFee": null,
      "maintenanceMarkup": "Cost + 15%",
      "otherFees": "Inspections $95; $500/unit retainer",
      "notes": "Same schedule as its Central Oregon listing.",
      "quote": "charge for lease signings to place a new tenant of 1/2 the first month's rent"
    },
    {
      "company": "McCracken Property Management",
      "market": "Ashland / Medford",
      "url": "https://mccrackenrentals.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "10%",
      "leasingFee": "$500",
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": "10% on remodel projects",
      "otherFees": "\"Vacancy management\" $100 (basis not stated); eviction services $250; premium marketing $250",
      "notes": null,
      "quote": "10% ... $500 ... Vacancy Management $100"
    },
    {
      "company": "Quality Property Management",
      "market": "Medford",
      "url": "https://www.qpmcompany.com/medford-property-management",
      "sourceType": "company site" as const,
      "mgmtFee": "5–10% (~8% for one unit; 5–6% large complexes)",
      "leasingFee": null,
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": "Advertising $55/month",
      "notes": "Negotiable for large or multiple accounts.",
      "quote": "5-10% of monthly rents (i.e. one unit is around 8%, large apartment complexes are 5-6%)"
    },
    {
      "company": "Northwoods Property Management",
      "market": "Medford (also Springfield)",
      "url": "https://www.northwoodspm.com/medford-property-management",
      "sourceType": "company site" as const,
      "mgmtFee": "Up to 8%",
      "leasingFee": null,
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": null,
      "notes": "Publishes only its fee cap.",
      "quote": "maximum management fee of 8%"
    }
  ]
};

const PNW: BenchmarkRegion = {
  "key": "pnw" as const,
  "label": "PNW (WA + ID)",
  "summary": {
    "mgmtFee": "WA: mostly 10% (range 8–10%); Ziprent $150/mo flat. ID: 7–10% (Bluebird 8%, Smart Move 9%); flat $95–$195/mo and $79 + 4.9% hybrids.",
    "leasingFee": "WA: 50% or 100% of one month, $1,500 flat, or included. ID: lower — $0, 20%, $250 flat, 50%, 75%.",
    "renewalFee": "WA: $0–$395 (typical $250–$400); one at 50–75% of a month. ID: $0–$199 (typical $100–$200).",
    "setupFee": "WA: $0–$295. ID: $100–$299.",
    "maintenanceMarkup": "Rarely published: WA firms that state it take 0%; ID: Bellhaven 10% on its basic plan, Smart Move $5/work order.",
    "other": "Boise-area firms compete hardest on price; renewal, setup and markup are published by fewer than half of firms. WA vacancy minimums $35–$99/mo at one firm."
  },
  "notes": "Firms that publish no fees online (excluded): Wilson Management, Sagareus, RentSeattle, Keyrenter Boise/Tacoma, Zenith (Vancouver WA), Windermere/Guenther (Spokane).",
  "companies": [
    {
      "company": "GPS Renting",
      "market": "Seattle / Eastside, WA",
      "url": "https://gpsrenting.com/services-and-pricing/",
      "sourceType": "company site" as const,
      "mgmtFee": "10% (+$0/$49/$99 per mo by plan); Traditional plan 8%",
      "leasingFee": "None on subscription plans; Traditional 50% of a month",
      "renewalFee": "$395 / $245 / waived by plan",
      "setupFee": "$295 per property",
      "maintenanceMarkup": null,
      "otherFees": "Vacancy minimum $35–$99/mo by plan; photography $295",
      "notes": "Its blog says no setup/renewal fees; pricing page lists them.",
      "quote": "10% of Monthly Rent ... $395 Lease Renewal Fee"
    },
    {
      "company": "RexMont Real Estate",
      "market": "Bellevue, WA",
      "url": "https://rexmont.com/property-management-cost-seattle",
      "sourceType": "company site" as const,
      "mgmtFee": "8% / 9% / 10% by plan",
      "leasingFee": "One month's rent",
      "renewalFee": "50–75% of one month's rent",
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": "Paid on rent collected; setup/maintenance terms in proposal",
      "notes": "From its cost-guide page.",
      "quote": "8% / 9% / 10% — flat rate by plan ... One month's rent"
    },
    {
      "company": "Ziprent",
      "market": "Tacoma, WA (also Spokane, Vancouver, Kennewick)",
      "url": "https://www.ziprent.com/tacoma-property-management",
      "sourceType": "company site" as const,
      "mgmtFee": "$150/mo flat ($100 each additional); $250/mo guarantee plan",
      "leasingFee": "$1,500 flat",
      "renewalFee": "$250",
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": null,
      "notes": "Multi-state flat-fee company.",
      "quote": "$150/month ... $1500 ... $250 per lease renewal"
    },
    {
      "company": "The Hornberger Group",
      "market": "Spokane, WA (also Coeur d’Alene, ID)",
      "url": "https://thehornbergergroup.com/property-management/pricing-packages/",
      "sourceType": "company site" as const,
      "mgmtFee": "From 10% (SFR); 9% (10+ units)",
      "leasingFee": null,
      "renewalFee": "\"Low\" (amount not published)",
      "setupFee": "$0",
      "maintenanceMarkup": "0%",
      "otherFees": "No inspection or cancellation fees",
      "notes": null,
      "quote": "No setup or onboarding fees ... No markup on maintenance or repairs"
    },
    {
      "company": "Call Realty",
      "market": "Spokane Valley, WA",
      "url": "https://www.callrealty.com/pricing/",
      "sourceType": "company site" as const,
      "mgmtFee": "10% of monthly rent",
      "leasingFee": "50% of one month (full service); one month (tenant-only)",
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": "Tenant-only advertising $129 then $91/mo",
      "notes": null,
      "quote": "10% of monthly rent ... Discounted Tenant Placement (50% of one month's rent)"
    },
    {
      "company": "VPMG Property Management",
      "market": "Vancouver, WA",
      "url": "https://propertymanagementvancouverwa.com/blog/property-management-cost/",
      "sourceType": "company site" as const,
      "mgmtFee": "8% flat",
      "leasingFee": "Included",
      "renewalFee": "$0",
      "setupFee": "$0",
      "maintenanceMarkup": "0%",
      "otherFees": "Inspections included; $0 vacancy",
      "notes": "From its cost blog page.",
      "quote": "one flat 8% monthly fee covers leasing ... with $0 setup, $0 renewal, $0 vacancy fees"
    },
    {
      "company": "Real Property Management Tri-Cities",
      "market": "Kennewick, WA",
      "url": "https://www.rpmtricities.com/property-management-fees",
      "sourceType": "company site" as const,
      "mgmtFee": "10% of monthly rent",
      "leasingFee": "100% of one month (lease-only plan)",
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": null,
      "notes": "Full-management placement fee not stated.",
      "quote": "10% of monthly rent ... 100% One Month's Rent"
    },
    {
      "company": "Crown Property Management",
      "market": "Kennewick, WA",
      "url": "https://www.crownpropertymanagement.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "10%; 8% for 10+ units or $10k+/mo gross",
      "leasingFee": "50% of one month's rent",
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": null,
      "notes": null,
      "quote": "10% of the income collected in the month ... 50% of one month's rental rate"
    },
    {
      "company": "Bluebird Property Management",
      "market": "Boise / Meridian / Nampa, ID",
      "url": "https://www.bluebirdpropmgmt.com/boise-property-management-pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "8% (1–15 units); 7% (16+)",
      "leasingFee": "$0 (included)",
      "renewalFee": "$0 (included)",
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": "Accounting, inspections, 24/7 emergency included",
      "notes": null,
      "quote": "8% for 1–15 units 7% for 16+ units ... No leasing fees. No renewal fees."
    },
    {
      "company": "Smart Move Property Management",
      "market": "Boise, ID",
      "url": "https://www.smartmovepm.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "9%",
      "leasingFee": "20% of one month's rent",
      "renewalFee": "$150",
      "setupFee": "$100 onboarding",
      "maintenanceMarkup": "$5 per work order",
      "otherFees": "Preventive inspection $99.50 (2×/yr)",
      "notes": null,
      "quote": "9% per month ... 20% of one month's rent ... $150.00 ... $100.00"
    },
    {
      "company": "Next Step Realty Management",
      "market": "Boise, ID",
      "url": "https://www.boisepropertymanagement.com/pricing",
      "sourceType": "company site" as const,
      "mgmtFee": "Flat $95–$195/mo by rent level; $75/unit (4+ units)",
      "leasingFee": "$250",
      "renewalFee": "$100",
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": "Annual inspection $95; optional $25/unit/mo assurance",
      "notes": "Flat-fee model.",
      "quote": "Management Fee $75 Unit Per Month ... Leasing Commission $250 ... Lease Renewal Fee $100"
    },
    {
      "company": "Real Property Management Meridian",
      "market": "Meridian, ID",
      "url": "https://www.rpmmeridian.com/property-management-fees",
      "sourceType": "company site" as const,
      "mgmtFee": "7.9% / 9.9% / 12.9% by plan",
      "leasingFee": "75% of first month's rent",
      "renewalFee": null,
      "setupFee": null,
      "maintenanceMarkup": null,
      "otherFees": null,
      "notes": "No placement fee if tenant already in place or owner-found.",
      "quote": "75% of the first month's rent amount, charged one time immediately after a tenant moves in"
    },
    {
      "company": "Bellhaven",
      "market": "Nampa, ID",
      "url": "https://www.bellhaven.org/property-management/nampa-id",
      "sourceType": "company site" as const,
      "mgmtFee": "Basic plan $79/mo per unit + 4.9% of rent",
      "leasingFee": "50% of one month's rent",
      "renewalFee": "$199 / $99 / included by plan",
      "setupFee": "$299/unit (waived on top plan)",
      "maintenanceMarkup": "Cost + 10% (basic plan); 0% on higher plans",
      "otherFees": "Eviction coordination $499 + legal (basic); extra inspections $99",
      "notes": null,
      "quote": "$79/month base fee per unit plus 4.9% of rent collected ... 50% of 1 months rent"
    },
    {
      "company": "1st Rate Property Management",
      "market": "Boise / Nampa, ID",
      "url": "https://www.boiseproperty.management/nampa-property-management",
      "sourceType": "company site" as const,
      "mgmtFee": "8–10% of monthly rent",
      "leasingFee": null,
      "renewalFee": "$50",
      "setupFee": "$250",
      "maintenanceMarkup": null,
      "otherFees": "Tax preparation $25",
      "notes": "Listed as \"additional costs may apply\".",
      "quote": "FRPM's management fees in the Boise area range from 8%–10% of monthly rent."
    }
  ]
};

export const BENCHMARK_REGIONS: BenchmarkRegion[] = [CENTRAL_OREGON, OREGON, PNW];

/** Oregon rules that constrain tenant-paid fees (ORS 90). Owner-side fees are contractual. */
export const OREGON_FEE_LAW: { topic: string; rule: string; url: string }[] = [
  {
    "topic": "Late rent fees — ORS 90.260",
    "rule": "Only with a written agreement and after rent is late past the 4th day: a reasonable flat fee once per period, a daily fee from day 5 capped at 6% of the flat reference amount, or 5% of periodic rent per 5-day period.",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html"
  },
  {
    "topic": "Applicant screening charge — ORS 90.295",
    "rule": "May not exceed the average actual screening cost or the customary screening-agency charge; one charge per applicant per 60 days; refund within 30 days if not screened or the unit fills first.",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html"
  },
  {
    "topic": "Permitted tenant fees — ORS 90.302",
    "rule": "Only listed fees, each in the written agreement (late rent, dishonored check, noncompliance fees after warning, etc.); no fees at tenancy start for anticipated landlord expenses. Improper fees: 2× damages or $300.",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors090.html"
  },
  {
    "topic": "2026 SB 1523 — payment methods and portals (enrolled)",
    "rule": "Landlord must accept a check or other commercially reasonable method and cannot require portal/electronic payment; limits on pass-through processing fees. Confirm the effective date before relying on it.",
    "url": "https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/SB1523/Enrolled"
  }
];

