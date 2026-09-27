/** Public, dependency-free shapes for native object discovery. */

export interface SourceNativeObjectDiscoveryScope {
  sourceSystem: string;
  objectType?: string;
  externalId?: string;
}

export interface SourceNativeObjectDiscoveryInput {
  browse: 'objects';
  scope?: SourceNativeObjectDiscoveryScope;
  limit?: number;
  cursor?: string;
}

export interface SourceNativeObjectDiscoveryIdentity {
  home: 'ObjectDef/InstanceRef';
  sourceSystem: string;
  objectType: string;
  externalId: string;
  namespace?: string;
}

export interface SourceNativeObjectDiscoveryObject {
  objectIdentity: SourceNativeObjectDiscoveryIdentity;
  objectIdentitySha256: string;
  fields: string[];
}

export interface SourceNativeObjectDiscoverySourceBinding {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeObjectDiscoverySourceBindingV1';
  ontId: string;
  branch: string;
  namespace: string;
  artifactSha256: string;
  sourceCommitSha256: string;
  sourceReplaySha256: string;
  sourceCatalogSha256: string;
  nativeObjectMapSha256: string;
}

export interface SourceNativeObjectDiscoveryCoverage {
  sourceCount: number;
  mappedSourceCount: number;
  unsupportedSourceCount: number;
  parseFailureCount: number;
  complete: boolean;
}

export interface SourceNativeObjectDiscoveryResult {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeObjectDiscoveryResultV1';
  browse: 'objects';
  scope: SourceNativeObjectDiscoveryScope | null;
  objects: readonly SourceNativeObjectDiscoveryObject[];
  totalObjects: number;
  returnedObjects: number;
  nextCursor: string | null;
  sourceBinding: SourceNativeObjectDiscoverySourceBinding;
  coverage: SourceNativeObjectDiscoveryCoverage;
  freshness: 'unknown';
  navigationOnly: true;
  absenceProven: false;
  exactSourcesRemainAuthority: true;
  canonicalTruthMutation: false;
  resultSha256: string;
}
