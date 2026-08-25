// Module 4: similarity scoring between two embedding vectors.
// Our vectors are already normalized (pooling: "mean", normalize: true in
// the embedding step), so cosine similarity reduces to a plain dot product —
// but we compute it the general way here so this keeps working even if that
// assumption ever changes.

export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
