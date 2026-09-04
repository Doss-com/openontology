/** Small deterministic BM25 inverted index. Candidate generation only, never Evidence or truth. */
const DEFAULTS = Object.freeze({ k1: 1.2, b: 0.75 });

export const bm25Tokens = (text) =>
  String(text ?? '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];

export function createBm25Index(documents, {
  idOf = (row) => row.id,
  textOf = (row) => row.text,
  tokenize = bm25Tokens,
  k1 = DEFAULTS.k1,
  b = DEFAULTS.b,
} = {}) {
  if (!Array.isArray(documents)
    || typeof idOf !== 'function'
    || typeof textOf !== 'function'
    || typeof tokenize !== 'function'
    || !Number.isFinite(k1) || k1 <= 0
    || !Number.isFinite(b) || b < 0 || b > 1) {
    throw new TypeError('documents/options');
  }

  const rows = [];
  const postings = new Map();
  const seen = new Set();
  let totalLength = 0;

  for (const [ordinal, document] of documents.entries()) {
    const id = idOf(document);
    if (typeof id !== 'string' || !id || seen.has(id)) {
      throw new TypeError(`document id ${ordinal}`);
    }
    seen.add(id);

    const tokens = tokenize(textOf(document));
    const frequency = new Map();
    for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);

    const row = { id, document, tokens, frequency, ordinal };
    rows.push(row);
    totalLength += tokens.length;
    for (const token of frequency.keys()) {
      const posting = postings.get(token) ?? [];
      posting.push(ordinal);
      postings.set(token, posting);
    }
  }

  const averageLength = rows.length ? totalLength / rows.length : 0;
  const documentFrequency = new Map(
    [...postings].map(([token, posting]) => [token, posting.length]),
  );
  const score = (row, queryTokens) => {
    let value = 0;
    for (const token of queryTokens) {
      const termFrequency = row.frequency.get(token) ?? 0;
      if (!termFrequency) continue;
      const matchingDocuments = documentFrequency.get(token) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 + (rows.length - matchingDocuments + 0.5) / (matchingDocuments + 0.5),
      );
      const denominator = termFrequency
        + k1 * (1 - b + b * row.tokens.length / (averageLength || 1));
      value += inverseDocumentFrequency * termFrequency * (k1 + 1) / denominator;
    }
    return value;
  };

  return Object.freeze({
    schema: 1,
    kind: 'Bm25IndexV1',
    count: rows.length,
    k1,
    b,
    averageLength,
    rank(query, { limit = 10 } = {}) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('limit');
      const queryTokens = [...new Set(tokenize(query))];
      const ordinals = new Set();
      for (const token of queryTokens) {
        for (const ordinal of postings.get(token) ?? []) ordinals.add(ordinal);
      }
      return [...ordinals]
        .map((ordinal) => {
          const row = rows[ordinal];
          return { id: row.id, score: score(row, queryTokens), document: row.document };
        })
        .filter((row) => row.score > 0)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, limit);
    },
    stats() {
      return { documents: rows.length, terms: postings.size, averageLength, k1, b };
    },
  });
}
