/**
 * Development seed.
 *
 * Ports the mock data already rendered by `client/src/data/*.js` into real
 * relational rows — three articles from `articles.js`, both issues from
 * `magazines.js`, the full taxonomy from `topics.js` plus the doc's §8
 * category list, and one account per role (§0.2.1: PUBLISHER is admin-granted,
 * never self-registered, so the seed is how the first one gets created).
 *
 * Idempotent: safe to run against a database that already has this data —
 * every write is `upsert` keyed on a natural unique field (email, slug, name),
 * so re-running does not create duplicates or throw.
 *
 * Article content blocks follow the canonical shapes fixed in
 * `src/utils/blockSchemas.js` docs (Phase 5) — see the comment above
 * ARTICLES below for the field-by-field mapping from the doc's §14 spec.
 *
 * Run with: npm run seed
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/password.js";
import { slugify } from "../src/utils/slug.js";
import { estimateReadingMinutes } from "../src/utils/readingTime.js";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
// Seed passwords are for local development only — never reused anywhere real.
const SEED_PASSWORD = "DevPassword!23";

const ACCOUNTS = [
  { name: "Energy Konnect Admin", email: "admin@energykonnect.dev", role: "ADMIN" },
  { name: "Energy Editorial", email: "publisher@energykonnect.dev", role: "PUBLISHER" },
  { name: "Arnab Dinda", email: "reader@energykonnect.dev", role: "USER" },
];

// ---------------------------------------------------------------------------
// Taxonomy — categories (doc §8) and topics (client/src/data/topics.js)
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { name: "Renewable Energy" },
  { name: "Thermal Power" },
  { name: "Energy Policy" },
  { name: "Electricity & Grid" },
  { name: "Energy Economics" },
  { name: "Bioenergy" },
  { name: "Coal" },
];

const TOPICS = [
  {
    name: "Renewable Energy",
    description:
      "Coverage of renewable generation, the policy scaffolding around it and India's wider energy transition.",
  },
  {
    name: "Solar Energy",
    description:
      "Utility scale and rooftop solar — programmes, regulations, net metering and consumer participation.",
  },
  {
    name: "Wind Energy",
    description:
      "Wind generation, its integration with the grid and the economics of variable output.",
  },
  {
    name: "Thermal Power",
    description:
      "Conventional thermal generation: plant performance, heat rate, auxiliary consumption and normative parameters.",
  },
  {
    name: "Coal",
    description:
      "Coal supply, commercial coal mining in India and the fuel side of thermal generation.",
  },
  {
    name: "Bioenergy",
    description: "Biogas, anaerobic digestion and energy recovery from organic and kitchen waste.",
  },
  {
    name: "Energy Policy",
    description:
      "Rules, regulations and policy instruments shaping generation, distribution and consumption.",
  },
  {
    name: "Electricity & Grid",
    description:
      "Distribution utilities, retail supply, metering and the mechanics of moving power to consumers.",
  },
  {
    name: "Energy Economics",
    description:
      "Tariff determination, capacity and energy charges, power purchase cost and plant economics.",
  },
  {
    name: "Energy Technology",
    description: "Conversion technology, plant systems and the engineering behind energy delivery.",
  },
  {
    name: "Energy Efficiency",
    description:
      "Reducing losses and improving how efficiently energy is generated, delivered and used.",
  },
  {
    name: "Sustainability",
    description:
      "Environmental benefits, emissions, waste valorisation and long-term sustainable practice.",
  },
];

// ---------------------------------------------------------------------------
// Magazines — formerly ported from client/src/data/magazines.js (deleted)
// ---------------------------------------------------------------------------

const ISSUES = [
  {
    key: "issue-2022-17",
    volumeNumber: 2,
    issueNumber: 17,
    title: "Energy Konnect",
    period: "July–August 2022",
    theme: "A Step Towards Self Reliance Energy",
    description:
      "The July–August 2022 issue is built around energy as a step towards self reliance, with a cover story on producing biogas from kitchen waste and tutorials on rooftop solar policy, regulation and programme participation.",
  },
  {
    key: "issue-2020-05",
    volumeNumber: 1,
    issueNumber: 5,
    title: "Energy Konnect",
    period: "September–October 2020",
    theme: "Power & Energy",
    description:
      "The September–October 2020 issue leads with the commercial aspects of coal based power generation and tariff determination, alongside commercial coal mining, retail tariff determination and the draft Electricity (Rights of Consumers) Rules, 2020.",
  },
];

// ---------------------------------------------------------------------------
// Articles — ported from client/src/data/articles.js.
//
// Block content shapes (fixed here as the canonical form Phase 5's
// blockSchemas.js will validate against — see IMPLEMENTATION_PLAN.md §0.3):
//   heading    { level, text }
//   paragraph  { text }
//   quote      { text, attribution? }
//   callout    { title?, text }
//   image      { mediaId, caption?, altText? }
//   figure     { mediaId, caption?, source? }
//   table      { caption?, columns: string[], rows: string[][] }
//   list       { style: "ordered" | "unordered", items: string[] }
//   formula    { expression, note? }
//   reference  { items: [{ label, url? }] }
//
// This extends the doc's §14 minimums in two places: `formula` carries
// `expression`/`note` instead of a single `formula` string (matches the
// source material, which states formulas in words, not symbols), and
// `reference` takes a list of citations instead of one — every article here
// cites more than one source. `image`/`figure` use `mediaId` (camelCase, to
// match the rest of the JSON API) instead of the doc's `media_id`.
// ---------------------------------------------------------------------------

const ARTICLES = [
  {
    slugSeed: "solar-rooftop-policies-regulations-gujarat",
    title: "Solar Rooftop Policies & Regulations in Gujarat",
    subtitle: "How state level policy and regulation shape rooftop solar adoption.",
    summary:
      "A tutorial on the policy and regulatory framework governing rooftop solar in Gujarat, covering the state solar power policy, net metering arrangements and what they mean for consumers considering a rooftop system.",
    authorName: "Mr. Anand Kumar & Ms. Divya Sharma",
    authorBio: "Contributors, Energy Konnect — Volume II, Issue 17 (July–August 2022).",
    category: "Energy Policy",
    topics: ["Solar Energy", "Renewable Energy", "Energy Policy"],
    tags: ["Solar", "Rooftop Solar", "Net Metering", "Gujarat"],
    issueKey: "issue-2022-17",
    sectionLabel: "Tutorial",
    displayOrder: 2,
    publishedAt: "2022-07-01",
    featured: true,
    coverMedia: { fileName: "rooftop-solar.jpg", altText: "Rooftop solar installation" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. Introduction" } },
      {
        type: "paragraph",
        data: {
          text: "Rooftop solar sits at the meeting point of consumer choice and state regulation. A household or commercial establishment installs generation on its own premises, yet what it may install, how it connects and how surplus energy is treated are all defined by policy and by regulations issued at state level.",
        },
      },
      {
        type: "paragraph",
        data: {
          text: "This tutorial walks through the framework that applies in Gujarat, a state that has been an early and consistent mover on rooftop solar. The intent is orientation rather than legal advice: a prospective consumer should read the current policy text and the applicable regulations issued by the state commission before committing to a system.",
        },
      },
      {
        type: "callout",
        data: {
          title: "Who this is for",
          text: "Consumers, facility managers and students who want a structured view of how rooftop solar is enabled and regulated at state level.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. The policy layer" } },
      {
        type: "paragraph",
        data: {
          text: "A state solar power policy sets direction. It signals the segments the state wants to grow — residential, institutional, commercial and industrial — and the mechanisms it intends to make available, such as self consumption with grid connectivity, and arrangements for injecting surplus generation into the distribution network.",
        },
      },
      { type: "heading", data: { level: 2, text: "3. The regulatory layer" } },
      {
        type: "paragraph",
        data: {
          text: "Regulations translate policy into operating rules. They define the process by which a consumer applies for connectivity, the technical standards a system must meet, the metering arrangement to be installed and the accounting treatment applied to energy exported to the grid.",
        },
      },
      {
        type: "list",
        data: {
          style: "unordered",
          items: [
            "Application and approval route through the distribution licensee",
            "Technical and safety standards for grid interconnection",
            "Metering arrangement, including the meter that records export",
            "Accounting and settlement of energy exported to the network",
          ],
        },
      },
      { type: "heading", data: { level: 2, text: "4. Net metering in practice" } },
      {
        type: "paragraph",
        data: {
          text: "Under a net metering arrangement, the energy a consumer draws from the network and the energy exported to it are both recorded, and the consumer is billed on the net position over the settlement period. The practical consequence is that a rooftop system does not need to match instantaneous demand to be useful — the network absorbs surplus during the day and supplies the consumer at night.",
        },
      },
      {
        type: "quote",
        data: {
          text: "Rooftop solar turns the consumer into a participant in the electricity system rather than only a recipient of supply.",
        },
      },
      { type: "heading", data: { level: 2, text: "5. What a consumer should verify" } },
      {
        type: "list",
        data: {
          style: "ordered",
          items: [
            "The system capacity permitted relative to the sanctioned load or contract demand",
            "The metering arrangement the licensee will install",
            "The settlement mechanism applicable to exported energy",
            "Any timelines and documentation the approval process requires",
          ],
        },
      },
      { type: "heading", data: { level: 2, text: "6. Conclusion" } },
      {
        type: "paragraph",
        data: {
          text: "Rooftop solar in Gujarat is enabled by a combination of state policy direction and detailed regulation. Consumers who understand both layers make better decisions about sizing, metering and expected benefit — and are better placed to engage with their distribution licensee.",
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume II, Issue 17, July–August 2022 — Tutorial: Solar Rooftop Policies & Regulations in Gujarat.",
            },
            {
              label:
                "Gujarat Solar Power Policy and the applicable state regulations (refer to current published text).",
            },
          ],
        },
      },
    ],
  },
  {
    slugSeed: "coal-power-plant-commercial-aspects-tariff-determination",
    title: "Coal Power Plant — Commercial Aspects: Tariff Determination",
    subtitle:
      "From coal to electricity, and from plant performance to the tariff a consumer eventually pays.",
    summary:
      "The cover article of Volume 1, Issue 5 examines how a conventional thermal power station converts coal into electricity, how heat rate and auxiliary power consumption describe its performance, and how these parameters feed into tariff determination through capacity and energy charges.",
    authorName: "Energy Konnect Editorial Desk",
    authorBio: "Cover article, Energy Konnect — Volume 1, Issue 5 (September–October 2020).",
    category: "Thermal Power",
    topics: ["Thermal Power", "Energy Economics", "Coal"],
    tags: ["Coal", "Thermal Power", "Electricity Tariff", "Heat Rate"],
    issueKey: "issue-2020-05",
    sectionLabel: "Cover Article",
    displayOrder: 1,
    publishedAt: "2020-09-01",
    featured: false,
    coverMedia: { fileName: "coal-plant.jpg", altText: "Coal-fired thermal power plant" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. Conventional thermal generation" } },
      {
        type: "paragraph",
        data: {
          text: "A conventional thermal power plant converts the chemical energy held in coal into electrical energy through a sequence of conversions: combustion releases heat, heat raises steam, steam drives a turbine, and the turbine drives a generator. Each stage carries losses, and the cumulative effect of those losses is what plant performance parameters attempt to describe.",
        },
      },
      {
        type: "callout",
        data: {
          title: "Why commercial and technical aspects sit together",
          text: "Tariff determination for a thermal station rests on technical performance parameters. Commercial outcomes cannot be discussed independently of heat rate, auxiliary consumption and plant availability.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. Heat rate" } },
      {
        type: "paragraph",
        data: {
          text: "Heat rate expresses the heat energy input required per unit of electrical energy produced. A lower heat rate means the station converts fuel to electricity more efficiently. It is the single most compact statement of thermal performance.",
        },
      },
      { type: "heading", data: { level: 3, text: "2.1 Gross heat rate" } },
      {
        type: "paragraph",
        data: {
          text: "Gross heat rate relates heat input to the gross electrical energy generated at the generator terminals, before any energy consumed within the station itself is deducted.",
        },
      },
      { type: "heading", data: { level: 3, text: "2.2 Auxiliary power consumption" } },
      {
        type: "paragraph",
        data: {
          text: "A power station consumes part of its own output to run mills, fans, pumps, compressors and other plant auxiliaries. This share is termed auxiliary power consumption, and it reduces the energy actually delivered to the grid.",
        },
      },
      { type: "heading", data: { level: 3, text: "2.3 Net heat rate" } },
      {
        type: "paragraph",
        data: {
          text: "Net heat rate relates heat input to the net energy exported from the station. Because auxiliary consumption reduces exportable energy, the net heat rate follows from the gross heat rate and the auxiliary consumption share.",
        },
      },
      {
        type: "formula",
        data: {
          expression: "Net Heat Rate = Gross Heat Rate / (1 − Auxiliary Power Consumption)",
          note: "Auxiliary power consumption expressed as a fraction of gross generation.",
        },
      },
      { type: "heading", data: { level: 2, text: "3. Normative parameters" } },
      {
        type: "paragraph",
        data: {
          text: "Rather than accepting actual operating performance as given, tariff regulations specify normative values for parameters such as heat rate, auxiliary consumption and availability. Performance better than the norm benefits the generator; performance worse than the norm is not passed through to the consumer. Norms therefore act as an efficiency discipline embedded in the tariff.",
        },
      },
      {
        type: "table",
        data: {
          caption: "Parameters that feed into tariff determination for a thermal station",
          columns: ["Parameter", "What it describes", "Where it acts"],
          rows: [
            ["Gross heat rate", "Heat input per unit of gross generation", "Energy charge"],
            ["Auxiliary power consumption", "Station's own electricity use", "Energy charge"],
            ["Net heat rate", "Heat input per unit of net export", "Energy charge"],
            ["Availability", "Readiness of the plant to generate", "Capacity charge"],
          ],
        },
      },
      { type: "heading", data: { level: 2, text: "4. Two part tariff" } },
      {
        type: "paragraph",
        data: {
          text: "The tariff for a thermal station is generally determined in two parts. The capacity charge is intended to recover fixed costs and is linked to the plant being available to generate. The energy charge is intended to recover variable cost, principally fuel, and is linked to energy actually delivered.",
        },
      },
      {
        type: "table",
        data: {
          caption: "Structure of a two part tariff",
          columns: ["Component", "Recovers", "Driven by"],
          rows: [
            ["Capacity charge", "Fixed cost of the station", "Availability"],
            ["Energy charge", "Variable cost, principally fuel", "Energy delivered and heat rate"],
          ],
        },
      },
      {
        type: "figure",
        data: {
          caption:
            "A conventional coal based thermal station; performance and commercial outcomes are tightly coupled.",
          source: "Energy Konnect",
        },
      },
      { type: "heading", data: { level: 2, text: "5. Power plant economics" } },
      {
        type: "paragraph",
        data: {
          text: "Read together, these elements explain why plant economics is not simply a matter of fuel price. A station with a favourable heat rate and disciplined auxiliary consumption delivers more saleable energy from the same fuel input, which improves its position in merit order dispatch and in the cost stack that the distribution licensee ultimately passes to consumers.",
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume 1, Issue 5, September–October 2020 — Cover Article: Coal Power Plant, Commercial Aspects: Tariff Determination.",
            },
          ],
        },
      },
    ],
  },
  {
    slugSeed: "biogas-from-kitchen-waste",
    title: "Biogas From Kitchen Waste",
    subtitle:
      "Anaerobic digestion turns a daily disposal problem into usable energy and fertiliser.",
    summary:
      "The cover story of Volume II, Issue 17 explains how kitchen waste can be converted to biogas through anaerobic digestion, what the resulting gas consists of, and why the process delivers both an energy output and a fertiliser output.",
    authorName: "Energy Konnect Editorial Desk",
    authorBio: "Cover story, Energy Konnect — Volume II, Issue 17 (July–August 2022).",
    category: "Bioenergy",
    topics: ["Bioenergy", "Renewable Energy", "Sustainability"],
    tags: ["Biogas", "Methane", "Kitchen Waste", "Fertiliser"],
    issueKey: "issue-2022-17",
    sectionLabel: "Cover Story",
    displayOrder: 1,
    publishedAt: "2022-07-05",
    featured: false,
    coverMedia: { fileName: "biogas.jpg", altText: "Biogas digester with organic feedstock" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. A resource in the waste stream" } },
      {
        type: "paragraph",
        data: {
          text: "Kitchen waste is generated continuously, is rich in organic matter and is usually treated purely as something to dispose of. Anaerobic digestion reframes it: the same material becomes feedstock for a process that yields a combustible gas and a nutrient rich residue.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. Anaerobic digestion" } },
      {
        type: "paragraph",
        data: {
          text: "Anaerobic digestion is the breakdown of organic material by micro organisms in the absence of oxygen. Carried out in a closed digester, the process stabilises the waste while releasing gas that can be collected and used.",
        },
      },
      {
        type: "image",
        data: {
          caption: "A small scale digester with segregated organic feedstock.",
          altText: "Biogas digester",
        },
      },
      { type: "heading", data: { level: 2, text: "3. What biogas contains" } },
      {
        type: "paragraph",
        data: {
          text: "The gas produced is principally methane together with carbon dioxide. Methane is the combustible fraction and therefore the source of the useful energy; the presence of carbon dioxide means raw biogas has a lower energy content per unit volume than pure methane.",
        },
      },
      {
        type: "list",
        data: {
          style: "unordered",
          items: [
            "Methane — the combustible component that carries the energy value",
            "Carbon dioxide — a significant non combustible fraction",
          ],
        },
      },
      { type: "heading", data: { level: 2, text: "4. Fertiliser as a second output" } },
      {
        type: "paragraph",
        data: {
          text: "Digestion does not consume the feedstock's nutrients. The residue left after digestion can be used as fertiliser, which means a single process addresses waste handling, energy supply and soil nutrition together.",
        },
      },
      {
        type: "callout",
        data: {
          title: "Two outputs, one process",
          text: "Biogas for energy and digested residue for use as fertiliser — the reason kitchen waste digestion is attractive at household and community scale.",
        },
      },
      { type: "heading", data: { level: 2, text: "5. Environmental benefits" } },
      {
        type: "paragraph",
        data: {
          text: "Diverting organic waste into a controlled digester reduces uncontrolled decomposition of that material and displaces some conventional fuel use. Set against the theme of the issue — energy as a step towards self reliance — small distributed digesters illustrate how local resources can meet local energy needs.",
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume II, Issue 17, July–August 2022 — Cover Story: Biogas From Kitchen Waste.",
            },
          ],
        },
      },
    ],
  },
  {
    slugSeed: "optimizing-the-generation-and-power-purchase-cost",
    title: "Optimizing the Generation and Power Purchase Cost",
    subtitle: "Where the cost of serving demand is actually decided.",
    summary:
      "An examination of how a utility's cost of supply is shaped by the way generation is scheduled and power is purchased, and why optimisation across a portfolio matters as much as the cost of any single station.",
    authorName: "Energy Konnect Editorial Desk",
    authorBio: "Energy Konnect — Volume 1, Issue 5 (September–October 2020).",
    category: "Energy Economics",
    topics: ["Energy Economics", "Electricity & Grid", "Thermal Power"],
    tags: ["Power Purchase", "Generation Cost", "Utility"],
    issueKey: "issue-2020-05",
    sectionLabel: "Power & Energy",
    displayOrder: 3,
    publishedAt: "2020-09-10",
    featured: false,
    coverMedia: { fileName: "dispatch.jpg", altText: "Grid dispatch control room" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. The cost of serving demand" } },
      {
        type: "paragraph",
        data: {
          text: "A distribution utility does not face a single price for electricity. It holds a portfolio of contracted generation and market options, each with its own cost characteristics, and it must meet a demand profile that changes through the day.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. Fixed and variable cost" } },
      {
        type: "paragraph",
        data: {
          text: "Because generation tariffs commonly separate a capacity component from an energy component, the decision of which station to schedule at a given hour turns largely on variable cost. Fixed obligations continue regardless, which is why portfolio composition and scheduling discipline both matter.",
        },
      },
      {
        type: "table",
        data: {
          caption: "Levers available to a utility",
          columns: ["Lever", "Effect on cost"],
          rows: [
            ["Scheduling by variable cost", "Reduces the energy cost of meeting a given demand"],
            ["Portfolio composition", "Determines the fixed obligations carried"],
            ["Demand forecasting accuracy", "Reduces costly last minute purchases"],
          ],
        },
      },
      { type: "heading", data: { level: 2, text: "3. Optimisation as a continuous exercise" } },
      {
        type: "paragraph",
        data: {
          text: "Optimisation is not a one time procurement decision. It is a continuous exercise in matching a changing demand profile against available resources at the least reasonable cost, with consequences that flow through to the retail tariff.",
        },
      },
      {
        type: "figure",
        data: {
          caption:
            "Figure 1 — Scheduling and dispatch decisions taken hour by hour shape the utility's cost of supply.",
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume 1, Issue 5, September–October 2020 — Optimizing the Generation and Power Purchase Cost.",
            },
          ],
        },
      },
    ],
  },
  {
    slugSeed: "commercial-coal-mining-in-india",
    title: "Commercial Coal Mining in India",
    subtitle: "Opening up the fuel side of the power sector.",
    summary:
      "A discussion of commercial coal mining in India and what wider participation in coal production implies for fuel availability and for generators that depend on domestic coal.",
    authorName: "Energy Konnect Editorial Desk",
    authorBio: "Energy Konnect — Volume 1, Issue 5 (September–October 2020).",
    category: "Coal",
    topics: ["Coal", "Energy Policy", "Thermal Power"],
    tags: ["Coal", "Mining", "Fuel Supply"],
    issueKey: "issue-2020-05",
    sectionLabel: "Power & Energy",
    displayOrder: 4,
    publishedAt: "2020-09-15",
    featured: false,
    coverMedia: { fileName: "coal-mining.jpg", altText: "Open cast coal mining operations" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. Fuel supply and generation" } },
      {
        type: "paragraph",
        data: {
          text: "For a coal based generator, fuel is the dominant variable cost and fuel security is a precondition for reliable operation. Any change in how coal is produced and made available therefore matters directly to the power sector.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. Widening participation" } },
      {
        type: "paragraph",
        data: {
          text: "Commercial coal mining broadens the set of entities that may produce and sell coal. The intent is greater availability of domestic coal and a more responsive supply side for consumers of coal, including thermal generating stations.",
        },
      },
      {
        type: "image",
        data: { caption: "Open cast coal mining operations.", altText: "Open cast coal mine" },
      },
      { type: "heading", data: { level: 2, text: "3. What generators watch" } },
      {
        type: "list",
        data: {
          style: "unordered",
          items: [
            "Availability and consistency of domestic coal supply",
            "Quality of coal received, which feeds directly into station heat rate performance",
            "Logistics and the delivered cost of fuel",
          ],
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume 1, Issue 5, September–October 2020 — Commercial Coal Mining in India.",
            },
          ],
        },
      },
    ],
  },
  {
    slugSeed: "retail-tariff-understanding-the-determination-process",
    title: "Retail Tariff — Understanding the Determination Process",
    subtitle:
      "How the price on a consumer's bill is arrived at, and where competition could enter.",
    summary:
      "An explanation of the retail tariff determination process — the costs a distribution licensee seeks to recover, the regulatory review those costs pass through, and the question of bringing competition into retail supply.",
    authorName: "Energy Konnect Editorial Desk",
    authorBio: "Energy Konnect — Volume 1, Issue 5 (September–October 2020).",
    category: "Energy Economics",
    topics: ["Energy Economics", "Energy Policy", "Electricity & Grid"],
    tags: ["Retail Tariff", "Regulation", "Distribution"],
    issueKey: "issue-2020-05",
    sectionLabel: "Tutorial",
    displayOrder: 5,
    publishedAt: "2020-09-20",
    featured: false,
    coverMedia: { fileName: "tariff.jpg", altText: "Electricity tariff documentation" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. What a retail tariff has to cover" } },
      {
        type: "paragraph",
        data: {
          text: "A distribution licensee's retail tariff is built up from the cost of purchasing power, the cost of operating and maintaining the distribution network, and the losses incurred in delivering energy to consumers.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. Regulatory review" } },
      {
        type: "paragraph",
        data: {
          text: "Those costs are not simply passed on. They are filed with and examined by the regulatory commission, which determines the tariff that may be charged to each consumer category. The process is deliberately public and evidentiary.",
        },
      },
      {
        type: "table",
        data: {
          caption: "Cost elements considered in retail tariff determination",
          columns: ["Element", "Nature"],
          rows: [
            ["Power purchase cost", "Largely pass through, subject to prudence review"],
            ["Network operation and maintenance", "Licensee's own cost"],
            ["Distribution losses", "Recognised against normative expectations"],
          ],
        },
      },
      { type: "heading", data: { level: 2, text: "3. Bringing in competition" } },
      {
        type: "paragraph",
        data: {
          text: "Where supply is provided by a single licensee in an area, price discipline depends on regulation. Introducing competition in retail supply is discussed as a way of giving consumers choice and creating pressure on service quality and cost alongside regulatory oversight.",
        },
      },
      {
        type: "quote",
        data: {
          text: "Tariff determination is where the technical and commercial performance of the whole chain becomes visible to the consumer.",
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume 1, Issue 5, September–October 2020 — Retail Tariff: Understanding the Determination Process & Bringing in Competition.",
            },
          ],
        },
      },
    ],
  },
  {
    slugSeed: "draft-electricity-rights-of-consumers-rules-2020",
    title: "Draft of Electricity (Rights of Consumers) Rules, 2020",
    subtitle: "Placing the consumer explicitly in the regulatory frame.",
    summary:
      "A consumer desk look at the draft Electricity (Rights of Consumers) Rules, 2020 and the significance of setting out consumer entitlements in relation to electricity supply as a distinct instrument.",
    authorName: "Energy Konnect Consumer Desk",
    authorBio: "Consumer Desk, Energy Konnect — Volume 1, Issue 5 (September–October 2020).",
    category: "Energy Policy",
    topics: ["Energy Policy", "Electricity & Grid"],
    tags: ["Consumer Rights", "Rules", "Distribution"],
    issueKey: "issue-2020-05",
    sectionLabel: "Consumer Desk",
    displayOrder: 6,
    publishedAt: "2020-09-25",
    featured: false,
    coverMedia: { fileName: "grid.jpg", altText: "Electricity distribution network" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. Why a separate instrument" } },
      {
        type: "paragraph",
        data: {
          text: "Much of electricity regulation addresses licensees, generators and the commission. A dedicated set of rules on the rights of consumers approaches the same system from the other direction: what a consumer is entitled to expect from supply.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. The consumer's vantage point" } },
      {
        type: "paragraph",
        data: {
          text: "For most consumers, the electricity system is experienced through connection, metering, billing and the handling of complaints. Framing entitlements around those touchpoints makes the system legible to the people it serves.",
        },
      },
      {
        type: "callout",
        data: {
          title: "Consumer Desk",
          text: "Energy Konnect has consistently treated the consumer as a stakeholder in the power sector rather than only an end point of supply.",
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume 1, Issue 5, September–October 2020 — Draft of Electricity (Rights of Consumers) Rules, 2020.",
            },
          ],
        },
      },
    ],
  },
  {
    slugSeed: "rooftop-solar-program-what-you-may-want-to-know",
    title: "Rooftop Solar Program — What You May Want to Know",
    subtitle: "A practical orientation for consumers considering a rooftop system.",
    summary:
      "A tutorial introduction to the rooftop solar programme: what participation involves for a consumer, how a system connects to the distribution network, and the questions worth asking before installation.",
    authorName: "Energy Konnect Editorial Desk",
    authorBio: "Tutorial, Energy Konnect — Volume II, Issue 17 (July–August 2022).",
    category: "Renewable Energy",
    topics: ["Solar Energy", "Renewable Energy", "Energy Efficiency"],
    tags: ["Rooftop Solar", "Solar", "Consumers"],
    issueKey: "issue-2022-17",
    sectionLabel: "Tutorial",
    displayOrder: 3,
    publishedAt: "2022-07-12",
    featured: false,
    coverMedia: { fileName: "rooftop-solar.jpg", altText: "Rooftop solar panels on a home" },
    blocks: [
      { type: "heading", data: { level: 2, text: "1. What the programme offers" } },
      {
        type: "paragraph",
        data: {
          text: "A rooftop solar programme is designed to make it straightforward for a consumer to install generation on their own premises and connect it to the distribution network, with defined procedures replacing case by case negotiation.",
        },
      },
      { type: "heading", data: { level: 2, text: "2. Before you install" } },
      {
        type: "list",
        data: {
          style: "ordered",
          items: [
            "Assess available shade free roof area and its orientation",
            "Understand the capacity permitted against your sanctioned load",
            "Confirm the approval and metering process with your distribution licensee",
            "Use empanelled or otherwise qualified installers and confirm warranties",
          ],
        },
      },
      { type: "heading", data: { level: 2, text: "3. After commissioning" } },
      {
        type: "paragraph",
        data: {
          text: "Once commissioned, the system runs largely unattended, but output depends on keeping modules clean and on periodic checks of the inverter and connections. Reading the bill carefully after the first settlement period is the simplest way to confirm the arrangement is working as expected.",
        },
      },
      {
        type: "reference",
        data: {
          items: [
            {
              label:
                "Energy Konnect, Volume II, Issue 17, July–August 2022 — Tutorial: Rooftop Solar Program.",
            },
          ],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed body
// ---------------------------------------------------------------------------

async function seedAccounts() {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const users = {};
  for (const account of ACCOUNTS) {
    users[account.role] = await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: { ...account, passwordHash, emailVerified: true },
    });
  }
  console.log(`  accounts ready (password for all: ${SEED_PASSWORD})`);
  return users;
}

async function seedCategories() {
  const bySlug = {};
  for (const category of CATEGORIES) {
    const slug = slugify(category.name);
    const row = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { ...category, slug },
    });
    bySlug[category.name] = row;
  }
  console.log(`  ${CATEGORIES.length} categories ready`);
  return bySlug;
}

async function seedTopics() {
  const byName = {};
  for (const topic of TOPICS) {
    const slug = slugify(topic.name);
    const row = await prisma.topic.upsert({
      where: { slug },
      update: {},
      create: { ...topic, slug },
    });
    byName[topic.name] = row;
  }
  console.log(`  ${TOPICS.length} topics ready`);
  return byName;
}

async function seedTags() {
  const names = [...new Set(ARTICLES.flatMap((article) => article.tags))];
  const byName = {};
  for (const name of names) {
    const slug = slugify(name);
    const row = await prisma.tag.upsert({
      where: { slug },
      update: {},
      create: { name, slug },
    });
    byName[name] = row;
  }
  console.log(`  ${names.length} tags ready`);
  return byName;
}

async function seedIssues() {
  const byKey = {};
  for (const issue of ISSUES) {
    const slug = slugify(`Volume ${issue.volumeNumber} Issue ${issue.issueNumber}`);
    const row = await prisma.magazine.upsert({
      where: {
        volumeNumber_issueNumber: {
          volumeNumber: issue.volumeNumber,
          issueNumber: issue.issueNumber,
        },
      },
      update: {},
      create: {
        slug,
        volumeNumber: issue.volumeNumber,
        issueNumber: issue.issueNumber,
        title: issue.title,
        period: issue.period,
        theme: issue.theme,
        description: issue.description,
        status: "PUBLISHED",
        publishedAt: new Date(`${issue.period.match(/\d{4}/)[0]}-01-01`),
      },
    });
    byKey[issue.key] = row;
  }
  console.log(`  ${ISSUES.length} magazines ready`);
  return byKey;
}

/**
 * Placeholder MediaAsset for a seeded cover/figure image. Real uploads land
 * through the storage adapter (Phase 5); this just gives the FK something
 * valid to point at so the client's <img> tags have a src.
 */
async function upsertPlaceholderMedia(uploaderId, { fileName }) {
  const storageKey = `seed/${fileName}`;
  const existing = await prisma.mediaAsset.findFirst({ where: { storageKey } });
  if (existing) return existing;
  return prisma.mediaAsset.create({
    data: {
      fileName,
      storageKey,
      url: `/seed-media/${fileName}`,
      mimeType: "image/jpeg",
      fileSize: 0,
      uploadedBy: uploaderId,
    },
  });
}

function buildSearchText({
  title,
  subtitle,
  summary,
  authorName,
  categoryName,
  topicNames,
  tagNames,
}) {
  return [title, subtitle, summary, authorName, categoryName, ...topicNames, ...tagNames]
    .filter(Boolean)
    .join(" — ");
}

async function seedArticles({ users, categories, topics, tags, issues }) {
  const publisher = users.PUBLISHER;

  for (const article of ARTICLES) {
    const existing = await prisma.article.findUnique({ where: { slug: article.slugSeed } });
    if (existing) {
      console.log(`  skip "${article.title}" (already seeded)`);
      continue;
    }

    const cover = await upsertPlaceholderMedia(publisher.id, article.coverMedia);
    const category = categories[article.category];
    const readingMinutes = estimateReadingMinutes(article.blocks);

    // Article + version 1 + blocks + taxonomy joins + review trail, all in one
    // transaction — matches the invariant every publish path in this codebase
    // follows: an article is never left pointing at a version that failed to
    // finish writing (IMPLEMENTATION_PLAN.md §6).
    await prisma.$transaction(async (tx) => {
      const createdArticle = await tx.article.create({
        data: {
          slug: article.slugSeed,
          title: article.title,
          subtitle: article.subtitle,
          summary: article.summary,
          authorName: article.authorName,
          authorBio: article.authorBio,
          categoryId: category?.id,
          publisherId: publisher.id,
          coverMediaId: cover.id,
          status: "PUBLISHED",
          isFeatured: article.featured,
          publishedAt: new Date(article.publishedAt),
          searchText: buildSearchText({
            title: article.title,
            subtitle: article.subtitle,
            summary: article.summary,
            authorName: article.authorName,
            categoryName: category?.name,
            topicNames: article.topics,
            tagNames: article.tags,
          }),
          topics: { create: article.topics.map((name) => ({ topicId: topics[name].id })) },
          tags: { create: article.tags.map((name) => ({ tagId: tags[name].id })) },
        },
      });

      const version = await tx.articleVersion.create({
        data: {
          articleId: createdArticle.id,
          versionNumber: 1,
          createdBy: publisher.id,
          status: "PUBLISHED",
          title: article.title,
          subtitle: article.subtitle,
          summary: article.summary,
          authorName: article.authorName,
          authorBio: article.authorBio,
          categoryId: category?.id,
          coverMediaId: cover.id,
          readingMinutes,
          submittedAt: new Date(article.publishedAt),
          approvedAt: new Date(article.publishedAt),
          blocks: {
            // image/figure blocks in the source content didn't carry a
            // mediaId (the mock just used a static import) — point them at
            // the article's own placeholder cover asset so the block is
            // valid against the canonical shape documented above.
            create: article.blocks.map((block, index) => ({
              blockOrder: index + 1,
              blockType: block.type,
              content:
                (block.type === "image" || block.type === "figure") && !block.data.mediaId
                  ? { ...block.data, mediaId: cover.id }
                  : block.data,
            })),
          },
        },
      });

      await tx.article.update({
        where: { id: createdArticle.id },
        data: { currentPublishedVersionId: version.id },
      });

      await tx.articleReviewAction.createMany({
        data: [
          {
            articleId: createdArticle.id,
            articleVersionId: version.id,
            actorId: publisher.id,
            action: "SUBMITTED",
          },
          {
            articleId: createdArticle.id,
            articleVersionId: version.id,
            actorId: users.ADMIN.id,
            action: "APPROVED",
          },
        ],
      });

      const issue = issues[article.issueKey];
      if (issue) {
        await tx.magazineArticle.create({
          data: {
            magazineId: issue.id,
            articleId: createdArticle.id,
            sectionLabel: article.sectionLabel,
            displayOrder: article.displayOrder,
          },
        });
      }
    });

    console.log(`  seeded "${article.title}" (${readingMinutes} min read)`);
  }
}

async function main() {
  console.log("Seeding Energy Konnect database...\n");

  console.log("Accounts:");
  const users = await seedAccounts();

  console.log("Taxonomy:");
  const categories = await seedCategories();
  const topics = await seedTopics();
  const tags = await seedTags();

  console.log("Magazines:");
  const issues = await seedIssues();

  console.log("Articles:");
  await seedArticles({ users, categories, topics, tags, issues });

  console.log("\nSeed complete.");
  console.log("Sign in as:");
  for (const account of ACCOUNTS) {
    console.log(`  ${account.role.padEnd(10)} ${account.email} / ${SEED_PASSWORD}`);
  }
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
