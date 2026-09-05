#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync,
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
const exactText: string | undefined = read?.exactText;
void query;
void status;
void state;
void exactText;
// @ts-expect-error artifactRoot is required for a typed caller.
openOntology();
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
  writeFileSync(kernelContractPath, `import {
  compileProofSufficiencyContract,
  evaluateProofSufficiencyContract,
  openSourceNativeExactEvidenceSession,
  openSourceNativeObjectOntIndex,
  openSourceNativeProductRuntime,
  openSourceNativeProductWithAdmittedKnowledge,
  stableObjectSha256,
  type ExactSessionOptions,
  type OpenSourceNativeObjectOntOptions,
  type ProofSufficiencyContract,
  type ProofSufficiencyEvaluation,
  type SourceNativeAdmittedKnowledgeProduct,
  type SourceNativeAdmittedKnowledgeContext,
  type SourceNativeAdmittedKnowledgeLedgerStatus,
  type SourceNativeAdmittedKnowledgeVerificationResult,
  type SourceNativeAdmittedProofBinding,
  type SourceNativeAdmissionTrustEntry,
  type SourceNativeAdmissionTrustRole,
  type SourceNativeProductRuntimeContext,
} from 'oont/kernel';

const digest: string = stableObjectSha256({ contract: 'kernel' });
const openRuntime: typeof openSourceNativeProductRuntime = openSourceNativeProductRuntime;
const openAdmitted: typeof openSourceNativeProductWithAdmittedKnowledge =
  openSourceNativeProductWithAdmittedKnowledge;
const context: SourceNativeProductRuntimeContext | null = null;
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

  const navigation = run(bin, ['search', ont, 'What is the current title of task-1?']);
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
import { openOntology } from 'oont';
import * as kernel from 'oont/kernel';
const ont = openOntology({ artifactRoot: ${JSON.stringify(ont)} });
const keys = Object.keys(ont).sort();
const kernelKeys = Object.keys(kernel).sort();
const result = await ont.verify('What is the current title of task-1?');
if (JSON.stringify(keys) !== JSON.stringify(['kind','read','search','status','verify'])
  || JSON.stringify(kernelKeys) !== JSON.stringify([
    'SOURCE_NATIVE_PRODUCT_ARTIFACT_FILE','buildSourceNativeProduct',
    'compileProofAuthorityProjection','compileProofSufficiencyContract',
    'compileSourceNativeAdmissionRecord','compileSourceNativeAdmittedKnowledgeBundle',
    'evaluateProjectionRelationCensus',
    'evaluateProofSufficiencyContract','objectBytesSha256','openObjectOntStore',
    'openProductState','openSourceNativeExactEvidenceSession','openSourceNativeObjectOntIndex',
    'openSourceNativeProductRuntime','openSourceNativeProductWithAdmittedKnowledge',
    'productSources','proofAuthorityForProjection','sourceNativeAdmissionStatement',
    'sourceNativeProposalStatement',
    'stableObjectSha256','stableObjectText','validateProofAuthorityProjection',
    'validateProofSufficiencyContract','validateSourceNativeAdmittedKnowledgeBundle',
    'writeSourceNativeAdmittedKnowledge',
  ]) || !result.answerable) process.exit(1);`;
  const sdk = run(process.execPath, ['--input-type=module', '--eval', sdkProgram], { cwd: consumer });
  check('installed SDK verifies offline through one client', sdk.status === 0, tail(sdk.stderr));

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
