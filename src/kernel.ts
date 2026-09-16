/** Bounded extension Interface for managed and research runtimes. */
export { openSourceNativeConstructionReview } from './construction/review.js';
export type {
  SourceNativeConstructionReviewDecision,
  SourceNativeConstructionReviewItem,
  SourceNativeConstructionReviewPacket,
  SourceNativeConstructionReviewResponse,
  SourceNativeConstructionReviewSession,
  SourceNativeConstructionSemanticReview,
} from './construction/review.js';
export { openSourceNativeProductWithConstruction } from './construction/navigation.js';
export type {
  SourceNativeConstructionAttachmentRole,
  SourceNativeConstructionLedgerSummary,
  SourceNativeConstructionMatch,
  SourceNativeConstructionProduct,
  SourceNativeConstructionReadResult,
  SourceNativeConstructionSearchInput,
  SourceNativeConstructionSearchResult,
} from './construction/navigation.js';
export { openSourceNativeOntExplorer } from './construction/explorer.js';
export type {
  SourceNativeOntExplorer,
  SourceNativeOntExplorerAuthority,
  SourceNativeOntExplorerBinding,
  SourceNativeOntExplorerConfiguration,
  SourceNativeOntExplorerHistorical,
  SourceNativeOntExplorerHistoricalConfiguration,
  SourceNativeOntExplorerConstructionCoverage,
  SourceNativeOntExplorerEdge,
  SourceNativeOntExplorerEdgesInput,
  SourceNativeOntExplorerEdgesResult,
  SourceNativeOntExplorerFreshness,
  SourceNativeOntExplorerLedgerSummary,
  SourceNativeOntExplorerNativeCoverage,
  SourceNativeOntExplorerNode,
  SourceNativeOntExplorerNodesInput,
  SourceNativeOntExplorerNodesResult,
  SourceNativeOntExplorerReadResult,
  SourceNativeOntExplorerRecord,
  SourceNativeOntExplorerRecordsInput,
  SourceNativeOntExplorerRecordsResult,
  SourceNativeOntExplorerStatusResult,
} from './construction/explorer.js';
export {
  compileSourceNativeConstructionAdmissionRecord,
  readSourceNativeConstructionLedger,
  readSourceNativeConstructionLedgerAtArtifact,
  sourceNativeConstructionAdmissionStatement,
  sourceNativeConstructionProposalStatement,
  validateSourceNativeConstructionAdmissionRecord,
  writeSourceNativeConstructionAdmission,
} from './construction/admission.js';
export type {
  SourceNativeConstructionAdmissionRecord,
  SourceNativeConstructionAdmissionStatement,
  SourceNativeConstructionAdmissionWriteResult,
  SourceNativeConstructionLedger,
  SourceNativeConstructionProposalStatement,
} from './construction/admission.js';
export { createSourceNativeProductMcpHandler } from './product/mcp.js';
export type { ProductTransport } from './product/mcp.js';
export {
  buildSourceNativeProduct,
  openSourceNativeHistoricalProductRuntime,
  openSourceNativeProductRuntime,
  SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE,
} from './product/runtime.js';
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
} from './product/runtime.js';
export {
  bindSourceNativeProductResource,
  createSourceNativeProductResource,
  openExactProductArtifactState,
  openProductSourceContext,
  openProductState,
  productSources,
  readSourceNativeProductArtifactDescriptor,
  SOURCE_NATIVE_PRODUCT_RESOURCE_FILE,
  validateSourceNativeProductResource,
} from './source/artifact.js';
export type {
  Descriptor,
  ObjectOnt,
  ProductOptions,
  ProductSource,
  SourceNativeProductSourceContext,
  SourceNativeBuildInput,
  Resource,
  SourceNativeProductResourceBindingReceipt,
  SourceNativeProductResourceReceipt,
} from './source/artifact.js';
export {
  normalizeCanonicalObjectBackendUri,
  openCanonicalObjectBackend,
} from './storage/canonical-backend.js';
export type {
  CanonicalObjectBackendEnvironment,
  CanonicalObjectBackendSelection,
} from './storage/canonical-backend.js';
export {
  openSourceNativeExactEvidenceSession,
} from './query/verification/evidence-session.js';
export {
  compileSourceNativeCurrentFieldChronologyVerification,
} from './query/verification/current-field.js';
export type {
  SourceNativeCurrentFieldChronologyVerification,
  SourceNativeCurrentFieldProofDisposition,
} from './query/verification/current-field.js';
export type {
  BoundObjectOnt,
  ExactSessionOptions,
  ExactSessionSource,
  ExactSourceAvailabilitySnapshot,
  SearchRequest,
  SeedRequest,
  SourceHandle,
} from './query/verification/evidence-session.js';
export {
  objectBytesSha256,
  openObjectOntStore,
  stableObjectSha256,
  stableObjectText,
} from './storage/ont-store.js';
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
} from './storage/ont-store.js';
export {
  compileProofAuthorityProjection,
  proofAuthorityForProjection,
  validateProofAuthorityProjection,
} from './proof/authority-projection.js';
export type {
  CompileProofAuthorityProjectionInput,
  ProofAuthorityItem,
  ProofAuthorityProjection,
  ProofAuthorityRelation,
  ProofEvidenceReference,
  SourceProjectionAuthority,
} from './proof/authority-projection.js';
export {
  compileProofSufficiencyContract,
  validateProofSufficiencyContract,
} from './proof/sufficiency-contract.js';
export type {
  CompileProofSufficiencyContractInput,
  ProofObligationRole,
  ProofRelationDirection,
  ProofSufficiencyContract,
  ProofSufficiencyObligation,
} from './proof/sufficiency-contract.js';
export {
  evaluateProjectionRelationCensus,
  evaluateProofSufficiencyContract,
} from './proof/sufficiency-evaluator.js';
export type {
  EvaluateProjectionRelationCensusInput,
  EvaluateProofSufficiencyContractInput,
  ProjectionRelationCensusEvaluation,
  ProofObligationEvaluation,
  ProofProposition,
  ProofRelation,
  ProofRelationView,
  ProofSufficiencyEvaluation,
} from './proof/sufficiency-evaluator.js';
export {
  compileSourceNativeProofAuthorityProjection,
} from './source/semantic-projection.js';
export type {
  CompileSourceNativeProofAuthorityProjectionInput,
} from './source/semantic-projection.js';
export type {
  SourceNativeCanonicalRole,
  SourceNativeCanonicalPropositionV2,
  SourceNativePropositionModality,
  SourceNativePropositionPolarity,
  SourceNativePropositionRelationType,
  SourceNativePropositionRelationV1,
} from './source/object-map.js';
export {
  openSourceNativeObjectOntIndex,
  openSourceNativeObjectOntRefIndex,
} from './source/object-ont.js';
export type {
  OpenSourceNativeObjectOntOptions,
  SourceNativeObjectOntIndex,
  SourceNativeObjectOntRefIndex,
} from './source/object-ont.js';
export {
  compileSourceNativeAdmittedKnowledgeBundle,
  compileSourceNativeAdmissionRecord,
  compileSourceNativeSemanticKnowledgeBundle,
  openSourceNativeProductWithAdmittedKnowledge,
  sourceNativeAdmissionStatement,
  sourceNativeProposalStatement,
  validateSourceNativeAdmittedKnowledgeBundle,
  writeSourceNativeAdmittedKnowledge,
} from './ledger/admitted-knowledge.js';
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
} from './ledger/admitted-knowledge.js';
export {
  compileSourceNativeSemanticConstruction,
  rebindSourceNativeSemanticConstruction,
  validateSourceNativeSemanticConstruction,
} from './construction/compiler.js';
export type {
  SourceNativeSemanticAlias,
  SourceNativeSemanticClaim,
  SourceNativeSemanticConstruction,
  SourceNativeSemanticConstructionInput,
  SourceNativeSemanticObjectDef,
  SourceNativeSemanticSourceBinding,
  SourceNativeSemanticSourceResult,
  SourceNativeSemanticWitness,
} from './construction/compiler.js';
