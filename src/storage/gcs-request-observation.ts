/** Plain transport observations, usable without Node runtime type declarations. */
export const GCS_REQUEST_OBSERVATION_KIND = 'OpenOntologyGcsRequestObservationV1' as const;

export type GcsRequestOperationClass =
  'bucket-metadata' | 'object-metadata' | 'body-read' | 'create-if-absent' | 'compare-and-swap';

export type GcsRequestFailureClass = 'transport' | 'malformed-response';

export interface GcsRequestObservation {
  readonly schemaVersion: 1;
  readonly kind: typeof GCS_REQUEST_OBSERVATION_KIND;
  readonly operationClass: GcsRequestOperationClass;
  readonly method: string;
  readonly attempt: number;
  readonly status: number | null;
  readonly requestBodyBytes: number;
  readonly responseBodyBytes: number | null;
  readonly elapsedTransportMs: number;
  readonly bucket: string;
  readonly prefix: string | null;
  readonly failureClass: GcsRequestFailureClass | null;
}

export type GcsRequestObserver = (observation: Readonly<GcsRequestObservation>) => void;
