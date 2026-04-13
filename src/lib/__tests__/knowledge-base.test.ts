import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeBaseTestState = vi.hoisted(() => ({
  hermesHome: '',
  homeDir: '',
}))

vi.mock('@/lib/hermes-bootstrap', () => ({
  getHermesCommandContext: vi.fn(() => ({
    hermesHome: knowledgeBaseTestState.hermesHome,
    homeDir: knowledgeBaseTestState.homeDir,
    binCandidates: ['hermes'],
    pathPrefix: '',
  })),
}))

describe('knowledge base resolver', () => {
  let tempHomeDir = ''

  beforeEach(() => {
    tempHomeDir = mkdtempSync(path.join(os.tmpdir(), 'mc-kb-'))
    knowledgeBaseTestState.homeDir = tempHomeDir
    knowledgeBaseTestState.hermesHome = path.join(tempHomeDir, '.hermes')
    mkdirSync(knowledgeBaseTestState.hermesHome, { recursive: true })
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(tempHomeDir, { recursive: true, force: true })
    knowledgeBaseTestState.hermesHome = ''
    knowledgeBaseTestState.homeDir = ''
    vi.resetModules()
  })

  it('prefers profile LLM_WIKI_PATH over config and legacy fallbacks', async () => {
    const envWiki = path.join(tempHomeDir, 'env-wiki')
    const configWiki = path.join(tempHomeDir, 'config-wiki')
    mkdirSync(envWiki, { recursive: true })
    mkdirSync(configWiki, { recursive: true })
    writeFileSync(path.join(knowledgeBaseTestState.hermesHome, '.env'), `LLM_WIKI_PATH=${envWiki}\n`, 'utf8')
    writeFileSync(path.join(knowledgeBaseTestState.hermesHome, 'config.yaml'), [
      'knowledge:',
      `  wiki_path: "${configWiki}"`,
      '  agent_prefix: "Hermes"',
    ].join('\n'), 'utf8')

    const { getKnowledgeBaseContext } = await import('@/lib/knowledge-base')
    const context = getKnowledgeBaseContext()
    expect(context.wikiRoot).toBe(envWiki)
  })

  it('keeps the Hermes legacy wiki root ahead of the vault-derived fallback when it already exists', async () => {
    const vaultPath = path.join(tempHomeDir, 'vault')
    writeFileSync(path.join(knowledgeBaseTestState.hermesHome, 'config.yaml'), [
      'knowledge:',
      `  vault_path: "${vaultPath}"`,
      '  agent_prefix: "Researcher"',
    ].join('\n'), 'utf8')

    const { getKnowledgeBaseContext } = await import('@/lib/knowledge-base')
    const context = getKnowledgeBaseContext()
    expect(context.wikiRoot).toBe(path.join(os.homedir(), 'hermes-kb'))
    expect(context.structuredVaultPath).toBe(path.join(vaultPath, 'Researcher'))
  })
})
