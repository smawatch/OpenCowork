export interface KnowledgeRoute {
  kind: 'list' | 'detail'
  kbId: string | null
}

export function parseKnowledgeRoute(hash: string): KnowledgeRoute {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const path = raw.trim()
  if (!path || path === '/' || path === '/knowledge') return { kind: 'list', kbId: null }

  const segments = path.split('/').filter(Boolean)
  if (segments[0] === 'knowledge' && segments[1]) {
    return { kind: 'detail', kbId: decodeURIComponent(segments[1]) }
  }

  return { kind: 'list', kbId: null }
}

export function buildKnowledgeRoute(kbId: string): string {
  return `#/knowledge/${encodeURIComponent(kbId)}`
}

export function goToKnowledgeList(): void {
  window.location.hash = '#/knowledge'
}

export function goToKnowledgeDetail(kbId: string): void {
  window.location.hash = buildKnowledgeRoute(kbId)
}
