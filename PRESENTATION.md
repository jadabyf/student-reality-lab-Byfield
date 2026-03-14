# Housing Affordability Story Presentation (STAR)

## S - Situation (20-30 seconds)

I investigated a student-centered housing question: can young adults realistically afford rent in major U.S. cities using early-career income? The public conversation often says rent is "high," but students need clearer evidence for planning where to move, work, and budget after graduation.

Core claim: rent is taking a growing share of income in many U.S. cities, pushing more young adults above the 30% affordability stress threshold.

## T - Task (10-15 seconds)

My task was to turn raw rent and income data into a clear, interactive story with evidence, trend context, and a practical takeaway. The story had to stay focused, not become a dashboard.

## A - Action (60-90 seconds)

I combined Zillow ZORI rent data with U.S. Census ACS income data and transformed both into a shared city-year structure in `datasets/processed.json`. I used rent burden as the main metric: annualized rent divided by annual income, shown as a percentage.

Method note: the 30% line is a standard affordability stress benchmark, used to compare how many cities are under or over pressure in each year.

The first view is a ranked horizontal bar chart for a selected year. It answers, "Where is pressure highest right now?" I kept a visible 30% benchmark line because that threshold is a common affordability standard. Users can move across years with Prev/Next, a dropdown, and a Latest shortcut to compare snapshots over time.

To avoid a one-year-only interpretation, I added a second view: a trend chart showing the share of tracked cities above the 30% line each year. This counterpoint shifts the narrative from one-year rankings to whether affordability stress is broadening or easing over time.

I also added supporting narrative blocks: context for students, guidance on how to read each view, and dynamic annotations that update with interaction so users understand what changed and why it matters.

## R - Result (60-90 seconds)

The final product is a two-view data story with a clear narrative arc: context, evidence, trend counterpoint, and takeaway. The headline numbers users see are: the top-burden city in the selected year, how far it sits above the 30% benchmark, and the percentage of cities above that threshold over time.

Interaction materially changes interpretation. In the ranked view, users identify immediate high-pressure markets. In the trend view, they see whether that pressure is isolated or persistent across years. Together, those views support a stronger student planning takeaway than either chart alone.

One limitation is scope: the analysis uses city-level averages and does not capture neighborhood variation, roommate arrangements, or individual living situations. The measure is strongest for broad patterns, not exact personal affordability. A next step would be adding local distribution detail or entry-level salary segmentation by occupation.
