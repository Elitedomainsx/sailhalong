# GetYourGuide activity widget integration

- Status: completed locally; publication and public PageSpeed follow-up pending owner authorization
- Approval date: 2026-07-21
- Owner approval: "Integralo entonces donde corresponda, pero ten cuidado de no romper nuestro 100% de light house en ordenador y movil, y el 100% de page speed, también fíjate que se vea bien en ordenador y mobile"

## Objective and success criteria

Add the owner-provided three-item GetYourGuide activity widget to the commercial conclusions where it is relevant, without weakening the existing editorial CTA path or degrading the site's current Lighthouse/PageSpeed quality.

Success means:

- the widget appears at the end of the four booking-intent guides;
- the early editorial CTA remains unchanged;
- the existing end CTA remains available as an accessible fallback;
- third-party widget code loads only when a visitor approaches the commercial conclusion;
- desktop and mobile layouts are readable and stable;
- all public routes pass the existing functional checks and the Lighthouse mobile/desktop gate;
- nothing is deployed without separate publication authority.

## Frozen invariants and non-goals

- Preserve the current editorial copy, affiliate disclosure, GetYourGuide partner id, canonical URLs, GA4 consent flow, and existing outbound-click measurement.
- Do not add the widget to weather, general-worth, Home, Guides, Blog, About, Privacy, or error pages.
- Do not remove current affiliate links or make product-specific editorial endorsements.
- Do not publish, push, or modify production in this step.
- Do not load the GetYourGuide third-party script above the fold.

## Implementation

- Use one shared, deterministic enhancement across the exported site so direct loads and client navigation behave consistently.
- Target only end-position affiliate CTA blocks on:
  - `best-halong-bay-cruises`
  - `halong-bay-cruises`
  - `halong-bay-day-trips-from-hanoi`
  - `halong-bay-overnight-cruises`
- Use English, three items, and partner `X3LLOUG`, but select specific activity URLs for each guide instead of using the broad `ha long bay` query.
- Choose activities by page relevance, rating strength, review volume, clear format, imagery, cancellation/booking clarity, and commercial value; do not optimize for ticket price alone.
- Preserve the current end CTA as the fallback and secondary “all options” route.
- Use intersection-based loading, a reserved responsive container, and one script instance per page.
- Keep integration ownership with one implementer because the site is a compiled static export and the canonical change is shared.

## Validation and failure handling

- Confirm exact targeting and one widget per eligible page.
- Test with JavaScript enabled, delayed, and unavailable.
- Inspect 740 px desktop-content width and 375 px mobile width after scrolling the widget into view.
- Check links, accessible names, overflow, reserved space, and layout shift.
- Run Lighthouse against every exported public route in mobile and desktop profiles, preserving raw results and summaries.
- If the widget itself prevents a clean local or public performance gate, keep the fallback CTA and do not publish the widget until the loading strategy is revised.

## Assumptions and owner decisions

- The four commercial guides are the approved meaning of “donde corresponda,” consistent with the immediately preceding recommendation.
- The supplied GetYourGuide partner id and loader are authoritative.
- Maintaining performance takes priority over eager widget rendering.

## Amendment — 2026-07-21

- Status: approved
- Owner approval: "dale perfecto"
- Decision: replace the broad automatic search widget with three specific, context-matched activity URLs per commercial guide. The selection will balance likely conversion and booking value rather than choosing only the highest-priced products.

## Completion record — 2026-07-21

- Added three specific GetYourGuide activities to each of the four approved commercial conclusions.
- Kept the existing early and end CTAs as the editorial and no-consent fallbacks.
- Delayed the local controller until analytics consent and delayed the GetYourGuide third-party loader until the widget approaches the viewport.
- Verified the rendered widget at desktop and mobile widths, including direct loads, client navigation, consent denial, overflow, accessible names, and reserved space.
- Completed the 14-route, mobile/desktop Lighthouse evidence matrix. The post-optimization isolated commercial-page gate passed at a 100 mobile median and 100 desktop median with zero CLS. The larger cold-run matrix showed system-wide mobile CPU variance on routes where the widget cannot load, so a public PageSpeed follow-up remains mandatory after an authorized deployment.
- No deployment, push, or production change was made.
