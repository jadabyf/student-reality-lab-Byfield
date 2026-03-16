# Housing Affordability for Young Adults

## Essential Question

Can a young adult working full-time afford rent in major U.S. cities today?

## Claim (Hypothesis)

In many major U.S. cities, rent has increased faster than income, making housing less affordable for young adults.

## Explicit Claim

Rent is taking a growing share of income in many U.S. cities, pushing more young adults above the 30% affordability stress threshold.

## Audience

This project is designed for college students and recent graduates who are trying to understand what housing affordability looks like in different U.S. cities and how realistic it is to rent on an early-career income.

## STAR Draft

### S — Situation

Housing affordability is a major issue for young adults today because rent prices have risen quickly while entry-level wages and early-career incomes have not always kept pace. As students graduate and begin working full-time, many face difficult decisions about where they can afford to live.

### T — Task

This project answers the question of whether a full-time young adult worker can afford rent in major U.S. cities. Viewers should learn how rent and income compare across cities and over time, and how often rent crosses standard affordability guidelines.

### A — Action

The project will build an interactive data visualization that compares rent and income across cities, allowing users to explore trends and identify where housing is becoming less affordable.

### R — Result

The expected result is that in many cities, rent exceeds the recommended affordability threshold of 30% of income, showing a growing affordability gap for young adults.

## Dataset & Provenance

This project uses two datasets located in the `/datasets` folder:

1. **Rental data** from Zillow Observed Rent Index (ZORI)  
   Source: [https://www.zillow.com/research/data/](https://www.zillow.com/research/data/)
2. **Income data** from the American Community Survey (ACS S1903 Median Income)  
   Source: [https://data.census.gov/](https://data.census.gov/)

These sources were selected because they are widely used, publicly available, and provide city-level information that can be combined for affordability analysis.

## Data Dictionary

| Column | Meaning | Units |
| --- | --- | --- |
| `city` | Name of the U.S. city in the dataset. | Text (city name) |
| `year` | Calendar year of the observation. | Year (YYYY) |
| `monthly_rent` | Typical monthly rent value for the city (from ZORI-based rental data). | U.S. dollars per month (USD) |
| `median_income` | Median annual household income for the city (from ACS S1903 data). | U.S. dollars per year (USD) |
| `rent_burden` | Share of income spent on rent, calculated as monthly rent relative to monthly income. | Percent (%) |

## Data Viability Audit

### Missing values or unusual fields

The datasets may contain missing values, blanks, or inconsistent formatting (such as currency symbols, commas, or mixed city naming conventions).

### Cleaning plan

The data will be cleaned by removing incomplete rows, converting numeric fields to consistent number formats, and standardizing city names so rental and income records can be matched accurately.

### Dataset limitations

This dataset cannot prove individual personal living situations, roommate arrangements, debt levels, or city-specific cost-of-living differences beyond rent. It also does not capture every factor that affects affordability, such as transportation, healthcare, or local taxes.

## Cleaning & Transform Notes

### Columns kept

For the processed dataset, the project keeps only the fields needed for the story and visualization:

- `city`
- `year`
- `monthly_rent`
- `median_income`
- `rent_burden`

### Missing values handling

Rows with missing or non-numeric rent or income values are removed during cleaning. This keeps the processed dataset focused on valid city-year records that can be compared fairly.

### Rent burden calculation

`rent_burden` is calculated with the formula:

`rent_burden = (monthly_rent * 12) / median_income`

This converts monthly rent to annual rent and compares it to annual median income.

## Method Snapshot

Rent burden is calculated by comparing annualized rent to annual income for each city-year record.
This project combines Zillow ZORI rent data with U.S. Census ACS income data to estimate how much income rent consumes in each city.
The 30% threshold is used as a standard affordability stress benchmark.

## Definitions

### What is rent burden?

Rent burden is the share of income spent on housing rent. It is used to show how financially difficult rent is for someone living in a given city.

### Why is 30% the affordability threshold?

The 30% rule is a common housing guideline: if rent is more than 30% of income, housing is generally considered less affordable and may leave less money for other essentials like food, transportation, and savings.

## Draft Chart Explanation

One proposed chart is a **multi-line trend chart** that compares average monthly rent and estimated affordable rent (based on median income) over time for each city.

- It directly shows whether rent is rising faster than income by visualizing both trends on the same timeline.
- It helps answer the research question by making it easy to see when cities cross the 30% affordability threshold and how that changes over time.

## Interaction Design

The Phase 3 prototype uses a **year dropdown** as its one core interaction. When the user selects a different year, the bar chart updates to show rent burden by city for that specific year. This makes the interaction analytical, not decorative, because it directly changes the evidence shown in the chart.

This interaction helps answer the essential question by allowing viewers to test how affordability pressure shifts over time. Instead of seeing only one static snapshot, users can compare years and observe whether high-burden cities remain above the 30% affordability threshold or whether the burden grows. The chart also includes a data-tied annotation that highlights the highest-burden city in the selected year, so users immediately see the most extreme affordability case in each view.

## Limits & What I'd Do Next

- Dataset limitation: The analysis uses city-level aggregates, so it cannot capture neighborhood-level variation in rent pressure within the same city.
- Visualization limitation: The current views focus on rent burden percentages and do not yet let users segment results by student-relevant factors like occupation or age band.
- Improvement with more time: I would add a city drill-down panel that compares trend, top burden years, and benchmark crossings for one selected city.
- Additional dataset to add: Entry-level salary data by metro and occupation (for example, BLS occupation wage data) would better reflect what recent graduates actually earn.

## Key Result Framing

The strongest result is not just the highest-burden city in one year. The key pattern is that many tracked cities remain above the 30% benchmark across years, showing sustained affordability pressure rather than a one-year anomaly.

## Project MCP Server

This project now includes a project-scoped MCP server that exposes the affordability tools directly from the repo.

- Start it with `npm run mcp:affordability`
- Server entrypoint: `mcp/affordability-server.mjs`
- Backing logic: `src/lib/affordabilityTools.js`
- Workspace MCP config: `.vscode/mcp.json` at the repo root runs the nested package server through the workspace script

Exposed MCP tools:

- `list_dataset_cities`
- `check_city_exists`
- `explain_dataset`
- `explain_affordability_model`
- `get_city_affordability`
- `calculate_rent_burden`
- `compare_cities`
- `rent_stress_trend`
- `post_grad_survival_score`
- `find_affordable_cities`
- `budget_leftover`

The website chatbot still cannot call stdio MCP directly from the browser. To bridge that gap, the project now exposes a lightweight same-origin HTTP layer at `/api/affordability/*` inside the Vite server.

- `POST /api/affordability/chat` routes a plain-English chat message through the project tool/router layer
- `POST /api/affordability/tool` invokes a named affordability tool over HTTP with JSON input
- `GET /api/affordability/health` confirms the bridge is available and lists the exposed tool names

That means the browser UI now talks to a project HTTP bridge first, while the MCP server and the HTTP bridge both stay aligned by reusing the same underlying affordability logic.

## GitHub Pages Deployment

This project can be deployed as a static site on GitHub Pages.

Important setup in repository settings:

- Set Pages Source to GitHub Actions.
- Do not use Deploy from a branch for this repo, because source files are Vite input files and will render as broken/raw HTML without the build output.

### Why this works

- `build:pages` uses a GitHub Pages base path for assets.
- Build scripts copy local dataset files into `dist/datasets` so the chatbot can still load affordability data when hosted statically.
- The browser attempts the HTTP bridge first, then gracefully falls back to local dataset routing when `/api/affordability/*` is unavailable on Pages.

### Commands

1. Install dependencies:

   `npm install`

2. Build for GitHub Pages:

   `npm run build:pages`

3. Deploy:

   `npm run deploy`

### Recommended CI deployment

This repo includes [.github/workflows/pages.yml](.github/workflows/pages.yml), which builds and deploys `dist` automatically on push to `main`.

If you use the workflow, manual `npm run deploy` is optional.

### Package scripts involved

- `build:pages`: runs a production build in `github-pages` mode and copies datasets into `dist`.
- `predeploy`: runs `build:pages` and writes `dist/.nojekyll`.
- `deploy`: publishes `dist` to the `gh-pages` branch.
