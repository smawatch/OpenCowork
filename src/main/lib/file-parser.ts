/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const { convertToMarkdown } = require('@cognipeer/to-markdown')

function normalizeMarkdown(md: string): string {
  let result = md
    .replace(/\s*\|\s*\|\s*/g, '\n| ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  for (let i = 0; i < 5; i++) {
    const prev = result
    result = result.replace(/([一-鿿㐀-䶿])\s+([一-鿿㐀-䶿])/g, '$1$2')
    if (result === prev) break
  }
  return result
}

export async function parseFileText(filePath: string): Promise<string> {
  const md = await convertToMarkdown(filePath)
  return normalizeMarkdown(md ?? '')
}
