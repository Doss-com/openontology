/** Independent Admission of source-bound navigation. Never a factual proof authority. */
import { objectBytesSha256, stableObjectSha256, stableObjectText } from './canonical-content.mjs';
import {
  admissionTrustRegistry, authenticateAdmissionSignatures, canonicalAdmissionSignature,
} from './admission-authentication.mjs';
import type { SourceNativeAdmissionTrustEntry } from './admission-authentication.mjs';
import { openProductSourceContext } from './source-native-artifact.mjs';
import type { ProductOptions, SourceNativeProductSourceContext } from './source-native-artifact.mjs';
import type { BlobDescriptor, ReplayMetadataGraph, ReplayMetadataSnapshot } from './object-ont-store.mjs';
import {
  assertSemanticConstructionBound, validateSourceNativeSemanticConstruction,
} from './source-native-semantic-construction.mjs';
import type {
  SourceNativeSemanticConstruction,
  SourceNativeSemanticConstructionBindingContext,
} from './source-native-semantic-construction.mjs';

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

type ConstructionLedgerContext = SourceNativeSemanticConstructionBindingContext
  & Pick<SourceNativeProductSourceContext, 'store'>;
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
const KNOWN_READER_ERROR_CODES = new Set([
  'CONSTRUCTION_ADMISSION_SHAPE', 'CONSTRUCTION_ADMISSION_TEXT', 'CONSTRUCTION_ADMISSION_HASH',
  'CONSTRUCTION_ADMISSION_BRANCH', 'CONSTRUCTION_ADMISSION_EMPTY', 'CONSTRUCTION_ADMISSION_TIME',
  'CONSTRUCTION_ADMISSION_INDEPENDENCE', 'CONSTRUCTION_ADMISSION_SUPERSESSION',
  'CONSTRUCTION_ADMISSION_STATEMENT', 'CONSTRUCTION_ADMISSION_LIMIT', 'CONSTRUCTION_ADMISSION_RECORD',
  'CONSTRUCTION_ADMISSION_PATH', 'CONSTRUCTION_ADMISSION_MISSING', 'CONSTRUCTION_ADMISSION_ROLLBACK',
  'CONSTRUCTION_ADMISSION_AMBIGUOUS', 'SOURCE_NATIVE_ADMISSION_SIGNATURE',
  'SOURCE_NATIVE_ADMISSION_TRUST', 'SOURCE_NATIVE_ADMISSION_AUTHENTICATION',
  'SEMANTIC_CONSTRUCTION_SHAPE', 'SEMANTIC_CONSTRUCTION_TEXT', 'SEMANTIC_CONSTRUCTION_HASH',
  'SEMANTIC_CONSTRUCTION_ID', 'SEMANTIC_CONSTRUCTION_COUNT', 'SEMANTIC_CONSTRUCTION_LIMIT',
  'SEMANTIC_CONSTRUCTION_DUPLICATE', 'SEMANTIC_CONSTRUCTION_SPAN', 'SEMANTIC_CONSTRUCTION_TIME',
  'SEMANTIC_CONSTRUCTION_METHOD', 'SEMANTIC_CONSTRUCTION_KIND', 'SEMANTIC_CONSTRUCTION_ENDPOINT',
  'SEMANTIC_CONSTRUCTION_PREDICATE', 'SEMANTIC_CONSTRUCTION_COVERAGE',
  'SEMANTIC_CONSTRUCTION_RECORD', 'SEMANTIC_CONSTRUCTION_BINDING', 'SEMANTIC_CONSTRUCTION_SOURCE',
  'SEMANTIC_CONSTRUCTION_EVIDENCE', 'SEMANTIC_CONSTRUCTION_NAME', 'SEMANTIC_CONSTRUCTION_SCOPE',
  'SEMANTIC_CONSTRUCTION_ATTACHMENT', 'OBJECT_ONT_HISTORY_CONFLICT',
  'OBJECT_ONT_HISTORY_CORRUPT', 'OBJECT_ONT_HISTORY_TARGET', 'OBJECT_ONT_HISTORY_MISSING',
  'OBJECT_ONT_HISTORY_PENDING', 'OBJECT_ONT_HISTORY_MISMATCH', 'OBJECT_ONT_HISTORY_ENROLLMENT_RACE',
  'OBJECT_ONT_HISTORY_BACKEND', 'OBJECT_ONT_HISTORY_WRITE', 'OBJECT_ONT_REF_READ',
  'OBJECT_ONT_REF_SCOPE', 'OBJECT_ONT_REF_ROLLBACK', 'OBJECT_ONT_REF_CONFLICT',
  'OBJECT_ONT_COMMIT_READ', 'OBJECT_ONT_BLOB_READ', 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_READ',
  'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT', 'OBJECT_ONT_REPLAY_INDEX_CHECKPOINT_ELIGIBILITY',
]);
const GENERIC_RECORD_ERROR_CODE = 'CONSTRUCTION_ADMISSION_RECORD';
const GENERIC_INELIGIBLE_ERROR_CODE = 'CONSTRUCTION_ADMISSION_INELIGIBLE';
const GENERIC_HISTORY_ERROR_CODE = 'CONSTRUCTION_ADMISSION_HISTORY';
function canonicalReaderErrorCode(error: unknown, fallback: string): string {
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : null;
  return code !== null && KNOWN_READER_ERROR_CODES.has(code) ? code : fallback;
}
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
function branchFor(state: ConstructionLedgerContext, input: unknown): string {
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
function readRecord(state: ConstructionLedgerContext, descriptor: BlobDescriptor): SourceNativeConstructionAdmissionRecord {
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
function assertReplay(state: ConstructionLedgerContext, replay: ReplayMetadataGraph): void {
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
  const state = openProductSourceContext(options);
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

type SourceNativeConstructionRecordDispositionState =
  'invalid' | 'ineligible' | 'superseded' | 'conflicting' | 'active';

interface SourceNativeConstructionRecordDisposition {
  schemaVersion: 1;
  kind: 'OpenOntologySourceNativeConstructionRecordDispositionV1';
  blobSha256: string;
  recordSha256: string | null;
  constructionSha256: string | null;
  state: SourceNativeConstructionRecordDispositionState;
  reasonCodes: readonly string[];
  supersedesRecordSha256s: readonly string[];
  supersededByRecordSha256s: readonly string[];
  conflictingObjectDefIds: readonly string[];
}

interface MutableSourceNativeConstructionRecordDisposition {
  blobSha256: string;
  recordSha256: string | null;
  constructionSha256: string | null;
  state: SourceNativeConstructionRecordDispositionState;
  reasonCodes: string[];
  supersedesRecordSha256s: string[];
}

interface SourceNativeConstructionLedgerSnapshot {
  ledger: SourceNativeConstructionLedger;
  records: readonly SourceNativeConstructionRecordDisposition[];
}

interface SourceNativeConstructionSelectedSnapshot extends SourceNativeConstructionLedgerSnapshot {
  selectedRecord: SourceNativeConstructionAdmissionRecord | null;
  selectedDisposition: SourceNativeConstructionRecordDisposition | null;
  knowledgeSnapshot: ReplayMetadataSnapshot;
  sourceSnapshot: ReplayMetadataSnapshot;
}

interface ConstructionLedgerReader {
  read(): SourceNativeConstructionLedger;
  readSnapshot(): SourceNativeConstructionLedgerSnapshot;
  readSnapshotAt(input: {
    commitSha256: string;
    replaySha256: string;
    recordSha256: string;
  }): SourceNativeConstructionSelectedSnapshot;
}

/** Internal source/trust-pinned reader. Returned records are navigation, not Evidence. */
export function createConstructionLedgerReader(
  context: ConstructionLedgerContext,
  trustInput: readonly SourceNativeAdmissionTrustEntry[],
  knowledgeBranch?: string,
): ConstructionLedgerReader {
  const registry = admissionTrustRegistry(trustInput);
  const branch = branchFor(context, knowledgeBranch);
  let lastAcceptedCommitSha256: string | null = null;

  function evaluate(collectRecords: true): SourceNativeConstructionLedgerSnapshot;
  function evaluate(collectRecords: false): SourceNativeConstructionLedger;
  function evaluate(collectRecords: true, selected: {
    replay: ReplayMetadataGraph;
    commitSha256: string;
    replaySha256: string;
    recordSha256: string;
    knowledgeSnapshot: ReplayMetadataSnapshot;
    sourceSnapshot: ReplayMetadataSnapshot;
  }): SourceNativeConstructionSelectedSnapshot;
  function evaluate(collectRecords: boolean, selected: {
    replay: ReplayMetadataGraph;
    commitSha256: string;
    replaySha256: string;
    recordSha256: string;
    knowledgeSnapshot: ReplayMetadataSnapshot;
    sourceSnapshot: ReplayMetadataSnapshot;
  } | null = null): SourceNativeConstructionLedger | SourceNativeConstructionLedgerSnapshot
    | SourceNativeConstructionSelectedSnapshot {
    let commitSha256: string | null = null;
    let replaySha256: string | null = null;
    const structural = new Map<string, SourceNativeConstructionAdmissionRecord>();
    const bound: SourceNativeConstructionAdmissionRecord[] = [];
    let selectedRecord: SourceNativeConstructionAdmissionRecord | null = null;
    const dispositions = collectRecords
      ? new Map<string, MutableSourceNativeConstructionRecordDisposition>() : null;
    const dispositionKey = (recordSha256: string): string => `record:${recordSha256}`;
    const malformedDispositionKey = (blobSha256: string): string => `blob:${blobSha256}`;
    let invalidRecordCount = 0;
    const diagnostics = new Set<string>();
    let sourceReadFailure: { error: unknown } | null = null;
    const bindingContext: ConstructionLedgerContext = context.readSource === undefined ? context : {
      ...context,
      readSource: (sourceRef: string) => {
        try {
          return context.readSource?.(sourceRef) ?? fail('RECORD');
        } catch (error) {
          sourceReadFailure = { error };
          throw error;
        }
      },
    };
    const isSourceReadFailure = (error: unknown): boolean =>
      sourceReadFailure !== null && sourceReadFailure.error === error;
    function invalid(error: unknown, record: MutableSourceNativeConstructionRecordDisposition | undefined = undefined,
      state: SourceNativeConstructionRecordDispositionState = 'invalid',
      fallback = GENERIC_RECORD_ERROR_CODE): void {
      invalidRecordCount += 1;
      const code = canonicalReaderErrorCode(error, fallback);
      diagnostics.add(code);
      if (record) {
        record.state = state;
        record.reasonCodes.push(code);
      }
    }
    try {
      const snapshot = selected?.knowledgeSnapshot
        ?? context.store.readRefMetadataSnapshot({ ontId: context.descriptor.ontId, branch });
      if (snapshot === null && lastAcceptedCommitSha256 !== null) fail('MISSING');
      const replay = selected?.replay ?? snapshot?.replayMetadata ?? null;
      if (snapshot && replay) {
        assertReplay(context, replay);
        if (lastAcceptedCommitSha256 !== null
          && !snapshot.replayMetadata.commitOrder.includes(lastAcceptedCommitSha256)) {
          fail('ROLLBACK');
        }
        commitSha256 = selected?.commitSha256 ?? snapshot.ref.commitSha256;
        replaySha256 = selected?.replaySha256 ?? snapshot.ref.replaySha256;
        lastAcceptedCommitSha256 = snapshot.ref.commitSha256;
        for (const descriptor of replay.blobDescriptors.filter((item) => item.logicalPath.startsWith(PREFIX))) {
          const disposition: MutableSourceNativeConstructionRecordDisposition | undefined = collectRecords ? {
            blobSha256: descriptor.storedSha256,
            recordSha256: null,
            constructionSha256: null,
            state: 'invalid' as const,
            reasonCodes: [] as string[],
            supersedesRecordSha256s: [] as string[],
          } : undefined;
          let record: SourceNativeConstructionAdmissionRecord;
          try {
            record = readRecord(context, descriptor);
          } catch (error) {
            invalid(error, disposition, 'invalid', GENERIC_RECORD_ERROR_CODE);
            if (disposition) dispositions?.set(malformedDispositionKey(disposition.blobSha256), disposition);
            continue;
          }
          if (disposition) {
            disposition.recordSha256 = record.recordSha256;
            disposition.constructionSha256 = record.construction.constructionSha256;
            disposition.supersedesRecordSha256s = [...record.statement.supersedesRecordSha256s];
            disposition.state = 'active';
            dispositions?.set(dispositionKey(record.recordSha256), disposition);
          }
          structural.set(record.recordSha256, record);
          try {
            authenticate(record, registry);
            assertSemanticConstructionBound(record.construction, bindingContext);
            bound.push(record);
            if (selected?.recordSha256 === record.recordSha256) selectedRecord = record;
          } catch (error) {
            if (isSourceReadFailure(error)) throw error;
            invalid(error, disposition, 'ineligible', GENERIC_INELIGIBLE_ERROR_CODE);
          }
        }
      }
    } catch (error) {
      if (isSourceReadFailure(error)) throw error;
      commitSha256 = null; replaySha256 = null;
      structural.clear(); bound.length = 0;
      dispositions?.clear();
      invalid(error, undefined, 'invalid', GENERIC_HISTORY_ERROR_CODE);
    }
    const eligible = bound.filter((record) => {
      const disposition = dispositions?.get(dispositionKey(record.recordSha256));
      try {
        for (const sha of record.statement.supersedesRecordSha256s) {
          const target = structural.get(sha);
          if (!target) fail('SUPERSESSION');
          assertCorrection(record, target);
        }
        return true;
      } catch (error) {
        invalid(error, disposition, 'ineligible', 'CONSTRUCTION_ADMISSION_SUPERSESSION');
        return false;
      }
    });
    const superseded = new Set(eligible.flatMap((record) => record.statement.supersedesRecordSha256s));
    const supersededBy = collectRecords ? new Map<string, Set<string>>() : null;
    if (supersededBy) {
      for (const record of eligible) {
        for (const target of record.statement.supersedesRecordSha256s) {
          const superseders = supersededBy.get(target) ?? new Set<string>();
          superseders.add(record.recordSha256);
          supersededBy.set(target, superseders);
        }
      }
    }
    const current = eligible.filter((record) => !superseded.has(record.recordSha256));
    const proposalsById = new Map<string, Set<string>>();
    const recordsByObjectDefId = collectRecords
      ? new Map<string, SourceNativeConstructionAdmissionRecord[]>() : null;
    for (const record of current) {
      for (const object of record.construction.objectDefs) {
        const hashes = proposalsById.get(object.id) ?? new Set<string>();
        hashes.add(record.construction.constructionSha256);
        proposalsById.set(object.id, hashes);
        if (recordsByObjectDefId) {
          const records = recordsByObjectDefId.get(object.id) ?? [];
          records.push(record);
          recordsByObjectDefId.set(object.id, records);
        }
      }
    }
    const conflictingObjectDefIds = [...proposalsById].filter(([, hashes]) => hashes.size > 1)
      .map(([id]) => id).sort(compare);
    const conflicts = new Set(conflictingObjectDefIds);
    const activeRecords = current.filter((record) => !record.construction.objectDefs.some((item) => conflicts.has(item.id)))
      .sort((a, b) => compare(a.recordSha256, b.recordSha256));
    const conflictingRecordCount = current.length - activeRecords.length;
    if (conflictingRecordCount > 0) diagnostics.add('CONSTRUCTION_ADMISSION_AMBIGUOUS');
    let conflictingObjectIdsByRecord: Map<string, Set<string>> | null = null;
    if (collectRecords && recordsByObjectDefId && dispositions && supersededBy) {
      conflictingObjectIdsByRecord = new Map<string, Set<string>>();
      for (const objectDefId of conflictingObjectDefIds) {
        const records = recordsByObjectDefId.get(objectDefId) ?? [];
        for (const record of records) {
          const objectDefIds = conflictingObjectIdsByRecord.get(record.recordSha256) ?? new Set<string>();
          objectDefIds.add(objectDefId);
          conflictingObjectIdsByRecord.set(record.recordSha256, objectDefIds);
        }
      }
      for (const disposition of dispositions.values()) {
        if (disposition.recordSha256 === null) continue;
        const superseders = [...(supersededBy.get(disposition.recordSha256) ?? [])].sort(compare);
        const conflictObjectIds = [...(conflictingObjectIdsByRecord.get(disposition.recordSha256) ?? [])]
          .sort(compare);
        if (disposition.state !== 'invalid' && disposition.state !== 'ineligible') {
          if (superseders.length > 0) {
            disposition.state = 'superseded';
            disposition.reasonCodes.push('CONSTRUCTION_ADMISSION_SUPERSEDED');
          } else if (conflictObjectIds.length > 0) {
            disposition.state = 'conflicting';
            disposition.reasonCodes.push('CONSTRUCTION_ADMISSION_AMBIGUOUS');
          } else {
            disposition.state = 'active';
          }
        }
      }
    }
    const ledger: SourceNativeConstructionLedger = freeze({ schemaVersion: 1 as const,
      kind: 'OpenOntologySourceNativeConstructionLedgerV1' as const,
      branch, commitSha256, replaySha256, structuralRecordCount: structural.size,
      eligibleRecordCount: eligible.length,
      supersededRecordCount: superseded.size,
      conflictingRecordCount, invalidRecordCount, conflictingObjectDefIds, activeRecords,
      diagnosticCodes: [...diagnostics].sort(compare), state: diagnostics.size > 0 ? 'degraded' : 'ready',
      navigationOnly: true as const, exactSourcesRemainAuthority: true as const });
    if (collectRecords && dispositions && supersededBy && conflictingObjectIdsByRecord) {
      const recordStates = [...dispositions.values()]
        .map((record): SourceNativeConstructionRecordDisposition => {
          const recordSha256 = record.recordSha256;
          const superseders = recordSha256 === null ? []
            : [...(supersededBy.get(recordSha256) ?? [])].sort(compare);
          const conflictObjectIds = recordSha256 === null ? []
            : [...(conflictingObjectIdsByRecord?.get(recordSha256) ?? [])].sort(compare);
          return {
            schemaVersion: 1,
            kind: 'OpenOntologySourceNativeConstructionRecordDispositionV1',
            blobSha256: record.blobSha256,
            recordSha256,
            constructionSha256: recordSha256 === null ? null : record.constructionSha256,
            state: record.state,
            reasonCodes: [...new Set(record.reasonCodes)].sort(compare),
            supersedesRecordSha256s: recordSha256 === null ? []
              : [...record.supersedesRecordSha256s].sort(compare),
            supersededByRecordSha256s: superseders,
            conflictingObjectDefIds: conflictObjectIds,
          };
        })
        .sort((a, b) => compare(a.blobSha256, b.blobSha256));
      if (selected) {
        const selectedDisposition = recordStates.find((item) =>
          item.recordSha256 === selected.recordSha256) ?? (() => {
          const descriptor = selected.replay.blobDescriptors.find((item) =>
            item.logicalPath === recordPath(selected.recordSha256));
          return descriptor === undefined ? undefined
            : recordStates.find((item) => item.blobSha256 === descriptor.storedSha256);
        })() ?? null;
        return freeze({ ledger, records: recordStates, selectedRecord,
          selectedDisposition, knowledgeSnapshot: selected.knowledgeSnapshot,
          sourceSnapshot: selected.sourceSnapshot });
      }
      return freeze({ ledger, records: recordStates });
    }
    return ledger;
  }
  const readSnapshot = (): SourceNativeConstructionLedgerSnapshot => evaluate(true);
  const read = (): SourceNativeConstructionLedger => evaluate(false);
  const readSnapshotAt = (input: {
    commitSha256: string;
    replaySha256: string;
    recordSha256: string;
  }): SourceNativeConstructionSelectedSnapshot => {
    if (!SHA256.test(input.commitSha256) || !SHA256.test(input.replaySha256)
      || !SHA256.test(input.recordSha256)) fail('HASH');
    const knowledgeSnapshot = context.store.readRefMetadataSnapshot({
      ontId: context.descriptor.ontId, branch,
    });
    if (knowledgeSnapshot === null) fail('MISSING');
    assertReplay(context, knowledgeSnapshot.replayMetadata);
    if (!knowledgeSnapshot.replayMetadata.commitOrder.includes(input.commitSha256)) fail('BRANCH');
    const replay = context.store.replayMetadata(input.commitSha256);
    if (replay.status !== 'CLEAN' || replay.ontId !== context.descriptor.ontId
      || replay.replaySha256 !== input.replaySha256) fail('BRANCH');
    assertReplay(context, replay);
    const sourceSnapshot = context.store.readRefMetadataSnapshot({
      ontId: context.descriptor.ontId, branch: context.descriptor.branch,
    });
    if (sourceSnapshot === null) fail('MISSING');
    assertReplay(context, sourceSnapshot.replayMetadata);
    if (!sourceSnapshot.replayMetadata.commitOrder.includes(context.objectOnt.commitSha256)) fail('BRANCH');
    const value = evaluate(true, {
      replay, commitSha256: input.commitSha256, replaySha256: input.replaySha256,
      recordSha256: input.recordSha256, knowledgeSnapshot, sourceSnapshot,
    });
    if (value.selectedRecord === null && value.selectedDisposition === null) fail('RECORD');
    return value;
  };
  return Object.freeze({ read, readSnapshot, readSnapshotAt });
}

/** Fresh source/trust-bound snapshot. Returned records are navigation, not Evidence. */
export function readSourceNativeConstructionLedger({
  options = {}, trustRegistry: trust, knowledgeBranch,
}: LedgerInput): SourceNativeConstructionLedger {
  const state = openProductSourceContext(options);
  return createConstructionLedgerReader(state, trust, knowledgeBranch).read();
}
