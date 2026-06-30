import { encode } from 'gpt-tokenizer'

const DEFAULT_MAX_TOKENS = 512

function countTokens(text: string): number {
  return encode(text, { allowedSpecial: 'all' }).length
}

// Extract Markdown structure boundaries to avoid splitting tables/code blocks
function getMarkdownBlocks(text: string): string[] {
  const blocks: string[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    // Code block: ```...```
    if (lines[i].trimStart().startsWith('```')) {
      const block: string[] = [lines[i]]
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        block.push(lines[i])
        i++
      }
      if (i < lines.length) { block.push(lines[i]); i++ }
      blocks.push(block.join('\n'))
      continue
    }

    // Table: lines starting with |
    if (lines[i].trimStart().startsWith('|')) {
      const block: string[] = [lines[i]]
      i++
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        block.push(lines[i])
        i++
      }
      blocks.push(block.join('\n'))
      continue
    }

    // Heading or paragraph — collect until next structural boundary
    const block: string[] = [lines[i]]
    i++
    while (i < lines.length) {
      const t = lines[i].trimStart()
      if (t.startsWith('```') || t.startsWith('|') || t.startsWith('#') || t === '') break
      block.push(lines[i])
      i++
    }
    // Skip consecutive blank lines as separators
    while (i < lines.length && lines[i].trim() === '') i++
    blocks.push(block.join('\n'))
  }

  return blocks.filter((b) => b.trim())
}

function mergeSmallBlocks(blocks: string[], minTokens: number): string[] {
  const result: string[] = []
  let buffer = ''
  for (const block of blocks) {
    if (buffer) {
      const merged = buffer + '\n\n' + block
      if (countTokens(merged) <= DEFAULT_MAX_TOKENS) {
        buffer = merged
        continue
      }
      result.push(buffer.trim())
      buffer = block
    } else {
      buffer = block
    }
    if (countTokens(buffer) >= minTokens) {
      result.push(buffer.trim())
      buffer = ''
    }
  }
  if (buffer.trim()) result.push(buffer.trim())
  return result
}

function forceSplit(text: string): string[] {
  // Last resort: split a very long single block by character count
  if (countTokens(text) <= DEFAULT_MAX_TOKENS) return [text]
  const sentences = text.split(/(?<=[。.!?！？])\s*/)
  const result: string[] = []
  let buf = ''
  for (const s of sentences) {
    const candidate = buf ? buf + ' ' + s : s
    if (countTokens(candidate) <= DEFAULT_MAX_TOKENS) {
      buf = candidate
    } else {
      if (buf) result.push(buf.trim())
      buf = s
    }
  }
  if (buf.trim()) result.push(buf.trim())
  return result
}

export function splitText(text: string, maxTokens: number = DEFAULT_MAX_TOKENS): string[] {
  if (!text || !text.trim()) return []
  const blocks = getMarkdownBlocks(text)
  const merged = mergeSmallBlocks(blocks, Math.max(1, Math.floor(maxTokens / 2)))
  // Force-split any remaining oversized blocks
  const result: string[] = []
  for (const b of merged) {
    if (countTokens(b) > maxTokens) {
      result.push(...forceSplit(b))
    } else {
      result.push(b)
    }
  }
  return result.filter(Boolean)
}
