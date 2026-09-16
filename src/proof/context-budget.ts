/** One bounded-context policy shared by live verification and durable reuse. */
import { stableObjectSha256 } from '../canonical-content.js';

export const MAXIMUM_PROOF_CONTEXT_UNITS: 64 = 64;
export const MAXIMUM_PROOF_CONTEXT_EVIDENCE_BYTES: 65536 = 65536;

export interface ProofContextBudgetAssessment {
  schemaVersion: 1;
  kind: 'OpenOntologyProofContextBudgetAssessmentV1';
  observedEvidenceReferenceCount: number;
  observedExactEvidenceBytes: number;
  maximumEvidenceReferenceCount: 64;
  maximumExactEvidenceBytes: 65536;
  withinBudget: boolean;
  assessmentSha256: string;
}

const fail = (): never => {
  const error = new TypeError('PROOF_CONTEXT_BUDGET') as TypeError & { code: string };
  error.code = 'PROOF_CONTEXT_BUDGET';
  throw error;
};

export function assessProofContextBudget({
  evidenceReferenceCount,
  exactEvidenceBytes,
}: {
  evidenceReferenceCount?: number;
  exactEvidenceBytes?: number;
} = {}): ProofContextBudgetAssessment {
  if (!Number.isSafeInteger(evidenceReferenceCount) || evidenceReferenceCount === undefined
    || evidenceReferenceCount < 0 || !Number.isSafeInteger(exactEvidenceBytes)
    || exactEvidenceBytes === undefined || exactEvidenceBytes < 0) fail();
  const exactEvidenceReferenceCount = typeof evidenceReferenceCount === 'number'
    ? evidenceReferenceCount : fail();
  const exactByteCount = typeof exactEvidenceBytes === 'number'
    ? exactEvidenceBytes : fail();
  const core = {
    schemaVersion: 1 as const,
    kind: 'OpenOntologyProofContextBudgetAssessmentV1' as const,
    observedEvidenceReferenceCount: exactEvidenceReferenceCount,
    observedExactEvidenceBytes: exactByteCount,
    maximumEvidenceReferenceCount: MAXIMUM_PROOF_CONTEXT_UNITS,
    maximumExactEvidenceBytes: MAXIMUM_PROOF_CONTEXT_EVIDENCE_BYTES,
    withinBudget: exactEvidenceReferenceCount <= MAXIMUM_PROOF_CONTEXT_UNITS
      && exactByteCount <= MAXIMUM_PROOF_CONTEXT_EVIDENCE_BYTES,
  };
  return Object.freeze({ ...core, assessmentSha256: stableObjectSha256(core) });
}
