/** Independent Admission of source-bound navigation. Never a factual proof authority. */
import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';
import {
  admissionTrustRegistry, authenticateAdmissionSignatures, canonicalAdmissionSignature,
} from './admission-authentication.mjs';
import type { SourceNativeAdmissionTrustEntry } from './admission-authentication.mjs';
import { openProductState } from './source-native-artifact.mjs';
import type { ProductOptions } from './source-native-artifact.mjs';
import type { BlobDescriptor, ReplayMetadataGraph } from './object-ont-store.mjs';
import {
  assertSemanticConstructionBound, validateSourceNativeSemanticConstruction,
} from './source-native-semantic-construction.mjs';
import type { SourceNativeSemanticConstruction } from './source-native-semantic-construction.mjs';

export interface SourceNativeConstructionProposalStatement {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeConstructionProposalStatementV1';
  constructionSha256: string;
  proposerId: string;
  proposedAt: string;
  signatureAlgorithm: 'Ed25519';
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeConstructionAdmissionStatement {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeConstructionAdmissionStatementV1';
  constructionSha256: string;
  proposedBy: string;
  issuerId: string;
  admittedAt: string;
  supersedesRecordSha256s: readonly string[];
  decision: 'admitted-for-navigation';
  signatureAlgorithm: 'Ed25519';
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
}

export interface SourceNativeConstructionAdmissionRecord {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeConstructionAdmissionRecordV1';
  construction: SourceNativeSemanticConstruction;
  proposalStatement: SourceNativeConstructionProposalStatement;
  proposalSignatureBase64: string;
  statement: SourceNativeConstructionAdmissionStatement;
  signatureBase64: string;
  recordSha256: string;
}

export interface SourceNativeConstructionAdmissionWriteResult {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeConstructionAdmissionWriteResultV1';
  ontId: string;
  branch: string;
  recordSha256: string;
  commitSha256: string;
  replaySha256: string;
  replayed: boolean;
}

export interface SourceNativeConstructionLedger {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeConstructionLedgerV1';
  branch: string;
  commitSha256: string | null;
  replaySha256: string | null;
  structuralRecordCount: number;
  eligibleRecordCount: number;
  supersededRecordCount: number;
  conflictingRecordCount: number;
  invalidRecordCount: number;
  conflictingObjectDefIds: readonly string[];
  activeRecords: readonly SourceNativeConstructionAdmissionRecord[];
  diagnosticCodes: readonly string[];
  state: 'ready' | 'degraded';
  navigationOnly: true;
  exactSourcesRemainAuthority: true;
}

type State = ReturnType<typeof openProductState>;
type Registry = ReturnType<typeof admissionTrustRegistry>;
type Row = Record<string, unknown>;
interface LedgerInput {
  options?: ProductOptions;
  trustRegistry: readonly SourceNativeAdmissionTrustEntry[];
  knowledgeBranch?: string;
}
const PREFIX = 'blobs/knowledge-ledger/construction/';
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RECORD_LIMIT = 2 * 1024 * 1024;
const compare = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
function fail(suffix: string): never {
  const code = `CONSTRUCTION_ADMISSION_${suffix}`;
  throw Object.assign(new TypeError(code), { code });
}
function row(value: unknown, keys: readonly string[]): Row {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length
    || !Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))) fail('SHAPE');
  return value as Row;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const text = (value: unknown): string => typeof value === 'string' && value.length > 0
  && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
  && Buffer.from(value).toString('utf8') === value ? value : fail('TEXT');
const hash = (value: unknown): string => typeof value === 'string' && SHA256.test(value)
  ? value : fail('HASH');
function recordPath(sha256: string): string { return `${PREFIX}${sha256.slice(7)}.json`; }
function branchFor(state: State, input: unknown): string {
  const branch = input === undefined ? `knowledge-${state.objectOnt.commitSha256.slice(7, 23)}` : text(input);
  if (branch === state.descriptor.branch) fail('BRANCH');
  return branch;
}
function constructionForAdmission(value: unknown): SourceNativeSemanticConstruction {
  const construction = validateSourceNativeSemanticConstruction(value);
  if (construction.objectDefs.length === 0) fail('EMPTY');
  return construction;
}

export function sourceNativeConstructionProposalStatement({ construction: input }: {
  construction: unknown;
}): SourceNativeConstructionProposalStatement {
  const construction = constructionForAdmission(input);
  return freeze({
    schemaVersion: 1, kind: 'OpenOntologySourceNativeConstructionProposalStatementV1',
    constructionSha256: construction.constructionSha256,
    proposerId: construction.proposedBy, proposedAt: construction.proposedAt,
    signatureAlgorithm: 'Ed25519', navigationOnly: true, exactSourcesRemainAuthority: true,
  });
}

export function sourceNativeConstructionAdmissionStatement({
  construction: input, issuerId: issuer, admittedAt: time, supersedesRecordSha256s: targets = [],
}: {
  construction: unknown;
  issuerId: string;
  admittedAt: string;
  supersedesRecordSha256s?: readonly string[];
}): SourceNativeConstructionAdmissionStatement {
  const construction = constructionForAdmission(input);
  const issuerId = text(issuer);
  const admittedAt = text(time);
  if (!Number.isFinite(Date.parse(admittedAt)) || new Date(admittedAt).toISOString() !== admittedAt) fail('TIME');
  if (issuerId === construction.proposedBy || Date.parse(admittedAt) < Date.parse(construction.proposedAt)) fail('INDEPENDENCE');
  if (!Array.isArray(targets) || targets.length > 128) fail('SUPERSESSION');
  const supersedesRecordSha256s = Array.from(targets, hash).sort(compare);
  if (new Set(supersedesRecordSha256s).size !== targets.length) fail('SUPERSESSION');
  return freeze({
    schemaVersion: 1, kind: 'OpenOntologySourceNativeConstructionAdmissionStatementV1',
    constructionSha256: construction.constructionSha256, proposedBy: construction.proposedBy,
    issuerId, admittedAt, supersedesRecordSha256s, decision: 'admitted-for-navigation',
    signatureAlgorithm: 'Ed25519', navigationOnly: true, exactSourcesRemainAuthority: true,
  });
}

/** Structure only. Authentication and exact source rebinding occur at write and cold read. */
export function compileSourceNativeConstructionAdmissionRecord({
  construction: input, proposalStatement: proposerInput, proposalSignatureBase64,
  statement: reviewerInput, signatureBase64,
}: {
  construction: unknown;
  proposalStatement: unknown;
  proposalSignatureBase64: unknown;
  statement: unknown;
  signatureBase64: unknown;
}): SourceNativeConstructionAdmissionRecord {
  const construction = constructionForAdmission(input);
  const proposalStatement = sourceNativeConstructionProposalStatement({ construction });
  const proposer = row(proposerInput, Object.keys(proposalStatement));
  if (stableObjectText(proposer) !== stableObjectText(proposalStatement)) fail('STATEMENT');
  const reviewer = row(reviewerInput, ['schemaVersion', 'kind', 'constructionSha256', 'proposedBy',
    'issuerId', 'admittedAt', 'supersedesRecordSha256s', 'decision', 'signatureAlgorithm',
    'navigationOnly', 'exactSourcesRemainAuthority']);
  const statement = sourceNativeConstructionAdmissionStatement({ construction,
    issuerId: text(reviewer.issuerId), admittedAt: text(reviewer.admittedAt),
    supersedesRecordSha256s: reviewer.supersedesRecordSha256s as readonly string[],
  });
  if (stableObjectText(reviewer) !== stableObjectText(statement)) fail('STATEMENT');
  const core = {
    schemaVersion: 1 as const, kind: 'OpenOntologySourceNativeConstructionAdmissionRecordV1' as const,
    construction, proposalStatement,
    proposalSignatureBase64: canonicalAdmissionSignature(proposalSignatureBase64),
    statement, signatureBase64: canonicalAdmissionSignature(signatureBase64),
  };
  const record = { ...core, recordSha256: stableObjectSha256(core) };
  if (Buffer.byteLength(stableObjectText(record)) > RECORD_LIMIT) fail('LIMIT');
  return freeze(record);
}

export function validateSourceNativeConstructionAdmissionRecord(value: unknown): SourceNativeConstructionAdmissionRecord {
  const input = row(value, ['schemaVersion', 'kind', 'construction', 'proposalStatement',
    'proposalSignatureBase64', 'statement', 'signatureBase64', 'recordSha256']);
  const expected = compileSourceNativeConstructionAdmissionRecord({ construction: input.construction,
    proposalStatement: input.proposalStatement, proposalSignatureBase64: input.proposalSignatureBase64,
    statement: input.statement, signatureBase64: input.signatureBase64,
  });
  if (stableObjectText(input) !== stableObjectText(expected)) fail('RECORD');
  return expected;
}

function authenticate(record: SourceNativeConstructionAdmissionRecord, registry: Registry): void {
  authenticateAdmissionSignatures({ proposerId: record.proposalStatement.proposerId,
    issuerId: record.statement.issuerId, proposalStatement: record.proposalStatement,
    statement: record.statement, proposalSignatureBase64: record.proposalSignatureBase64,
    signatureBase64: record.signatureBase64 }, registry);
}
function readRecord(state: State, descriptor: BlobDescriptor): SourceNativeConstructionAdmissionRecord {
  if (descriptor.byteLength > RECORD_LIMIT) fail('LIMIT');
  const bytes = state.store.readBlob(descriptor).bytes;
  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded).equals(bytes)) fail('RECORD');
  let value: unknown;
  try { value = JSON.parse(decoded); } catch { fail('RECORD'); }
  const record = validateSourceNativeConstructionAdmissionRecord(value);
  if (descriptor.logicalPath !== recordPath(record.recordSha256)) fail('PATH');
  return record;
}
function assertReplay(state: State, replay: ReplayMetadataGraph): void {
  if (replay.status !== 'CLEAN' || replay.ontId !== state.descriptor.ontId
    || !replay.commitOrder.includes(state.objectOnt.commitSha256)) fail('BRANCH');
}
function assertCorrection(record: SourceNativeConstructionAdmissionRecord,
  target: SourceNativeConstructionAdmissionRecord): void {
  if (Date.parse(target.statement.admittedAt) >= Date.parse(record.statement.admittedAt)
    || stableObjectText(target.construction.sourceBinding) !== stableObjectText(record.construction.sourceBinding)
    || stableObjectText(target.construction.objectDefs.map((item) => item.id))
      !== stableObjectText(record.construction.objectDefs.map((item) => item.id))) fail('SUPERSESSION');
}

export function writeSourceNativeConstructionAdmission({
  options = {}, trustRegistry: trust, knowledgeBranch, record: input,
}: LedgerInput & { record: unknown }): SourceNativeConstructionAdmissionWriteResult {
  const registry = admissionTrustRegistry(trust);
  const record = validateSourceNativeConstructionAdmissionRecord(input);
  authenticate(record, registry);
  const state = openProductState(options);
  assertSemanticConstructionBound(record.construction, state);
  const branch = branchFor(state, knowledgeBranch);
  const snapshot = state.store.readRefMetadataSnapshot({ ontId: state.descriptor.ontId, branch });
  const replay = snapshot?.replayMetadata;
  if (replay) assertReplay(state, replay);
  for (const targetSha of record.statement.supersedesRecordSha256s) {
    const descriptor = replay?.blobDescriptors.find((item) => item.logicalPath === recordPath(targetSha));
    if (!descriptor) fail('SUPERSESSION');
    assertCorrection(record, readRecord(state, descriptor));
  }
  const logicalPath = recordPath(record.recordSha256);
  const bytes = Buffer.from(stableObjectText(record));
  const existing = replay?.blobDescriptors.find((item) => item.logicalPath === logicalPath);
  if (existing) {
    if (existing.storedSha256 !== objectBytesSha256(bytes) || !snapshot) fail('BRANCH');
    // Reopen immutable bytes even on retry; a surviving descriptor alone is not persistence.
    readRecord(state, existing);
    return freeze({ schemaVersion: 1, kind: 'OpenOntologySourceNativeConstructionAdmissionWriteResultV1',
      ontId: state.descriptor.ontId, branch, recordSha256: record.recordSha256,
      commitSha256: snapshot.ref.commitSha256, replaySha256: snapshot.ref.replaySha256, replayed: true });
  }
  const blob = state.store.putBlob({ logicalPath, bytes, mediaType: 'application/vnd.openontology.construction-admission+json' });
  const parentSha = snapshot?.ref.commitSha256 ?? state.objectOnt.commitSha256;
  const parent = state.store.readCommit(parentSha).commit;
  const receipt = state.store.writeCommitMetadata({ ontId: state.descriptor.ontId,
    parents: [parentSha], ontManifest: parent.ontManifest, blobs: [blob] });
  const updated = state.store.compareAndSwapRefMetadata({ ontId: state.descriptor.ontId,
    branch, expectedVersion: snapshot?.version ?? null, commitSha256: receipt.commitSha256 });
  return freeze({ schemaVersion: 1, kind: 'OpenOntologySourceNativeConstructionAdmissionWriteResultV1',
    ontId: state.descriptor.ontId, branch, recordSha256: record.recordSha256,
    commitSha256: receipt.commitSha256, replaySha256: updated.ref.replaySha256, replayed: false });
}

/** Fresh source/trust-bound snapshot. Returned records are navigation, not Evidence. */
export function readSourceNativeConstructionLedger({
  options = {}, trustRegistry: trust, knowledgeBranch,
}: LedgerInput): SourceNativeConstructionLedger {
  const registry = admissionTrustRegistry(trust);
  const state = openProductState(options);
  const branch = branchFor(state, knowledgeBranch);
  let commitSha256: string | null = null;
  let replaySha256: string | null = null;
  const structural = new Map<string, SourceNativeConstructionAdmissionRecord>();
  const bound: SourceNativeConstructionAdmissionRecord[] = [];
  let invalidRecordCount = 0;
  const diagnostics = new Set<string>();
  function invalid(error: unknown): void {
    invalidRecordCount += 1;
    diagnostics.add(error && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string' ? error.code : 'CONSTRUCTION_ADMISSION_RECORD');
  }
  try {
    const snapshot = state.store.readRefMetadataSnapshot({ ontId: state.descriptor.ontId, branch });
    if (snapshot) {
      assertReplay(state, snapshot.replayMetadata);
      commitSha256 = snapshot.ref.commitSha256;
      replaySha256 = snapshot.ref.replaySha256;
      for (const descriptor of snapshot.replayMetadata.blobDescriptors.filter((item) => item.logicalPath.startsWith(PREFIX))) {
        try {
          const record = readRecord(state, descriptor);
          structural.set(record.recordSha256, record);
          authenticate(record, registry);
          assertSemanticConstructionBound(record.construction, state);
          bound.push(record);
        } catch (error) { invalid(error); }
      }
    }
  } catch (error) {
    commitSha256 = null; replaySha256 = null;
    structural.clear(); bound.length = 0;
    invalid(error);
  }
  const eligible = bound.filter((record) => {
    try {
      for (const sha of record.statement.supersedesRecordSha256s) {
        const target = structural.get(sha);
        if (!target) fail('SUPERSESSION');
        assertCorrection(record, target);
      }
      return true;
    } catch (error) { invalid(error); return false; }
  });
  const superseded = new Set(eligible.flatMap((record) => record.statement.supersedesRecordSha256s));
  const current = eligible.filter((record) => !superseded.has(record.recordSha256));
  const proposalsById = new Map<string, Set<string>>();
  for (const record of current) {
    for (const object of record.construction.objectDefs) {
      const hashes = proposalsById.get(object.id) ?? new Set<string>();
      hashes.add(record.construction.constructionSha256);
      proposalsById.set(object.id, hashes);
    }
  }
  const conflictingObjectDefIds = [...proposalsById].filter(([, hashes]) => hashes.size > 1)
    .map(([id]) => id).sort(compare);
  const conflicts = new Set(conflictingObjectDefIds);
  const activeRecords = current.filter((record) => !record.construction.objectDefs.some((item) => conflicts.has(item.id)))
    .sort((a, b) => compare(a.recordSha256, b.recordSha256));
  const conflictingRecordCount = current.length - activeRecords.length;
  if (conflictingRecordCount > 0) diagnostics.add('CONSTRUCTION_ADMISSION_AMBIGUOUS');
  return freeze({ schemaVersion: 1, kind: 'OpenOntologySourceNativeConstructionLedgerV1',
    branch, commitSha256, replaySha256, structuralRecordCount: structural.size,
    eligibleRecordCount: eligible.length,
    supersededRecordCount: eligible.filter((record) => superseded.has(record.recordSha256)).length,
    conflictingRecordCount, invalidRecordCount, conflictingObjectDefIds, activeRecords,
    diagnosticCodes: [...diagnostics].sort(compare), state: diagnostics.size > 0 ? 'degraded' : 'ready',
    navigationOnly: true, exactSourcesRemainAuthority: true });
}
