# Sail Halong live status

- Active plan: `work/plans/2026-07-21-getyourguide-widget.md`
- State: local implementation and pre-publication validation complete
- Current result: four commercial guides now use three context-matched activities each. The third-party widget is consent-gated and proximity-loaded; desktop/mobile visual checks passed. The representative post-optimization Lighthouse gate passed at a 100 performance median on both profiles with zero CLS.
- GitHub publication: commit `a66a9e1` pushed to `codex/getyourguide-widgets`; draft PR #10 targets `main`.
- Production: not merged or deployed.
- Warning: the complete cold-run matrix showed mobile CPU variability across commercial and non-commercial routes alike. Public PageSpeed must be rerun after deployment before declaring the production score preserved.
- Next owner decision: review and merge PR #10 when ready; then run the required public PageSpeed follow-up after deployment.
