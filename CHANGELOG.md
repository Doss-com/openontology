# Changelog

## Unreleased

- Make repeated concept names browsable through bounded metadata pages while
  preserving distinct identities, exact reads and explicit factual verification.
- Expose explicitly configured construction clients through the existing MCP
  `search` and `read` tools. Ordinary schemas and the default `verify` remain
  unchanged; no review or signing tool is added.
- Add a bounded full-source construction review session with complete per-item
  decisions and exact quotation checks. Results remain unsigned and cannot
  grant Admission; independent semantic judgment remains external.
- Add a bounded construction profile for source-grounded concept ObjectDefs,
  scoped aliases and `mentions` / `defines` Claims. Independently signed
  Admission, correction and cold eligibility feed metadata-only `search` and
  exact passage `read` through `oont/kernel`. Navigation never supplies factual
  proof or implicitly chooses the subject of `verify`. Include a runnable
  synthetic concept-map example; semantic-review quality remains unqualified.
- Require ordinary ObjectOnt ref publication to preserve the accepted head in
  candidate ancestry. Reject backward or unrelated source and knowledge writes,
  preserve concurrent-write conflicts, and keep historical snapshots readable.
  Direct-storage rewrites and restored-backup detection remain unqualified.
- Bind quoted declared titles through the complete scoped native identity map.
  Preserve exact Evidence, counterevidence, historical selection and Admission
  reuse; refuse unknown or ambiguous names and conflicting identity qualifiers.
- Add explicit retrospective point-in-time `at` queries across SDK, CLI, and
  MCP. Bind selection, exact Evidence, semantic counterevidence, and Admission
  reuse to one requested time and complete source cut. Preserve current and
  immediate-successor behavior.
- Bind native semantic Admission and cold reuse to the complete authority
  projection reconstructed from the selected source field. Reject signed
  reduced censuses and semantic drift without suppressing ordinary verification.
- Enforce the native minimum proof profile at durable write and cold reuse.
  Required exact support cannot replace or link only to an optional answer;
  compatible stronger contracts and renamed obligation IDs remain supported.
- Require counterevidence relation targets to satisfy all required support
  modality and polarity constraints for their family, independent of obligation
  order. Preserve the complete authoritative item and relation censuses.
- Add stable source resource binding and validated ref-bound replay checkpoints
  to the kernel. Ordinary product opening uses valid checkpoints and falls back
  to full replay when a checkpoint is absent.

## 0.3.0-alpha.3

### Changed

- Made strict TypeScript the canonical source while preserving dependency-free
  ESM output and validated current-field and successor behavior.
- Added declarations, declaration maps, source maps, and a clean-consumer type
  compilation gate to the release package.
- Added the bounded `oont/kernel` extension Interface for managed and research
  runtimes without expanding the ordinary SDK surface.
- Added typed public result states, exact Verification Evidence types, and
  identity diagnostics on Verification results.
- Refuse historical, dated, change, and ordered-time wording unless the caller
  declares a supported intent. This prevents a temporal question from silently
  receiving the current value.
- Corrected the installed-package quickstart and public TypeScript names after
  an independent context-blind package evaluation.
- Added `oont --version` and made the GitHub release workflow derive its title
  and notes file from the immutable tag.

## 0.3.0-alpha.2

First public developer alpha. Earlier prereleases were internal development
candidates and are not supported.

### Added

- One public JavaScript client with `verify`, `search`, `read`, and `status`.
- CLI operations `verify`, `search`, `check`, `status`, and `serve`.
- Default one-tool MCP profile exposing `verify` and an advanced profile
  exposing `search` and `read`.
- Source-native Ont construction from deterministic Adapter input.
- Exact Evidence reads, identity and chronology verification, typed refusals,
  and proof-closure receipts.
- Local canonical storage and a generation-bound GCS Adapter.
- Explicit public package exports, focused release gates, and a synthetic
  quickstart.
- A zero-dependency runtime package containing only modules reachable from the
  public SDK and CLI.

### Changed

- Split artifact persistence, query planning, Exact Evidence inspection, and
  the read-only query runtime into focused modules.
- Public query calls reject control-plane options and expose only state that the
  public runtime owns.
- Expanded the deterministic BM25 implementation into ordinary maintainable
  source without changing its ranking behavior.
- Source-native maps require the current alpha shape. Older alpha artifacts
  must be rebuilt from Adapter input.
- Current-field and chronology resolution now have a focused default test gate
  instead of sharing an excluded research suite with retired Resolver code.
- Object-native storage now depends on a compact stable assertion envelope;
  classic private assertion helpers no longer ship in the public package.

### Removed

- Operator learning modules and their tests from the public source and package.
  Signed Episode capture and SearchPolicy work continue in the private research
  tree until the operator API is ready.
- Disabled learning telemetry, recovery-faculty state, and experimental `Beam`
  names from the public contract.
- The dormant general evidence-neighborhood Resolver and its retired direct-map
  bridge. Neither was reachable from the public product.
- The private research compiler, classic server, customer-specific skills, and
  experimental eval utilities from the public package boundary.
- Unused Beam product-family dispatch from source-native proposal capture and
  search-policy activation.

### Alpha limitations

- Automatic production connectors and a managed hosted service do not ship.
- Persisted alpha artifacts must be rebuilt from Adapter input after an
  incompatible upgrade.
- S3-compatible storage remains experimental.
- Managed Turbopuffer projection, tenancy, IAM automation, lifecycle policy,
  and garbage collection are future work.
