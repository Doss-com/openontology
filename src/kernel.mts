/** Bounded extension Interface for managed and research runtimes. */
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
} from './source-native-product.mjs';
export {
  openProductState,
  productSources,
} from './source-native-artifact.mjs';
export type {
  Descriptor,
  ObjectOnt,
  ProductOptions,
  ProductSource,
} from './source-native-artifact.mjs';
export {
  openSourceNativeExactEvidenceSession,
} from './source-native-evidence-session.mjs';
export type {
  ExactSessionSource,
  ExactSourceAvailabilitySnapshot,
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
} from './object-ont-store.mjs';
export {
  openSourceNativeObjectOntIndex,
} from './source-native-object-ont.mjs';
export type {
  SourceNativeObjectOntIndex,
} from './source-native-object-ont.mjs';
