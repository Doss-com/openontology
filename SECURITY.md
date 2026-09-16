# Security policy

## Supported versions

Security fixes target the latest developer alpha. Older prereleases may require
upgrading and rebuilding their Onts.

## Report a vulnerability

Use a private GitHub security advisory:

https://github.com/Doss-com/openontology/security/advisories/new

Do not open a public issue for a suspected vulnerability. Include the affected
version, impact, reproduction, and any known mitigation. Do not include real
credentials or customer data.

We will acknowledge a report within five business days. Alpha fixes may require
a new prerelease and an artifact rebuild rather than an in-place migration.

## Security model

OpenOntology treats source bytes, credentials, branch refs, and exact Evidence
as security-sensitive. Backend URIs reject embedded credentials. Query-time
References are request-local. A Resolver proposal cannot admit itself as truth.

The alpha does not provide hosted tenancy, account isolation, managed IAM,
quotas, or a public ingestion endpoint.
