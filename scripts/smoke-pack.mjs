#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const sandbox = mkdtempSync(join(tmpdir(), 'oont-smoke-'));
const prefix = join(sandbox, 'prefix');
const project = join(sandbox, 'project');
const consumer = join(sandbox, 'consumer');
const ont = join(project, 'verified-context');
mkdirSync(prefix, { recursive: true });
mkdirSync(project, { recursive: true });
mkdirSync(consumer, { recursive: true });

let failures = 0;
let ordinal = 0;
const tail = (value, lines = 4) => String(value ?? '').trim().split('\n').slice(-lines).join('\n');
const check = (name, pass, detail = '') => {
  ordinal += 1;
  if (!pass) failures += 1;
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${String(ordinal).padStart(2)}. ${name}`
    + `${detail ? `\n        ${detail.replaceAll('\n', '\n        ')}` : ''}\n`);
};
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: options.cwd ?? sandbox,
  encoding: 'utf8',
  env: { ...process.env, ...options.env },
  timeout: options.timeout ?? 300_000,
});

function directorySnapshot(directory) {
  const files = [];
  const visit = (path, relative = '') => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(child);
      if (stat.isDirectory()) {
        files.push([`${childRelative}/`, 'directory']);
        visit(child, childRelative);
      }
      else if (stat.isFile()) files.push([childRelative,
        createHash('sha256').update(readFileSync(child)).digest('hex')]);
      else throw new Error('Unexpected non-file in generated lifecycle output');
    }
  };
  visit(directory);
  return JSON.stringify(files);
}

async function mcpTools(bin, artifactRoot, advanced = false) {
  return new Promise((done) => {
    const args = ['serve', artifactRoot, '--mcp'];
    if (advanced) args.push('--advanced');
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ ok: false, detail: 'MCP tools/list timed out' });
    }, 15_000);
    child.stdout.on('data', (bytes) => {
      pending += bytes;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch {
          clearTimeout(timer);
          child.kill('SIGKILL');
          done({ ok: false, detail: `non-JSON MCP output: ${line.slice(0, 120)}` });
          return;
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0', method: 'notifications/initialized', params: {},
          })}\n`);
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
          })}\n`);
        }
        if (message.id === 2) {
          clearTimeout(timer);
          child.kill('SIGKILL');
          const names = message.result?.tools?.map((tool) => tool.name) ?? [];
          done({ ok: true, names });
          return;
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'oont-smoke', version: '1' },
      },
    })}\n`);
  });
}

process.stdout.write(`sandbox ${sandbox}\n\n`);

try {
  const packed = run('npm', ['pack', '--pack-destination', sandbox], { cwd: root });
  const tarball = tail(packed.stdout, 1);
  const tarballPath = tarball ? join(sandbox, tarball) : null;
  const packedOk = packed.status === 0 && tarballPath && existsSync(tarballPath);
  check('npm pack', packedOk, packedOk
    ? `${tarball} (${(statSync(tarballPath).size / 1024).toFixed(0)} KB)`
    : tail(packed.stderr));
  if (!packedOk) process.exit(1);

  const installed = run('npm', [
    'install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarballPath,
  ]);
  const bin = join(prefix, 'bin', 'oont');
  check('clean global install', installed.status === 0 && existsSync(bin), tail(installed.stderr));

  const consumerInstall = run('npm', [
    'install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', tarballPath,
  ]);
  const packageRoot = join(consumer, 'node_modules', 'oont');
  check('clean package install', consumerInstall.status === 0 && existsSync(packageRoot),
    tail(consumerInstall.stderr));

  const contractPath = join(consumer, 'contract.mts');
  writeFileSync(contractPath, `import {
  openOntology,
  type OpenOntologyProduct,
  type OpenOntologyQueryInput,
  type OpenOntologyReadResult,
  type OpenOntologyResultState,
  type OpenOntologySearchResult,
  type OpenOntologyStatus,
  type OpenOntologyVerificationResult,
} from 'oont';

const ont: OpenOntologyProduct = openOntology({ artifactRoot: './verified-context' });
const query: OpenOntologyQueryInput = { question: 'What is current?' };
openOntology({ artifactRoot: './fixture', objectBackendEnv: {
  OONT_GCS_ACCESS_TOKEN_PROVIDER: () => 'fixture-token',
} });
const verification: OpenOntologyVerificationResult = await ont.verify('What is current?');
const search: OpenOntologySearchResult = await ont.search({
  question: 'What is current?',
  scope: { sourceSystem: 'tracker', objectType: 'task', field: 'title' },
});
const read: OpenOntologyReadResult | undefined = search.matches[0]
  ? await ont.read(search.matches[0].ref)
  : undefined;
const status: OpenOntologyStatus = ont.status();
const state: OpenOntologyResultState = verification.state;
const chronologyDisposition: 'sufficient' | 'insufficient' | undefined =
  verification.verification.currentFieldChronology?.proofDisposition;
const historical: OpenOntologyVerificationResult = await ont.verify({
  question: 'What was the title?', at: '2026-01-15T00:00:00.000Z',
});
const historicalTime: string | undefined = historical.at;
const historicalChronology: 'sufficient' | 'insufficient' | undefined =
  historical.verification.historicalFieldChronology?.proofDisposition;
const exactText: string | undefined = read?.exactText;
void query;
void status;
void state;
void chronologyDisposition;
void historicalTime;
void historicalChronology;
void exactText;
// @ts-expect-error artifactRoot is required for a typed caller.
openOntology();
// @ts-expect-error source publication preconditions are not query options.
openOntology({ artifactRoot: './fixture', expectedSourceVersion: null });
// @ts-expect-error Adapter authoring types are exposed through the kernel subpath only.
import type { SourceNativeBuildInput as RootSourceNativeBuildInput } from 'oont';
void (undefined as RootSourceNativeBuildInput | undefined);
`);
  const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const typedConsumer = run(process.execPath, [
    compiler,
    '--noEmit',
    '--strict',
    '--skipLibCheck', 'false',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    contractPath,
  ], { cwd: consumer });
  check('installed declarations compile for a strict consumer', typedConsumer.status === 0,
    tail(typedConsumer.stderr || typedConsumer.stdout, 12));

  const kernelContractPath = join(consumer, 'kernel-contract.mts');
  const authoringExample = readFileSync(join(packageRoot, 'docs', 'SOURCE-LIFECYCLE.md'), 'utf8')
    .match(/```ts\n([\s\S]*?)\n```/u)?.[1] ?? '';
  if (!authoringExample) throw new Error('missing installed TypeScript authoring example');
  const authoringExamplePath = join(consumer, 'authoring-example.mts');
  writeFileSync(authoringExamplePath, `${authoringExample}\n`);
  const authoringExampleBody = authoringExample.replace(
    /^import \{ buildSourceNativeProduct \} from 'oont\/kernel';\nimport type \{ SourceNativeBuildInput \} from 'oont\/kernel';\n\n/u,
    '',
  );
  writeFileSync(kernelContractPath, `import {
  buildSourceNativeProduct,
  compileProofSufficiencyContract,
  compileSourceNativeCurrentFieldChronologyVerification,
  compileSourceNativeSemanticConstruction,
  readSourceNativeConstructionLedger,
  sourceNativeConstructionAdmissionStatement,
  evaluateProofSufficiencyContract,
  openSourceNativeExactEvidenceSession,
  openSourceNativeObjectOntIndex,
  openSourceNativeOntExplorer,
  openSourceNativeProductRuntime,
  openSourceNativeProductWithAdmittedKnowledge,
  openSourceNativeProductWithConstruction,
  createSourceNativeProductMcpHandler,
  openSourceNativeConstructionReview,
  normalizeCanonicalObjectBackendUri,
  openCanonicalObjectBackend,
  stableObjectSha256,
  type ExactSessionOptions,
  type OpenSourceNativeObjectOntOptions,
  type ProofSufficiencyContract,
  type ProofSufficiencyEvaluation,
  type SourceNativeAdmittedKnowledgeProduct,
  type SourceNativeCurrentFieldChronologyVerification,
  type SourceNativeAdmittedKnowledgeContext,
  type SourceNativeAdmittedKnowledgeLedgerStatus,
  type SourceNativeAdmittedKnowledgeVerificationResult,
  type SourceNativeAdmittedProofBinding,
  type SourceNativeAdmissionTrustEntry,
  type SourceNativeAdmissionTrustRole,
  type SourceNativeBuildInput,
  type SourceNativeProductRuntimeContext,
  type SourceNativeSemanticConstruction,
  type SourceNativeSemanticConstructionInput,
  type SourceNativeConstructionLedger,
  type SourceNativeConstructionProduct,
  type SourceNativeConstructionReviewSession,
  type SourceNativeOntExplorer,
  type SourceNativeOntExplorerEdge,
  type SourceNativeOntExplorerEdgesResult,
  type SourceNativeOntExplorerNode,
  type SourceNativeOntExplorerNodesResult,
  type SourceNativeOntExplorerReadResult,
  type SourceNativeOntExplorerRecord,
  type SourceNativeOntExplorerRecordsResult,
  type SourceNativeOntExplorerStatusResult,
  type CanonicalObjectBackendEnvironment,
  type CanonicalObjectBackendSelection,
  type ProductTransport,
} from 'oont/kernel';

${authoringExampleBody}
const digest: string = stableObjectSha256({ contract: 'kernel' });
const normalizedBackendUri: string = normalizeCanonicalObjectBackendUri('file:///tmp/oont-kernel-consumer');
const backendEnvironment: CanonicalObjectBackendEnvironment = {
  OONT_GCS_ACCESS_TOKEN_PROVIDER: () => 'fixture-token',
};
const selectedBackend: CanonicalObjectBackendSelection = openCanonicalObjectBackend({
  uri: normalizedBackendUri,
  env: backendEnvironment,
});
const backendName: string = selectedBackend.capabilities.backend;
void backendName;
// @ts-expect-error backend URI input is a string, not a numeric generation.
openCanonicalObjectBackend({ uri: 1 });
// @ts-expect-error token provider configuration is callable or text, not a number.
openCanonicalObjectBackend({ uri: 'gs://fixture', env: { OONT_GCS_ACCESS_TOKEN_PROVIDER: 1 } });
const buildWithVersion = (input: unknown, expectedSourceVersion: string | null | undefined) =>
  buildSourceNativeProduct({ artifactRoot: './new-cut', input, expectedSourceVersion });
void buildWithVersion;
const parsedInput: unknown = authoringInput;
buildSourceNativeProduct({ artifactRoot: './new-cut', input: parsedInput });
const optionalFieldV2: SourceNativeBuildInput['nativeObjectInputs'][number]['fields'][number] = {
  fieldPath: 'status',
  value: 'open',
  propositionFamilyKey: 'ticket-status',
  businessEntityKeys: ['ticket:T-1'],
  canonicalValue: 'open',
  validAt: '2026-01-01T00:00:00.000Z',
  knownAt: '2026-01-01T00:00:00.000Z',
  canonicalProposition: {
    kind: 'OpenOntologySourceNativeCanonicalPropositionV2',
    propositionKey: 'ticket-t-1-status-open',
    actorHome: 'ObjectDef/InstanceRef',
    stateHome: 'Claim/PropositionRevision-payload',
    actorKind: 'ticket',
    predicate: 'has-status',
    state: 'open',
    dimension: 'ticket-status',
    canonicalRoles: ['state'],
    modality: 'observed',
    polarity: 'positive',
    businessEntityKeys: ['ticket:T-1'],
    extractionAuthority: 'deterministic-source-adapter-v1',
    relations: [],
  },
  provenanceBy: {
    home: 'ObjectDef/InstanceRef',
    sourceSystem: 'tracker',
    displayName: 'Tracker adapter',
    roleLabels: ['adapter'],
  },
  actorResolutionEvidence: {
    businessEntityKeys: ['ticket:T-1'], value: 'T-1', codeUnitStart: 7,
  },
};
const optionalObject: SourceNativeBuildInput['nativeObjectInputs'][number] = {
  relativePath: authoringInput.sources[0].relativePath,
  objectIdentity: authoringInput.nativeObjectInputs[0].objectIdentity,
  businessEntityKeys: ['ticket:T-1'],
  duplicateEvidenceFieldPaths: ['status'],
  transportOriginSystem: null,
  fields: [optionalFieldV2],
};
const optionalFieldV1: SourceNativeBuildInput['nativeObjectInputs'][number]['fields'][number] = {
  fieldPath: 'status',
  value: 'open',
  canonicalProposition: {
    kind: 'OpenOntologySourceNativeCanonicalPropositionV1',
    actorHome: 'ObjectDef/InstanceRef',
    stateHome: 'Claim/PropositionRevision-payload',
    actorKind: 'ticket',
    predicate: 'has-status',
    state: 'open',
    dimension: 'ticket-status',
    businessEntityKeys: [],
    extractionAuthority: 'deterministic-source-adapter-v1',
  },
};
void optionalFieldV1;
void optionalObject;
// @ts-expect-error schemaVersion is the literal version 1.
const wrongSchema = { ...authoringInput, schemaVersion: 2 } satisfies SourceNativeBuildInput;
// @ts-expect-error kind must identify the V1 Adapter envelope.
const wrongKind = { ...authoringInput, kind: 'OtherInput' } satisfies SourceNativeBuildInput;
// @ts-expect-error querySchemas is required.
const missingQuerySchemas: SourceNativeBuildInput = { schemaVersion: 1, kind: 'OpenOntologySourceNativeBuildInputV1', ontId: 'x', namespace: 'x', sources: [], nativeObjectInputs: [] };
// @ts-expect-error sources is required.
const missingSources: SourceNativeBuildInput = { schemaVersion: 1, kind: 'OpenOntologySourceNativeBuildInputV1', ontId: 'x', namespace: 'x', querySchemas: [], nativeObjectInputs: [] };
// @ts-expect-error nativeObjectInputs is required.
const missingObjects: SourceNativeBuildInput = { schemaVersion: 1, kind: 'OpenOntologySourceNativeBuildInputV1', ontId: 'x', namespace: 'x', querySchemas: [], sources: [] };
// @ts-expect-error a source content must be a string.
const nonStringContent = ({ ...authoringInput.sources[0], content: 1 }) satisfies SourceNativeBuildInput['sources'][number];
// @ts-expect-error a field value is required.
const missingFieldValue = ({ fieldPath: 'status' }) satisfies SourceNativeBuildInput['nativeObjectInputs'][number]['fields'][number];
// @ts-expect-error a field span index must be numeric.
const nonNumericSpan = ({ fieldPath: 'status', value: 'open', codeUnitStart: '19' }) satisfies SourceNativeBuildInput['nativeObjectInputs'][number]['fields'][number];
// @ts-expect-error the identity home is fixed by the source-native contract.
const invalidIdentityHome = ({ home: 'NativeObject', sourceSystem: 'tracker', objectType: 'ticket', namespace: 'demo', externalId: 'T-1' }) satisfies SourceNativeBuildInput['nativeObjectInputs'][number]['objectIdentity'];
// @ts-expect-error the build identity requires its namespace.
const missingIdentityNamespace = ({ home: 'ObjectDef/InstanceRef', sourceSystem: 'tracker', objectType: 'ticket', externalId: 'T-1' }) satisfies SourceNativeBuildInput['nativeObjectInputs'][number]['objectIdentity'];
// @ts-expect-error diagnostics are JSON objects, not arbitrary runtime values.
const nonJsonDiagnostic: NonNullable<SourceNativeBuildInput['adapterDiagnostics']>[number] = { bad: 1n };
void wrongSchema; void wrongKind; void missingQuerySchemas; void missingSources; void missingObjects;
void nonStringContent; void missingFieldValue; void nonNumericSpan; void invalidIdentityHome;
void missingIdentityNamespace; void nonJsonDiagnostic;
// @ts-expect-error source versions are opaque strings, never numeric generations.
buildSourceNativeProduct({ artifactRoot: './new-cut', expectedSourceVersion: 1 });
// @ts-expect-error source publication preconditions are not runtime opening options.
openSourceNativeProductRuntime({ artifactRoot: './fixture', expectedSourceVersion: null });
const openRuntime: typeof openSourceNativeProductRuntime = openSourceNativeProductRuntime;
const openAdmitted: typeof openSourceNativeProductWithAdmittedKnowledge =
  openSourceNativeProductWithAdmittedKnowledge;
const compileChronology: typeof compileSourceNativeCurrentFieldChronologyVerification =
  compileSourceNativeCurrentFieldChronologyVerification;
const chronology: SourceNativeCurrentFieldChronologyVerification | null = null;
const context: SourceNativeProductRuntimeContext | null = null;
const constructionInput: SourceNativeSemanticConstructionInput = {
  proposedBy: 'constructor', proposedAt: '2026-09-01T00:00:00.000Z', method: 'authored',
  objectDefs: [], claims: [], coverage: [],
};
const compileConstruction = (): SourceNativeSemanticConstruction =>
  compileSourceNativeSemanticConstruction({ input: constructionInput });
const inspectConstruction = (record: SourceNativeSemanticConstruction) => {
  const needsReview: true = record.reviewRequired;
  const predicate: 'mentions' | 'defines' | undefined = record.claims[0]?.predicate;
  // @ts-expect-error a construction proposal has no proof disposition
  const disposition = record.proofDisposition;
  void needsReview; void predicate; void disposition;
};
void compileConstruction; void inspectConstruction;
const inspectConstructionLedger = (ledger: SourceNativeConstructionLedger) => {
  const navigationOnly: true = ledger.navigationOnly;
  const current: string | undefined = ledger.activeRecords[0]?.construction.constructionSha256;
  // @ts-expect-error admitted navigation has no factual proof disposition
  const proof = ledger.proofDisposition;
  void navigationOnly; void current; void proof;
};
const readConstruction: typeof readSourceNativeConstructionLedger = readSourceNativeConstructionLedger;
const reviewConstruction: typeof sourceNativeConstructionAdmissionStatement = sourceNativeConstructionAdmissionStatement;
void inspectConstructionLedger; void readConstruction; void reviewConstruction;
const openConstruction: typeof openSourceNativeProductWithConstruction = openSourceNativeProductWithConstruction;
const inspectOrdinaryTransport = (ont: SourceNativeAdmittedKnowledgeProduct) => {
  const transport: ProductTransport = ont;
  return createSourceNativeProductMcpHandler(transport);
};
void inspectOrdinaryTransport;
const inspectConstructionClient = async (ont: SourceNativeConstructionProduct) => {
  const handler = createSourceNativeProductMcpHandler(ont, { profile: 'advanced' });
  void handler;
  const result = await ont.search({ term: 'allocation mismatch', scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' } });
  if (result.kind === 'OpenOntologyConstructionSearchResultV1') {
    const total: number = result.totalMatches;
    const concepts: number = result.totalConcepts;
    const pageConceptId: string | undefined = result.concepts[0]?.id;
    if (result.nextCursor) await ont.search({ term: 'allocation mismatch',
      scope: { sourceSystem: 'clickup', objectType: 'ClickupTask' }, cursor: result.nextCursor });
    const proof: false | undefined = result.matches[0]?.requiredForProof;
    // @ts-expect-error navigation matches do not pretend to be verified fields
    const field: string | undefined = result.matches[0]?.fieldSha256;
    void total; void concepts; void pageConceptId; void proof; void field;
  }
  const read = await ont.read({ ref: 'example' });
  if (read.kind === 'OpenOntologyConstructionReadResultV1') {
    const navigationOnly: true = read.binding.navigationOnly;
    // @ts-expect-error a construction read has no factual proof disposition
    const disposition = read.proofDisposition;
    void navigationOnly; void disposition;
  }
};
void openConstruction; void inspectConstructionClient;
const openReview: typeof openSourceNativeConstructionReview = openSourceNativeConstructionReview;
const inspectReview = (session: SourceNativeConstructionReviewSession) => {
  const kind: 'preferred-name' | 'scoped-alias' | 'mentions' | 'defines' | undefined = session.packet.items[0]?.kind;
  const result = session.evaluate({ packetSha256: session.packet.packetSha256, decisions: [] });
  const unsigned: false = result.admissionGranted;
  // @ts-expect-error a semantic review does not contain a reviewer signature
  const signature = result.signatureBase64;
  // @ts-expect-error a semantic review does not contain factual proof
  const proof = result.proofDisposition;
  void kind; void unsigned; void signature; void proof;
};
void openReview; void inspectReview;
const openExplorer: typeof openSourceNativeOntExplorer = openSourceNativeOntExplorer;
const inspectExplorer = (explorer: SourceNativeOntExplorer) => {
  const status: SourceNativeOntExplorerStatusResult = explorer.status();
  const nodes: SourceNativeOntExplorerNodesResult = explorer.nodes({ limit: 1 });
  const edges: SourceNativeOntExplorerEdgesResult = explorer.edges({ limit: 1 });
  const records: SourceNativeOntExplorerRecordsResult = explorer.records({ limit: 1 });
  const node: SourceNativeOntExplorerNode | undefined = nodes.nodes[0];
  const edge: SourceNativeOntExplorerEdge | undefined = edges.edges[0];
  const record: SourceNativeOntExplorerRecord | undefined = records.records[0];
  const exact: SourceNativeOntExplorerReadResult = explorer.read({ ref: 'explorer:fixture' });
  const freshness: 'unknown' = status.freshness.state;
  const accessMode: 'trusted-whole-ont-kernel' = status.authority.accessMode;
  void openExplorer; void node; void edge; void record; void exact; void freshness; void accessMode;
};
void inspectExplorer;
const exactOptions: ExactSessionOptions | null = null;
const indexOptions: OpenSourceNativeObjectOntOptions | null = null;
const trustRole: SourceNativeAdmissionTrustRole = 'reviewer';
const trustEntry: SourceNativeAdmissionTrustEntry = {
  issuerId: 'reviewer',
  publicKeyPem: '-----BEGIN PUBLIC KEY-----fixture-----END PUBLIC KEY-----',
  roles: [trustRole],
};
const admittedProduct: SourceNativeAdmittedKnowledgeProduct | null = null;
const admittedResult: SourceNativeAdmittedKnowledgeVerificationResult | null = null;
const admittedContext: SourceNativeAdmittedKnowledgeContext | null = null;
const admittedLedgerStatus: SourceNativeAdmittedKnowledgeLedgerStatus | null = null;
const admittedProofBinding: SourceNativeAdmittedProofBinding | null = null;
const inspectAdmitted = (result: SourceNativeAdmittedKnowledgeVerificationResult,
  status: ReturnType<SourceNativeAdmittedKnowledgeProduct['status']>) => {
  if (result.kind === 'OpenOntologySourceNativeAdmittedKnowledgeVerificationV1') {
    if (result.answerable) {
      const recordSha256: string = result.verification.admissionRecordSha256;
      const disposition: string = result.proofDisposition;
      const role: 'answer' | 'counterevidence' | 'anchor' | undefined =
        result.context[0]?.role;
      const first = result.context[0];
      const proofUnitSha256: string | undefined =
        first !== undefined && first.role !== 'anchor'
          ? first.binding.proofUnitSha256 : undefined;
      if (first !== undefined && first.role !== 'anchor') {
        // @ts-expect-error per-proposition labels and hashes are not returned
        const propositionSha256 = first.binding.propositionSha256;
        void propositionSha256;
      }
      void recordSha256;
      void disposition;
      void role;
      void proofUnitSha256;
    } else {
      const refusalCode: string = result.refusal.code;
      void refusalCode;
    }
  }
  const activeAdmissionCount: number = status.admittedKnowledge.activeAdmissionRecordCount;
  void activeAdmissionCount;
};
const proofContract: ProofSufficiencyContract = compileProofSufficiencyContract({
  questionKind: 'fixture-state',
  obligations: [{
    obligationId: 'state',
    propositionFamily: 'state',
    role: 'support',
    required: true,
    relationshipAnyOf: [],
    description: 'Require one state.',
  }, {
    obligationId: 'exact-support',
    propositionFamily: 'exact-support',
    role: 'support',
    required: true,
    relationshipAnyOf: [],
    description: 'Require exact Evidence.',
  }],
  sufficiencyRule: 'The state obligation must close.',
  stopWhen: 'Stop after proof closure or refusal.',
});
const proofEvaluation: ProofSufficiencyEvaluation = evaluateProofSufficiencyContract({
  contract: proofContract,
  propositions: [{
    revisionId: 'state-1',
    sourceProjectionItemId: 'state-1',
    familyId: 'fixture',
    canonicalRoles: ['state'],
    modality: 'observed',
    polarity: 'positive',
    actorRef: 'actor:fixture',
    validAt: '2026-09-01T00:00:00.000Z',
    knownAt: '2026-09-01T00:00:00.000Z',
    exactEvidenceReferences: [{
      sourceRef: 'fixture/state-1.json',
      sourceSha256: digest,
      byteStart: 0,
      byteEnd: 1,
      textSha256: digest,
    }],
  }],
  relations: [],
});
void digest;
void openRuntime;
void openAdmitted;
void compileChronology;
void chronology;
void context;
void exactOptions;
void indexOptions;
void trustEntry;
void admittedProduct;
void admittedResult;
void admittedContext;
void admittedLedgerStatus;
void admittedProofBinding;
void inspectAdmitted;
void proofEvaluation;
// @ts-expect-error Proof contracts are immutable after compilation.
proofContract.obligations.push({});
// @ts-expect-error Evidence sessions require complete authority and retrieval bindings.
openSourceNativeExactEvidenceSession({ sources: [] });
// @ts-expect-error ObjectOnt reads require an explicit canonical backend.
openSourceNativeObjectOntIndex({ ontId: 'example', commitSha256: digest });
`);
  const typedKernelConsumer = run(process.execPath, [
    compiler,
    '--noEmit',
    '--strict',
    '--skipLibCheck', 'false',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--typeRoots', join(root, 'node_modules', '@types'),
    '--types', 'node',
    kernelContractPath,
    authoringExamplePath,
  ], { cwd: consumer });
  check('kernel declarations compile with the supported Node types',
    typedKernelConsumer.status === 0,
    tail(typedKernelConsumer.stderr || typedKernelConsumer.stdout, 12));

  const help = run(bin, ['--help']);
  check('public CLI is compact', help.status === 0
    && /verify <ont>/.test(help.stderr)
    && /resolver build/.test(help.stderr)
    && !/admin|init|extract/.test(help.stderr), tail(help.stderr, 12));

  const inputPath = join(packageRoot, 'examples', 'quickstart', 'source-native-input.json');
  const build = run(bin, ['resolver', 'build', inputPath, '--out', ont]);
  check('documented packaged quickstart build', build.status === 0
    && existsSync(join(ont, 'source-native.json')), tail(build.stderr));

  const integrity = run(bin, ['check', ont]);
  let integrityResult;
  try { integrityResult = JSON.parse(integrity.stdout); } catch { integrityResult = null; }
  check('Ont integrity check', integrity.status === 0
    && integrityResult?.kind === 'OpenOntologyCheckV1'
    && integrityResult?.ok === true, integrity.status === 0 ? integrity.stdout.trim() : tail(integrity.stderr));

  const verified = run(bin, ['verify', ont, 'What is the current title of task-1?']);
  let verification;
  try { verification = JSON.parse(verified.stdout); } catch { verification = null; }
  check('proof-complete verification', verified.status === 0
    && verification?.answerable === true
    && verification?.context?.[0]?.exactText === 'Ship verified context',
  verified.status === 0 ? `state ${verification?.state}; exact ${verification?.context?.[0]?.exactText}`
    : tail(verified.stderr));

  const refused = run(bin, ['verify', ont, 'Who owns task-1?']);
  let refusal;
  try { refusal = JSON.parse(refused.stdout); } catch { refusal = null; }
  check('typed refusal is a valid result', refused.status === 0
    && refusal?.answerable === false
    && typeof refusal?.state === 'string',
  refused.status === 0 ? refusal?.state : tail(refused.stderr));

  const temporal = run(bin, ['verify', ont, 'What was the title of task-1 on 2026-01-15?']);
  let temporalRefusal;
  try { temporalRefusal = JSON.parse(temporal.stdout); } catch { temporalRefusal = null; }
  check('undeclared temporal intent refuses instead of returning current state',
    temporal.status === 0
      && temporalRefusal?.answerable === false
      && temporalRefusal?.state === 'unavailable-native-temporal-intent-not-declared'
      && temporalRefusal?.context?.length === 0,
    temporal.status === 0 ? temporalRefusal?.state : tail(temporal.stderr));

  const historical = run(bin, ['verify', ont, 'What was the title of task-1?',
    '--at', '2026-01-15T00:00:00.000Z']);
  let historicalResult;
  try { historicalResult = JSON.parse(historical.stdout); } catch { historicalResult = null; }
  check('installed point-in-time verification selects earlier exact Evidence',
    historical.status === 0 && historicalResult?.answerable === true
      && historicalResult?.intent === 'at'
      && historicalResult?.at === '2026-01-15T00:00:00.000Z'
      && historicalResult?.context?.[0]?.exactText === 'Prepare launch'
      && historicalResult?.verification?.historicalFieldChronology?.proofDisposition === 'sufficient',
    historical.status === 0 ? historicalResult?.state : tail(historical.stderr));

  const navigation = run(bin, ['search', ont, 'What is the current title of task-1?']);
  const titleRequests = [
    ['verify', ont, 'What is the current title of the task named "Prepare launch"?'],
    ['verify', ont, 'What was the title of the task named "Ship verified context"?',
      '--at', '2026-01-15T00:00:00.000Z'],
    ['verify', ont, 'What is the current title of the task named "Unknown task"?'],
  ].map((args) => {
    const result = run(bin, args);
    try { return { exit: result.status, value: JSON.parse(result.stdout) }; }
    catch { return { exit: result.status, value: null }; }
  });
  check('installed declared-title queries preserve chronology and refuse unknown names',
    titleRequests.every((result) => result.exit === 0)
      && titleRequests[0].value?.query?.externalId === 'task-1'
      && titleRequests[0].value?.context?.[0]?.exactText === 'Ship verified context'
      && titleRequests[1].value?.query?.externalId === 'task-1'
      && titleRequests[1].value?.context?.[0]?.exactText === 'Prepare launch'
      && titleRequests[2].value?.answerable === false
      && titleRequests[2].value?.context?.length === 0,
    titleRequests.map((result) => result.value?.state ?? 'invalid response').join(', '));

  const exact = run(bin, ['search', ont, 'What is the current title of task-1?',
    '--read']);
  let navigationResult;
  let exactResult;
  try { navigationResult = JSON.parse(navigation.stdout); } catch { navigationResult = null; }
  try { exactResult = JSON.parse(exact.stdout); } catch { exactResult = null; }
  check('search navigates before exact read', navigation.status === 0 && exact.status === 0
    && navigationResult?.matches?.length === 1
    && !navigation.stdout.includes('Ship verified context')
    && exactResult?.evidence?.[0]?.exactText === 'Ship verified context',
  `references ${navigationResult?.matches?.length ?? 0}; exact reads ${exactResult?.evidence?.length ?? 0}`);

const sdkProgram = `globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { openOntology } from 'oont';
import * as kernel from 'oont/kernel';
const ont = openOntology({ artifactRoot: ${JSON.stringify(ont)} });
const keys = Object.keys(ont).sort();
const kernelKeys = Object.keys(kernel).sort();
const result = await ont.verify('What is the current title of task-1?');
const reviewer = generateKeyPairSync('ed25519').publicKey;
const explorer = kernel.openSourceNativeOntExplorer({ artifactRoot: ${JSON.stringify(ont)} }, {
  trustRegistry: [{ issuerId: 'reviewer', publicKeyPem: reviewer.export({ type: 'spki', format: 'pem' }), roles: ['reviewer'] }],
});
assert.equal(typeof explorer.read, 'function');
assert.deepEqual(keys, ['kind','read','search','status','verify']);
assert.deepEqual(kernelKeys, [
    'SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE','SOURCE_NATIVE_PRODUCT_RESOURCE_FILE',
    'bindSourceNativeProductResource','buildSourceNativeProduct',
    'compileProofAuthorityProjection','compileProofSufficiencyContract',
    'compileSourceNativeAdmissionRecord','compileSourceNativeAdmittedKnowledgeBundle',
    'compileSourceNativeConstructionAdmissionRecord',
    'compileSourceNativeCurrentFieldChronologyVerification',
    'compileSourceNativeProofAuthorityProjection',
    'compileSourceNativeSemanticConstruction',
    'compileSourceNativeSemanticKnowledgeBundle',
    'createSourceNativeProductMcpHandler',
    'createSourceNativeProductResource',
    'evaluateProjectionRelationCensus',
    'evaluateProofSufficiencyContract','objectBytesSha256','openObjectOntStore',
    'normalizeCanonicalObjectBackendUri','openCanonicalObjectBackend',
    'openExactProductArtifactState',
    'openProductState','openSourceNativeExactEvidenceSession','openSourceNativeObjectOntIndex',
    'openSourceNativeObjectOntRefIndex',
    'openSourceNativeOntExplorer',
    'openSourceNativeProductRuntime','openSourceNativeProductWithAdmittedKnowledge',
    'openSourceNativeProductWithConstruction',
    'openSourceNativeConstructionReview',
    'productSources','proofAuthorityForProjection','readSourceNativeProductArtifactDescriptor',
    'readSourceNativeConstructionLedger',
    'rebindSourceNativeSemanticConstruction',
    'sourceNativeAdmissionStatement',
    'sourceNativeConstructionAdmissionStatement',
    'sourceNativeConstructionProposalStatement',
    'sourceNativeProposalStatement',
    'stableObjectSha256','stableObjectText','validateProofAuthorityProjection',
    'validateProofSufficiencyContract','validateSourceNativeAdmittedKnowledgeBundle',
    'validateSourceNativeProductResource',
    'validateSourceNativeSemanticConstruction',
    'validateSourceNativeConstructionAdmissionRecord',
    'writeSourceNativeAdmittedKnowledge',
    'writeSourceNativeConstructionAdmission',
  ].sort());
assert.equal(result.answerable, true);
assert.equal(kernel.normalizeCanonicalObjectBackendUri('file:///tmp/oont-installed-backend'),
  'file:///tmp/oont-installed-backend');
const installedBackend = kernel.openCanonicalObjectBackend({
  uri: 'file:///tmp/oont-installed-backend',
  env: {},
});
assert.equal(installedBackend.uri, 'file:///tmp/oont-installed-backend');
assert.equal(installedBackend.capabilities.backend, 'file');
const construction = kernel.compileSourceNativeSemanticConstruction({
  options: { artifactRoot: ${JSON.stringify(ont)} },
  input: { proposedBy: 'constructor', proposedAt: '2026-09-01T00:00:00.000Z',
    method: 'authored', objectDefs: [], claims: [], coverage: [] },
});
assert.equal(construction.reviewRequired, true);
assert.equal(construction.coverage.unexaminedSourceCount, construction.coverage.sourceCount);
assert.deepEqual(kernel.rebindSourceNativeSemanticConstruction({
  options: { artifactRoot: ${JSON.stringify(ont)} },
  construction: JSON.parse(JSON.stringify(construction)),
}), construction);
const historical = await ont.verify({
  question: 'What was the title of task-1?', at: '2026-01-15T00:00:00.000Z',
});
assert.equal(historical.answerable, true);
assert.equal(historical.context[0].exactText, 'Prepare launch');`;
  const sdk = run(process.execPath, ['--input-type=module', '--eval', sdkProgram], { cwd: consumer });
  check('installed SDK verifies offline through one client', sdk.status === 0, tail(sdk.stderr));

  const publicationProgram = `globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openOntology } from 'oont';
import { buildSourceNativeProduct, openProductState } from 'oont/kernel';
const root = ${JSON.stringify(consumer)};
const guide = readFileSync(${JSON.stringify(join(packageRoot, 'docs', 'SOURCE-LIFECYCLE.md'))}, 'utf8');
const input = JSON.parse(guide.match(/\\x60{3}json\\n([\\s\\S]*?)\\n\\x60{3}/u)[1]);
const objectBackendUri = pathToFileURL(join(root, 'conditional-objects')).href;
const build = (name, input, expectedSourceVersion) => buildSourceNativeProduct({
  artifactRoot: join(root, name), objectBackendUri, input, expectedSourceVersion,
});
const initial = build('conditional-initial', input, null);
const initialResult = await openOntology({ artifactRoot: join(root, 'conditional-initial') })
  .verify('What is the current status of ticket T-1?');
assert.equal(initialResult.answerable, true);
assert.equal(initialResult.context[0].exactText, 'open');
const changed = structuredClone(input);
const relativePath = 'tracker/demo/t-1-2026-03-01.txt';
changed.sources.push({ relativePath, sourceType: 'tracker',
  occurredAt: '2026-03-01T00:00:00.000Z', content: 'Ticket T-1 status: closed' });
changed.nativeObjectInputs.push({ relativePath,
  objectIdentity: structuredClone(input.nativeObjectInputs[0].objectIdentity),
  fields: [{ fieldPath: 'status', value: 'closed' }] });
const winner = build('conditional-winner', changed, initial.receipt.refVersion);
const state = openProductState({ artifactRoot: join(root, 'conditional-winner') });
const route = { ontId: input.ontId, branch: input.branch ?? 'main' };
const before = state.store.readRefMetadata(route);
assert.throws(() => build('conditional-delayed', input, initial.receipt.refVersion),
  { code: 'SOURCE_NATIVE_OBJECT_ONT_REF_CONFLICT' });
assert.equal(existsSync(join(root, 'conditional-delayed', 'source-native.json')), false);
assert.deepEqual(state.store.readRefMetadata(route), before);
const replayed = build('conditional-retry', changed, initial.receipt.refVersion);
assert.equal(replayed.receipt.replayed, true);
assert.equal(replayed.receipt.refVersion, winner.receipt.refVersion);
assert.equal(replayed.receipt.commitSha256, winner.receipt.commitSha256);
const result = await openOntology({ artifactRoot: join(root, 'conditional-winner') })
  .verify('What is the current status of ticket T-1?');
assert.equal(result.context[0].exactText, 'closed');
assert.equal(result.verification.sourceCommitSha256, winner.receipt.commitSha256);`;
  const publication = run(process.execPath, ['--input-type=module', '--eval', publicationProgram], { cwd: consumer });
  check('installed authoring example and conditional publication preserve exact context',
    publication.status === 0, tail(publication.stderr, 20));

  const constructionProgram = `globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as kernel from 'oont/kernel';
const options = { artifactRoot: ${JSON.stringify(ont)} };
const state = kernel.openProductState(options);
const object = state.objectOnt.map.nativeObjects[0];
const field = object.fields[0];
const { relativePath: sourceRef, ...span } = field.evidence;
const witness = { nativeObjectSha256: object.nativeObjectSha256, evidence: { sourceRef, ...span } };
const construction = kernel.compileSourceNativeSemanticConstruction({ options, input: {
  proposedBy: 'constructor', proposedAt: '2026-09-01T00:00:00.000Z', method: 'authored',
  objectDefs: [{ kind: 'ObjectDef', id: 'example-label', name: field.value, source: witness, aliases: [] }],
  claims: [{ kind: 'Claim', id: 'label-mention', about: 'example-label', predicate: 'mentions', source: witness }],
  coverage: [{ sourceRef, sourceSha256: span.sourceSha256, disposition: 'examined' }],
} });
const reviewSession = kernel.openSourceNativeConstructionReview({ options, construction });
assert.equal(reviewSession.packet.items.length, 2);
const source = reviewSession.packet.sources.find(source => source.relativePath === sourceRef);
assert.equal(source.content, state.objectOnt.sources.find(source => source.relativePath === sourceRef).content);
const decisions = reviewSession.packet.items.map(item => ({ itemSha256: item.itemSha256,
  decision: 'accept', reason: 'Fixture protocol response, not independent semantic judgment.',
  citations: [{ sourceRef, quote: field.value }] }));
const accepted = reviewSession.evaluate({ packetSha256: reviewSession.packet.packetSha256, decisions });
assert.equal(accepted.disposition, 'accepted');
assert.equal(accepted.admissionGranted, false);
assert.equal('signatureBase64' in accepted, false);
assert.throws(() => reviewSession.evaluate({ packetSha256: reviewSession.packet.packetSha256,
  decisions: decisions.slice(0, 1) }), { code: 'CONSTRUCTION_REVIEW_INCOMPLETE' });
const rejected = reviewSession.evaluate({ packetSha256: reviewSession.packet.packetSha256,
  decisions: decisions.map((item, index) => ({ ...item, decision: index ? 'reject' : 'accept' })) });
assert.equal(rejected.disposition, 'rejected');
const proposer = generateKeyPairSync('ed25519');
const reviewer = generateKeyPairSync('ed25519');
const trustRegistry = [['constructor', proposer, 'proposer'], ['reviewer', reviewer, 'reviewer']]
  .map(([issuerId, pair, role]) => ({ issuerId, roles: [role],
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }) }));
assert.equal(kernel.readSourceNativeConstructionLedger({ options, trustRegistry }).activeRecords.length, 0);
const proposalStatement = kernel.sourceNativeConstructionProposalStatement({ construction });
const statement = kernel.sourceNativeConstructionAdmissionStatement({ construction,
  issuerId: 'reviewer', admittedAt: '2026-09-02T00:00:00.000Z' });
const signature = (value, pair) => sign(null, Buffer.from(kernel.stableObjectText(value)), pair.privateKey).toString('base64');
const record = kernel.compileSourceNativeConstructionAdmissionRecord({ construction, proposalStatement, statement,
  proposalSignatureBase64: signature(proposalStatement, proposer), signatureBase64: signature(statement, reviewer) });
const written = kernel.writeSourceNativeConstructionAdmission({ options, trustRegistry, record });
assert.equal(written.replayed, false);
assert.equal(kernel.writeSourceNativeConstructionAdmission({ options, trustRegistry, record }).replayed, true);
const cold = kernel.readSourceNativeConstructionLedger({ options, trustRegistry });
assert.equal(cold.navigationOnly, true);
assert.equal(cold.state, 'ready');
assert.deepEqual(cold.activeRecords, [record]);
assert.equal(kernel.readSourceNativeConstructionLedger({ options, trustRegistry: trustRegistry.slice(0, 1) }).activeRecords.length, 0);
// Synthetic signed records exercise navigation mechanics, not semantic quality.
for (const [start, count] of [[0, 64], [64, 1]]) {
  const candidate = kernel.compileSourceNativeSemanticConstruction({ options, input: {
    proposedBy: 'constructor', proposedAt: '2026-09-01T00:00:00.000Z', method: 'authored',
    objectDefs: Array.from({ length: count }, (_, index) => ({ kind: 'ObjectDef',
      id: 'repeated-label-' + (start + index), name: field.value, source: witness, aliases: [] })),
    claims: [], coverage: [{ sourceRef, sourceSha256: span.sourceSha256, disposition: 'examined' }],
  } });
  const proposalStatement = kernel.sourceNativeConstructionProposalStatement({ construction: candidate });
  const statement = kernel.sourceNativeConstructionAdmissionStatement({ construction: candidate,
    issuerId: 'reviewer', admittedAt: '2026-09-02T00:00:00.000Z' });
  const record = kernel.compileSourceNativeConstructionAdmissionRecord({ construction: candidate,
    proposalStatement, statement, proposalSignatureBase64: signature(proposalStatement, proposer),
    signatureBase64: signature(statement, reviewer) });
  kernel.writeSourceNativeConstructionAdmission({ options, trustRegistry, record });
}
const browser = kernel.openSourceNativeProductWithConstruction(options, { trustRegistry });
let cursor;
const seen = new Set();
do {
  const page = await browser.search({ term: field.value, limit: 7, ...(cursor ? { cursor } : {}) });
  assert.equal(page.state, 'ambiguous-construction-navigation');
  assert.equal(page.totalConcepts, 66);
  assert.equal(page.totalMatches, 66);
  assert(page.matches.length > 0 && page.matches.length <= 7);
  assert.deepEqual(page.concepts.map(concept => concept.id), page.matches.map(match => match.conceptId));
  for (const match of page.matches) {
    assert.equal(match.requiredForProof, false);
    assert.equal('exactText' in match, false);
    assert.equal(seen.has(match.conceptId), false);
    seen.add(match.conceptId);
    const passage = await browser.read({ ref: match.ref });
    assert.equal(passage.binding.conceptId, match.conceptId);
    assert.equal(passage.exactText, field.value);
    assert.equal('proofDisposition' in passage, false);
  }
  cursor = page.nextCursor;
} while (cursor);
assert.equal(seen.size, 66);
const explorer = kernel.openSourceNativeOntExplorer(options, { trustRegistry });
const explorerStatus = explorer.status();
assert.equal(explorerStatus.kind, 'OpenOntologySourceNativeOntExplorerStatusV1');
assert.equal(explorerStatus.state, 'ready');
assert.equal(explorerStatus.recordCount, 3);
assert.equal(explorerStatus.activeRecordCount, 3);
assert.equal(explorerStatus.binding.sourceCommitSha256, state.objectOnt.commitSha256);
assert.equal(explorerStatus.binding.nativeObjectMapSha256, state.objectOnt.map.nativeObjectMapSha256);
assert.equal(explorerStatus.freshness.state, 'unknown');
assert.equal(explorerStatus.authority.accessMode, 'trusted-whole-ont-kernel');
const explorerNodes = [];
let explorerNodeCursor;
do {
  const page = explorer.nodes({ term: field.value, limit: 64,
    ...(explorerNodeCursor ? { cursor: explorerNodeCursor } : {}) });
  assert.equal(page.kind, 'OpenOntologySourceNativeOntExplorerNodesV1');
  assert.equal(page.totalCount, 66);
  assert(page.nodes.length > 0 && page.nodes.length <= 64);
  explorerNodes.push(...page.nodes);
  explorerNodeCursor = page.nextCursor;
} while (explorerNodeCursor);
assert.equal(explorerNodes.length, 66);
assert.equal(new Set(explorerNodes.map(node => node.id)).size, 66);
const admittedObjectDefNode = explorerNodes.find(node => node.objectDef?.id === 'example-label');
assert(admittedObjectDefNode);
const explorerEdges = explorer.edges({ focusId: admittedObjectDefNode.id, limit: 128 });
assert.equal(explorerEdges.kind, 'OpenOntologySourceNativeOntExplorerEdgesV1');
const claimEdge = explorerEdges.edges.find(edge => edge.kind === 'claim');
assert(claimEdge);
assert.equal(claimEdge.from.startsWith('passage:'), true);
assert.equal(claimEdge.to, admittedObjectDefNode.id);
assert.equal(claimEdge.about, 'example-label');
assert.equal(claimEdge.predicate, 'mentions');
const explorerRecordPage = explorer.records({ limit: 64 });
assert.equal(explorerRecordPage.kind, 'OpenOntologySourceNativeOntExplorerRecordsV1');
assert.equal(explorerRecordPage.totalCount, 3);
assert.equal(explorerRecordPage.records.length, 3);
const admittedRecordPage = explorer.records({ constructionSha256: construction.constructionSha256, limit: 1 });
assert.equal(admittedRecordPage.totalCount, 1);
assert.equal(admittedRecordPage.records[0].recordSha256, record.recordSha256);
const explorerPayload = JSON.stringify({ explorerStatus, explorerNodes, explorerEdges, explorerRecordPage });
assert.equal(explorerPayload.includes(source.content), false);
assert.equal(/exactText|proofDisposition|signatureBase64|sourceText/u.test(explorerPayload), false);
const mcp = kernel.createSourceNativeProductMcpHandler(browser, { profile: 'advanced' });
const listed = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
assert.deepEqual(listed.result.tools.map(tool => tool.name), ['search', 'read']);
assert(listed.result.tools.every(tool => tool.inputSchema.type === 'object'));
const response = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: { name: 'search', arguments: { term: field.value, limit: 7 } } });
assert.equal(response.result.isError, undefined);
const discovered = JSON.parse(response.result.content[0].text);
assert.equal(discovered.state, 'ambiguous-construction-navigation');
assert.equal(discovered.totalConcepts, 66);
assert.equal(discovered.matches.length, 7);
const readResponse = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'read', arguments: { ref: discovered.matches[0].ref } } });
assert.equal(readResponse.result.isError, undefined);
const read = JSON.parse(readResponse.result.content[0].text);
assert.equal(read.exactText, field.value);
assert.equal(read.binding.navigationOnly, true);
assert.equal('proofDisposition' in read, false);
const passage = explorer.nodes({ ids: [claimEdge.from] }).nodes[0];
const currentExact = explorer.read({ ref: passage.readRef });
assert.equal(currentExact.exactText, field.value);
assert.equal(currentExact.historicalSnapshot, false);
assert.equal(currentExact.currentNavigationEligible, true);
assert.equal(currentExact.binding.navigationOnly, true);
assert.equal(currentExact.binding.exactSourcesRemainAuthority, true);
assert.equal('conceptId' in currentExact.binding, false);
assert.equal('proofDisposition' in currentExact, false);
const history = kernel.openSourceNativeOntExplorer(options, { trustRegistry,
  snapshot: admittedRecordPage.binding, recordSha256: record.recordSha256 });
const historicalNodes = [];
let historyCursor;
do {
  const page = history.nodes({ limit: 1, ...(historyCursor ? { cursor: historyCursor } : {}) });
  assert.equal(page.historicalSnapshot, true);
  assert.equal(page.currentNavigationEligible, false);
  assert(page.nodes.length > 0);
  historicalNodes.push(...page.nodes);
  historyCursor = page.nextCursor;
  if (!historyCursor) assert.equal(historicalNodes.length, page.totalCount);
} while (historyCursor);
const historicalPassage = historicalNodes.find(node => node.id === claimEdge.from);
assert(historicalPassage?.readRef);
const historicalExact = history.read({ ref: historicalPassage.readRef });
assert.equal(historicalExact.exactText, field.value);
assert.equal(historicalExact.historicalSnapshot, true);
assert.equal(historicalExact.currentNavigationEligible, false);
assert.equal(historicalExact.binding.admissionRecordSha256, record.recordSha256);
assert.equal(historicalExact.receiptSha256,
  kernel.stableObjectSha256({ ...historicalExact, receiptSha256: undefined }));
assert.equal(history.records().records[0].state, 'active');
assert(history.edges().edges.some(edge => edge.id === claimEdge.id));
assert.throws(() => explorer.read({ ref: historicalPassage.readRef }),
  { code: 'SOURCE_NATIVE_EXPLORER_REFERENCE' });
assert.throws(() => history.read({ ref: passage.readRef }),
  { code: 'SOURCE_NATIVE_EXPLORER_REFERENCE' });
await assert.rejects(() => browser.read({ ref: historicalPassage.readRef }));
const correctionStatement = kernel.sourceNativeConstructionAdmissionStatement({ construction,
  issuerId: 'reviewer', admittedAt: '2026-09-03T00:00:00.000Z',
  supersedesRecordSha256s: [record.recordSha256] });
const correctionRecord = kernel.compileSourceNativeConstructionAdmissionRecord({ construction, proposalStatement,
  statement: correctionStatement, proposalSignatureBase64: signature(proposalStatement, proposer),
  signatureBase64: signature(correctionStatement, reviewer) });
kernel.writeSourceNativeConstructionAdmission({ options, trustRegistry, record: correctionRecord });
assert.throws(() => explorer.read({ ref: passage.readRef }),
  { code: 'SOURCE_NATIVE_EXPLORER_REFERENCE_STALE' });
assert.equal(history.read({ ref: historicalPassage.readRef }).exactText, field.value);
assert.equal(history.status().currentNavigationEligible, false);
const supersededPage = explorer.records({ state: 'superseded' });
assert.equal(supersededPage.records[0].recordSha256, record.recordSha256);
const superseded = kernel.openSourceNativeOntExplorer(options, { trustRegistry,
  snapshot: supersededPage.binding, recordSha256: record.recordSha256 });
const supersededPassage = superseded.nodes({ ids: [claimEdge.from] }).nodes[0];
assert.equal(superseded.records().records[0].state, 'superseded');
assert.equal(superseded.read({ ref: supersededPassage.readRef }).exactText, field.value);`;
  const constructionSmoke = run(process.execPath, ['--input-type=module', '--eval', constructionProgram], { cwd: consumer });
  check('installed construction, MCP and current/historical explorer reads stay source-bound',
    constructionSmoke.status === 0, tail(constructionSmoke.stderr, 20));

  const lifecycleExample = join(packageRoot, 'examples', 'quickstart', 'source-lifecycle.mjs');
  const lifecycleGuide = join(packageRoot, 'docs', 'SOURCE-LIFECYCLE.md');
  const lifecycleRoot = join(consumer, 'source-lifecycle');
  const noNetwork = 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("NETWORK_FORBIDDEN")}';
  const runLifecycle = (outputRoot) => run(process.execPath, [
    '--import', noNetwork, lifecycleExample, outputRoot,
  ], { cwd: consumer });
  for (const [name, outputRoot] of [['first run', lifecycleRoot],
    ['independent second run', join(consumer, 'source-lifecycle-second')]]) {
    const execution = runLifecycle(outputRoot);
    let summary;
    try { summary = JSON.parse(execution.stdout); } catch { summary = null; }
    check(`installed source lifecycle ${name}`, execution.status === 0
      && existsSync(lifecycleGuide)
      && summary?.kind === 'OpenOntologySourceLifecycleWalkthroughV1'
      && summary?.outputRoot === outputRoot
      && summary?.initial?.value === 'Ship verified context'
      && summary?.updated?.value === 'Keep context current'
      && /^sha256:[0-9a-f]{64}$/u.test(summary?.initial?.sourceCommitSha256 ?? '')
      && /^sha256:[0-9a-f]{64}$/u.test(summary?.updated?.sourceCommitSha256 ?? '')
      && summary.initial.sourceCommitSha256 !== summary.updated.sourceCommitSha256
      && summary?.searchRead?.value === 'Ship verified context'
      && summary?.refusal?.state === 'unavailable-native-field-not-declared'
      && summary?.refusal?.contextCount === 0
      && summary?.staleOpen?.code === 'SOURCE_NATIVE_PRODUCT_REF',
    execution.status === 0 ? JSON.stringify(summary) : tail(execution.stderr));
  }
  const beforeRerun = existsSync(lifecycleRoot) ? directorySnapshot(lifecycleRoot) : null;
  const rerun = runLifecycle(lifecycleRoot);
  check('installed lifecycle refuses existing output without changing bytes',
    beforeRerun !== null && rerun.status !== 0
      && existsSync(lifecycleRoot) && beforeRerun === directorySnapshot(lifecycleRoot),
    tail(rerun.stderr));

  const semanticRoot = join(consumer, 'semantic-map');
  const semanticExample = join(packageRoot, 'examples', 'quickstart', 'semantic-map.mjs');
  const runSemantic = () => run(process.execPath, ['--import', noNetwork, semanticExample, semanticRoot], { cwd: consumer });
  const semanticRun = runSemantic();
  let semanticSummary;
  try { semanticSummary = JSON.parse(semanticRun.stdout); } catch { semanticSummary = null; }
  check('installed concept map discovers, reads, verifies, corrects and cold-reopens', semanticRun.status === 0
    && semanticSummary?.kind === 'OpenOntologySemanticMapWalkthroughV1'
    && semanticSummary?.initialMatches === 2 && semanticSummary?.correctedMatches === 1
    && semanticSummary?.selectedObject === 'CT-17' && semanticSummary?.exactStatus === 'open'
    && semanticSummary?.semanticReviewQualified === false,
    semanticRun.status === 0 ? semanticRun.stdout.trim() : tail(semanticRun.stderr));
  const beforeSemanticRerun = existsSync(semanticRoot) ? directorySnapshot(semanticRoot) : null;
  const semanticRerun = runSemantic();
  check('installed concept-map example preserves existing output', beforeSemanticRerun !== null
    && semanticRerun.status !== 0 && beforeSemanticRerun === directorySnapshot(semanticRoot), tail(semanticRerun.stderr));

  const ordinaryMcp = await mcpTools(bin, ont, false);
  check('default MCP exposes only verify', ordinaryMcp.ok
    && JSON.stringify(ordinaryMcp.names) === JSON.stringify(['verify']),
  ordinaryMcp.ok ? ordinaryMcp.names.join(',') : ordinaryMcp.detail);

  const advancedMcp = await mcpTools(bin, ont, true);
  check('advanced MCP exposes search and read', advancedMcp.ok
    && JSON.stringify(advancedMcp.names) === JSON.stringify(['search', 'read']),
  advancedMcp.ok ? advancedMcp.names.join(',') : advancedMcp.detail);

  const publish = run('npm', ['publish', '--dry-run', '--tag', 'next', '--access', 'public'], {
    cwd: root,
  });
  check('npm publish dry-run', publish.status === 0, tail(publish.stderr));
} finally {
  if (keep) process.stdout.write(`kept ${sandbox}\n`);
  else rmSync(sandbox, { recursive: true, force: true });
}

process.stdout.write(`\n${ordinal - failures}/${ordinal} checks passed.\n`);
process.exit(failures === 0 ? 0 : 1);
