import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'

function postJson(
  apiBase: string,
  apiKey: string,
  body: unknown,
  timeout = 30_000
): Promise<Record<string, unknown>> {
  const parsed = new URL(apiBase)
  const isHttps = parsed.protocol === 'https:'
  const mod = isHttps ? https : http
  const payload = JSON.stringify(body)

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(payload)
    }
  }

  return new Promise((resolve, reject) => {
    const req = mod.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        if (!data) return reject(new Error(`Empty response (HTTP ${res.statusCode})`))
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error(`Invalid JSON (HTTP ${res.statusCode}): ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', (err) => reject(err))
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Request timed out')) })
    req.write(payload)
    req.end()
  })
}

export async function embedTexts(
  texts: string[],
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<number[][]> {
  const apiBase = baseUrl.replace(/\/+$/, '')
  const result = await postJson(apiBase, apiKey, { model, input: texts })
  if (result.error) throw new Error((result.error as any)?.message || 'Embedding API error')
  const data = result.data as Array<{ embedding: number[] }> | undefined
  if (!data || !Array.isArray(data)) throw new Error('Invalid embedding response')
  return data.map((item) => item.embedding)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export interface ChunkWithEmbedding {
  id: string
  content: string
  embedding: number[]
}

export function searchByEmbedding(
  queryEmbedding: number[],
  chunks: ChunkWithEmbedding[],
  topK: number
): Array<ChunkWithEmbedding & { score: number }> {
  return chunks
    .map((c) => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export interface RerankResult {
  content: string
  score: number
  index: number
}

export async function rerankDocuments(
  query: string,
  documents: string[],
  apiKey: string,
  baseUrl: string,
  model: string,
  topN: number
): Promise<RerankResult[]> {
  const apiBase = baseUrl.replace(/\/+$/, '')
  let result: Record<string, unknown>

  // qwen3-rerank: params at top level, no input/parameters wrapper
  result = await postJson(apiBase, apiKey, {
    model,
    query,
    documents,
    top_n: topN
  }, 30_000)

  if (result.error) throw new Error((result.error as any)?.message || (result as any)?.message || 'Rerank API error')

  // qwen3-rerank: results at top level
  let results = (result.results || (result.output as any)?.results) as Array<{
    index: number
    relevance_score: number
    document?: { text: string }
  }> | undefined

  if (!results || !Array.isArray(results)) {
    throw new Error(`Invalid rerank response: ${JSON.stringify(result).slice(0, 200)}`)
  }

  return results
    .filter((r) => r.relevance_score != null)
    .map((r) => ({
      content: r.document?.text || documents[r.index] || '',
      score: r.relevance_score,
      index: r.index
    }))
    .sort((a, b) => b.score - a.score)
}
