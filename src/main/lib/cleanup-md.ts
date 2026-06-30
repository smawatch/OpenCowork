import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'

const CLEANUP_PROMPT = `You are a Markdown formatter. Fix the following raw Markdown:

1. Fix broken tables: merge concatenated rows, align columns, fix missing separators
2. Remove extra spaces between CJK characters (Chinese/Japanese/Korean)
3. Fix broken headings and lists
4. Preserve ALL original content — do not add, remove, or rewrite any information
5. Return ONLY the cleaned Markdown, no explanations`

function callChatAPI(
  apiKey: string,
  apiBase: string,
  model: string,
  content: string
): Promise<string> {
  const parsed = new URL(apiBase)
  const isHttps = parsed.protocol === 'https:'
  const mod = isHttps ? https : http
  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: CLEANUP_PROMPT },
      { role: 'user', content }
    ],
    temperature: 0,
    max_tokens: 4096,
    enable_thinking: false
  })

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
        try {
          const json = JSON.parse(data)
          const text = json?.choices?.[0]?.message?.content
          if (text) resolve(text)
          else reject(new Error(json?.error?.message || 'LLM returned empty response'))
        } catch {
          reject(new Error(`Invalid API response: ${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', (err) => reject(err))
    req.setTimeout(300_000, () => { req.destroy(); reject(new Error('LLM cleanup timed out')) })
    req.write(payload)
    req.end()
  })
}

export async function cleanupMarkdown(
  rawMd: string,
  apiKey: string,
  apiBase: string,
  model: string
): Promise<string> {
  if (!apiKey) return rawMd
  if (rawMd.length < 200) return rawMd

  const cleanBase = apiBase.replace(/\/+$/, '')
  const chatUrl = cleanBase.endsWith('/chat/completions')
    ? cleanBase
    : cleanBase.endsWith('/v1')
      ? `${cleanBase}/chat/completions`
      : `${cleanBase}/v1/chat/completions`

  const cleaned = await callChatAPI(apiKey, chatUrl, model, rawMd)
  return cleaned
}
