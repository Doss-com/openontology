/** Bounded extension Interface for managed and research runtimes. */
export { createSourceNativeProductMcpHandler } from './source-native-product-mcp.mjs';
export type { ProductTransport } from './source-native-product-mcp.mjs';
export {
  buildSourceNativeProduct,
  openSourceNativeProductRuntime,
  SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE,
} from './source-native-product.mjs';
export type {
  ProductSearchInput,
  SourceNativeExactEvidenceSession,
  SourceNativeProductLifecycleAdapter,
  SourceNativeProductLifecycleAdapterFactory,
  SourceNativeProductPreparedSearch,
  SourceNativeProductQueryPlan,
  SourceNativeProductResolution,
  SourceNativeProductRuntimeContext,
  SourceNativeProductState,
  SourceNativeObjectIdentityAbsenceReceipt,
} from './source-native-product.mjs';
export {
  bindSourceNativeProductResource,
  createSourceNativeProductResource,
  openExactProductArtifactState,
  openProductState,
  productSources,
  readSourceNativeProductArtifactDescriptor,
  SOURCE_NATIVE_PRODUCT_RESOURCE_FILE,
  validateSourceNativeProductResource,
} from './source-native-artifact.mjs';
export type {
  Descriptor,
  ObjectOnt,
  ProductOptions,
  ProductSource,
  Resource,
  SourceNativeProductResourceBindingReceipt,
  SourceNativeProductResourceReceipt,
} from './source-native-artifact.mjs';
export {
  openSourceNativeExactEvidenceSession,
} from './source-native-evidence-session.mjs';
export {
  compileSourceNativeCurrentFieldChronologyVerification,
} from './source-native-current-field-verification.mjs';
export type {
  SourceNativeCurrentFieldChronologyVerification,
  SourceNativeCurrentFieldProofDisposition,
} from './source-native-current-field-verification.mjs';
export type {
  BoundObjectOnt,
  ExactSessionOptions,
  ExactSessionSource,
  ExactSourceAvailabilitySnapshot,
  SearchRequest,
  SeedRequest,
  SourceHandle,
} from './source-native-evidence-session.mjs';
export {
  objectBytesSha256,
  openObjectOntStore,
  stableObjectSha256,
  stableObjectText,
} from './object-ont-store.mjs';
export type {
  ObjectOntStore,
  ReplayGraph,
  ReplayMetadataGraph,
  ReplayIndexCheckpoint,
  ReplayIndexCheckpointRead,
  ReplayIndexCheckpointReceipt,
  ReplayMetadataCheckpointSnapshot,
  ReplayMetadataCheckpointWriteResult,
  ReplayMetadataSnapshot,
} from './object-ont-store.mjs';
export {
  compileProofAuthorityProjection,
  proofAuthorityForProjection,
  validateProofAuthorityProjection,
} from './proof-authority-projection.mjs';
export type {
  CompileProofAuthorityProjectionInput,
  ProofAuthorityItem,
  ProofAuthorityProjection,
  ProofAuthorityRelation,
  ProofEvidenceReference,
  SourceProjectionAuthority,
} from './proof-authority-projection.mjs';
export {
  compileProofSufficiencyContract,
  validateProofSufficiencyContract,
} from './proof-sufficiency-contract.mjs';
export type {
  CompileProofSufficiencyContractInput,
  ProofObligationRole,
  ProofRelationDirection,
  ProofSufficiencyContract,
  ProofSufficiencyObligation,
} from './proof-sufficiency-contract.mjs';
export {
  evaluateProjectionRelationCensus,
  evaluateProofSufficiencyContract,
} from './proof-sufficiency-evaluator.mjs';
export type {
  EvaluateProjectionRelationCensusInput,
  EvaluateProofSufficiencyContractInput,
  ProjectionRelationCensusEvaluation,
  ProofObligationEvaluation,
  ProofProposition,
  ProofRelation,
  ProofRelationView,
  ProofSufficiencyEvaluation,
} from './proof-sufficiency-evaluator.mjs';
export {
  compileSourceNativeProofAuthorityProjection,
} from './source-native-semantic-projection.mjs';
export type {
  CompileSourceNativeProofAuthorityProjectionInput,
} from './source-native-semantic-projection.mjs';
export type {
  SourceNativeCanonicalRole,
  SourceNativeCanonicalPropositionV2,
  SourceNativePropositionModality,
  SourceNativePropositionPolarity,
  SourceNativePropositionRelationType,
  SourceNativePropositionRelationV1,
} from './source-native-object-map.mjs';
export {
  openSourceNativeObjectOntIndex,
  openSourceNativeObjectOntRefIndex,
} from './source-native-object-ont.mjs';
export type {
  OpenSourceNativeObjectOntOptions,
  SourceNativeObjectOntIndex,
  SourceNativeObjectOntRefIndex,
} from './source-native-object-ont.mjs';
export {
  compileSourceNativeAdmittedKnowledgeBundle,
  compileSourceNativeAdmissionRecord,
  compileSourceNativeSemanticKnowledgeBundle,
  openSourceNativeProductWithAdmittedKnowledge,
  sourceNativeAdmissionStatement,
  sourceNativeProposalStatement,
  validateSourceNativeAdmittedKnowledgeBundle,
  writeSourceNativeAdmittedKnowledge,
} from './source-native-admitted-knowledge.mjs';
export type {
  CompileSourceNativeAdmittedKnowledgeBundleInput,
  SourceNativeAdmittedAnchorContext,
  SourceNativeAdmittedKnowledgeBundle,
  SourceNativeAdmittedKnowledgeContext,
  SourceNativeAdmittedKnowledgeEvidence,
  SourceNativeAdmittedKnowledgeLedgerStatus,
  SourceNativeAdmittedKnowledgePolicy,
  SourceNativeAdmittedKnowledgeQueryBinding,
  SourceNativeAdmittedKnowledgeProduct,
  SourceNativeAdmittedKnowledgeStatus,
  SourceNativeAdmittedKnowledgeVerification,
  SourceNativeAdmittedKnowledgeVerificationResult,
  SourceNativeAdmittedKnowledgeWriteResult,
  SourceNativeAdmittedProofBinding,
  SourceNativeAdmittedProofContext,
  SourceNativeAdmittedQueryAnchorBinding,
  SourceNativeAdmissionRecord,
  SourceNativeAdmissionStatement,
  SourceNativeAdmissionTrustEntry,
  SourceNativeAdmissionTrustRole,
  SourceNativeProposalStatement,
} from './source-native-admitted-knowledge.mjs';
