# GetYourGuide widget validation — 2026-07-21

## Outcome

The local integration is ready for publication review. It is limited to the four booking-intent guides, uses three specific activities per guide, preserves the existing CTA fallback, and does not put GetYourGuide on the initial page load.

## Performance design

- The small local bootstrap loads only after the existing analytics consent is granted.
- The GetYourGuide controller loads its third-party script only when the commercial conclusion is near the viewport.
- Visitors who decline consent retain the editorial site and existing booking CTA without the live cards.
- The widget reserves responsive height before the iframe appears to protect layout stability.
- Informational routes never create a widget or load the GetYourGuide third-party script.

## Visual and functional checks

- Desktop: tested at a 740 px viewport; three readable columns with images, title, rating, duration, and fallback CTA.
- Mobile: tested at 375 px; one readable stacked column with no horizontal overflow.
- Additional widths: 640 px, 560 px, and 375 px confirmed responsive reserved space close to the rendered iframe height.
- Direct load, client-side navigation, consent acceptance, consent denial, delayed loading, inaccessible third party, correct activity IDs, accessible region names, and one-widget-only behavior were checked.

## Lighthouse evidence

The complete automatic matrix contains 84 raw reports: 14 public routes × mobile/desktop × three cold repetitions. Desktop was consistently at or near 100. Mobile cold runs varied across every kind of route, including 404, About, Weather, and Privacy pages where the widget is never created. This identifies test-host CPU variation rather than a widget-only regression; CLS remained zero throughout.

After optimizing the consent bootstrap, the representative commercial route was rerun in isolation with three cold repetitions per profile:

| Profile | Performance runs | Median | Accessibility | Best practices | SEO | CLS |
|---|---:|---:|---:|---:|---:|---:|
| Desktop | 100 / 100 / 100 | 100 | 100 | 100 | 100 | 0 |
| Mobile | 95 / 100 / 100 | 100 | 100 | 100 | 100 | 0 |

Evidence:

- Complete route matrix: `work/lighthouse-isolated-2026-07-21/`
- Post-optimization commercial gate: `work/lighthouse-widget-bootstrap-2026-07-21/`

The raw Lighthouse directories are retained in the local workspace and excluded from Git because they total about 100 MB. This report, the reproducible audit scripts, and the pinned audit dependencies are included in the repository.

## Publication gate

No public deployment was authorized or performed. Production PageSpeed cannot be honestly certified from localhost; after publication, rerun PageSpeed Insights against the live canonical URLs and investigate any repeatable mobile regression before considering the gate complete.
