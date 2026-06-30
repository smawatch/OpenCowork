import { getDb } from './database'
import { nanoid } from 'nanoid'
import { splitText } from '../lib/chunker'

export interface LocalKbDocumentRow {
  id: string
  title: string
  created_at: number
  updated_at: number
}

export interface LocalKbChunkRow {
  id: string
  document_id: string
  content: string
  chunk_index: number
}

export interface LocalKbChunkWithEmbedding extends LocalKbChunkRow {
  embedding?: number[]
}

export function createLocalDocument(title: string, content: string): LocalKbDocumentRow {
  const now = Date.now()
  const docId = nanoid()
  const chunks = splitText(content)

  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO local_kb_documents (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(docId, title, now, now)

    const chunkStmt = db.prepare(
      'INSERT INTO local_kb_chunks (id, document_id, content, chunk_index) VALUES (?, ?, ?, ?)'
    )
    chunks.forEach((chunkContent, i) => {
      chunkStmt.run(nanoid(), docId, chunkContent, i)
    })
  })
  tx()

  return { id: docId, title, created_at: now, updated_at: now }
}

export function listLocalDocuments(): (LocalKbDocumentRow & { chunk_count: number })[] {
  return getDb()
    .prepare(
      `SELECT d.*,
         (SELECT COUNT(*) FROM local_kb_chunks c WHERE c.document_id = d.id) AS chunk_count
       FROM local_kb_documents d ORDER BY d.updated_at DESC`
    )
    .all() as (LocalKbDocumentRow & { chunk_count: number })[]
}

export function getLocalDocument(id: string): LocalKbDocumentRow | undefined {
  return getDb()
    .prepare('SELECT * FROM local_kb_documents WHERE id = ?')
    .get(id) as LocalKbDocumentRow | undefined
}

export function listLocalChunks(documentId: string): LocalKbChunkRow[] {
  return getDb()
    .prepare('SELECT * FROM local_kb_chunks WHERE document_id = ? ORDER BY chunk_index')
    .all(documentId) as LocalKbChunkRow[]
}

export function deleteLocalDocument(id: string): boolean {
  const result = getDb().prepare('DELETE FROM local_kb_documents WHERE id = ?').run(id)
  return result.changes > 0
}

export function replaceDocumentChunks(documentId: string, content: string): void {
  const chunks = splitText(content)
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM local_kb_chunks WHERE document_id = ?').run(documentId)
    db.prepare('UPDATE local_kb_documents SET updated_at = ? WHERE id = ?').run(Date.now(), documentId)
    const stmt = db.prepare(
      'INSERT INTO local_kb_chunks (id, document_id, content, chunk_index) VALUES (?, ?, ?, ?)'
    )
    chunks.forEach((chunkContent, i) => {
      stmt.run(nanoid(), documentId, chunkContent, i)
    })
  })
  tx()
}

// In-memory import/cleanup status tracker
const cleaningStatus = new Map<string, string>()

export function setCleaningStatus(docId: string, status: string): void {
  cleaningStatus.set(docId, status)
}

export function getCleaningStatus(docId: string): string | undefined {
  return cleaningStatus.get(docId)
}

export function searchLocalDocuments(query: string): (LocalKbChunkRow & { document_title: string })[] {
  const pattern = `%${query}%`
  return getDb()
    .prepare(
      `SELECT c.*, d.title AS document_title
       FROM local_kb_chunks c
       JOIN local_kb_documents d ON c.document_id = d.id
       WHERE c.content LIKE ? OR d.title LIKE ?
       ORDER BY d.updated_at DESC`
    )
    .all(pattern, pattern) as (LocalKbChunkRow & { document_title: string })[]
}

export function saveChunkEmbedding(id: string, embedding: number[]): void {
  const buf = Buffer.from(new Float32Array(embedding).buffer)
  getDb().prepare('UPDATE local_kb_chunks SET embedding = ? WHERE id = ?').run(buf, id)
}

export function getChunksWithEmbeddings(documentId: string): LocalKbChunkWithEmbedding[] {
  const rows = getDb()
    .prepare('SELECT * FROM local_kb_chunks WHERE document_id = ? AND embedding IS NOT NULL ORDER BY chunk_index')
    .all(documentId) as (LocalKbChunkRow & { embedding: Buffer | null })[]

  return rows.map((r) => ({
    id: r.id,
    document_id: r.document_id,
    content: r.content,
    chunk_index: r.chunk_index,
    embedding: r.embedding ? Array.from(new Float32Array(new Uint8Array(r.embedding).buffer)) : undefined
  }))
}

export function getAllChunksWithEmbeddings(): LocalKbChunkWithEmbedding[] {
  const rows = getDb()
    .prepare('SELECT * FROM local_kb_chunks WHERE embedding IS NOT NULL ORDER BY document_id, chunk_index')
    .all() as (LocalKbChunkRow & { embedding: Buffer | null })[]

  return rows.map((r) => ({
    id: r.id,
    document_id: r.document_id,
    content: r.content,
    chunk_index: r.chunk_index,
    embedding: r.embedding ? Array.from(new Float32Array(new Uint8Array(r.embedding).buffer)) : undefined
  }))
}

export function getDocumentEmbeddedCount(documentId: string): number {
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS cnt FROM local_kb_chunks WHERE document_id = ? AND embedding IS NOT NULL'
    )
    .get(documentId) as { cnt: number }
  return row?.cnt ?? 0
}

export function getChunksWithoutEmbeddings(documentId: string): LocalKbChunkRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM local_kb_chunks WHERE document_id = ? AND embedding IS NULL ORDER BY chunk_index'
    )
    .all(documentId) as LocalKbChunkRow[]
}
