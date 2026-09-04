# Contributor instructions

OpenOntology separates navigation from proof. Preserve that distinction in
code, tests, and documentation.

- Read `GLOSSARY.md` and `docs/ARCHITECTURE.md` before changing domain names.
- Run `npm test` after product changes and `npm run release:check` before handoff.
- Keep the public query Interface to `verify`, `search`, `read`, `check`, and
  `status`.
- Resolver output is navigation. Only exact authorized Corpus bytes can be
  Evidence.
- Prefer a small deep Module over pass-through wrappers.
- Add an Adapter seam only when two implementations actually vary.
- Do not add research traces, generated evaluation results, private paths,
  customer names, credentials, or source data.
- Do not present a proposed or unverified mechanism as shipped behavior.
