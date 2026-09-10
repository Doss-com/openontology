/** Shared Ed25519 authentication and trust-role validation for Admission records. */
import { createPublicKey, verify as verifySignature } from 'node:crypto';

import { stableObjectText } from './canonical-content.mjs';
import type { CanonicalJsonValue } from './canonical-content.mjs';

export type SourceNativeAdmissionTrustRole = 'proposer' | 'reviewer';

export interface SourceNativeAdmissionTrustEntry {
  issuerId: string;
  publicKeyPem: string;
  roles: readonly SourceNativeAdmissionTrustRole[];
}

export interface TrustedAdmissionKey {
  key: ReturnType<typeof createPublicKey>;
  roles: ReadonlySet<SourceNativeAdmissionTrustRole>;
}

export type AdmissionTrustRegistry = Map<string, TrustedAdmissionKey>;

type AdmissionSignatureAuthenticationInput = {
  proposerId: string;
  issuerId: string;
  proposalStatement: CanonicalJsonValue;
  statement: CanonicalJsonValue;
  proposalSignatureBase64: unknown;
  signatureBase64: unknown;
};

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const compare = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(String(left)), Buffer.from(String(right)));
const fail = (code: string): never => {
  const error = new TypeError(code) as TypeError & { code: string };
  error.code = code;
  throw error;
};
const nonempty = (value: unknown, code: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fail(code);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[], code: string): void => {
  if (Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
};
const plain = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

export function canonicalAdmissionSignature(value: unknown): string {
  const signature = typeof value === 'string' && value.length > 0 && BASE64.test(value)
    ? value : fail('SOURCE_NATIVE_ADMISSION_SIGNATURE');
  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== signature) {
    fail('SOURCE_NATIVE_ADMISSION_SIGNATURE');
  }
  return signature;
}

export function admissionTrustRegistry(value: unknown): AdmissionTrustRegistry {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    fail('SOURCE_NATIVE_ADMISSION_TRUST');
  }
  const entries: unknown[] = Array.isArray(value) ? value : fail('SOURCE_NATIVE_ADMISSION_TRUST');
  const registry: AdmissionTrustRegistry = new Map<string, TrustedAdmissionKey>();
  for (const entryInput of entries) {
    const entry = plain(entryInput) ? entryInput : fail('SOURCE_NATIVE_ADMISSION_TRUST');
    exactKeys(entry, ['issuerId', 'publicKeyPem', 'roles'], 'SOURCE_NATIVE_ADMISSION_TRUST');
    const issuerId = nonempty(entry.issuerId, 'SOURCE_NATIVE_ADMISSION_TRUST');
    const publicKeyPem = nonempty(entry.publicKeyPem, 'SOURCE_NATIVE_ADMISSION_TRUST');
    const roleRows: unknown[] = Array.isArray(entry.roles)
      ? entry.roles : fail('SOURCE_NATIVE_ADMISSION_TRUST');
    const roles = roleRows.map((role): SourceNativeAdmissionTrustRole =>
      role === 'proposer' || role === 'reviewer'
        ? role : fail('SOURCE_NATIVE_ADMISSION_TRUST')).sort(compare);
    const key: ReturnType<typeof createPublicKey> = (() => {
      try { return createPublicKey(publicKeyPem); } catch {
        return fail('SOURCE_NATIVE_ADMISSION_TRUST');
      }
    })();
    if (key.asymmetricKeyType !== 'ed25519' || registry.has(issuerId)
      || roles.length < 1 || new Set(roles).size !== roles.length) {
      fail('SOURCE_NATIVE_ADMISSION_TRUST');
    }
    registry.set(issuerId, { key, roles: new Set(roles) });
  }
  return registry;
}

export function authenticateAdmissionSignatures({
  proposerId,
  issuerId,
  proposalStatement,
  statement,
  proposalSignatureBase64,
  signatureBase64,
}: AdmissionSignatureAuthenticationInput, registry: AdmissionTrustRegistry): void {
  const proposalSignature = canonicalAdmissionSignature(proposalSignatureBase64);
  const signature = canonicalAdmissionSignature(signatureBase64);
  const proposer = registry.get(proposerId);
  const reviewer = registry.get(issuerId);
  const proposerKey = proposer?.key;
  const reviewerKey = reviewer?.key;
  const sameKey = proposerKey !== undefined && reviewerKey !== undefined
    && Buffer.from(proposerKey.export({ type: 'spki', format: 'der' }))
      .equals(Buffer.from(reviewerKey.export({ type: 'spki', format: 'der' })));
  if (proposerKey === undefined || reviewerKey === undefined
    || proposer?.roles.has('proposer') !== true
    || reviewer?.roles.has('reviewer') !== true || sameKey
    || !verifySignature(
      null,
      Buffer.from(stableObjectText(proposalStatement)),
      proposerKey,
      Buffer.from(proposalSignature, 'base64'),
    )
    || !verifySignature(
      null,
      Buffer.from(stableObjectText(statement)),
      reviewerKey,
      Buffer.from(signature, 'base64'),
    )) fail('SOURCE_NATIVE_ADMISSION_AUTHENTICATION');
}
