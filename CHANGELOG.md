# Changelog

## Unreleased

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
- A source-native outcome-authority seam independent of the private Beam
  curriculum and training stack.

### Removed

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
