import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('knowledge base QA harness', () => {
  const fixtureRoot = path.resolve(process.cwd(), '../hermes-companion/Tests/HermesCompanionTests/Fixtures/KnowledgeBaseSeedBundle')
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'mc-kb-qa-'))
  const dataDir = path.join(tempRoot, 'mc-data')
  const homeDir = path.join(tempRoot, 'mc-home')
  const hermesHome = path.join(dataDir, '.hermes')
  const vaultPath = path.join(tempRoot, 'vault')
  const outputDir = path.join(process.cwd(), 'output', 'playwright')
  const reportPath = path.join(outputDir, 'knowledge-base-qa-report.json')
  const fixtureURL = 'https://example.com/knowledge-base-fixture'

  beforeAll(async () => {
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(homeDir, { recursive: true })
    mkdirSync(hermesHome, { recursive: true })
    mkdirSync(vaultPath, { recursive: true })
    mkdirSync(path.join(vaultPath, 'Hermes', 'Wiki', 'entities'), { recursive: true })
    mkdirSync(path.join(vaultPath, 'Hermes', 'Wiki', 'concepts'), { recursive: true })
    mkdirSync(path.join(vaultPath, 'Hermes', 'Wiki', 'comparisons'), { recursive: true })
    mkdirSync(path.join(vaultPath, 'Hermes', 'Wiki', 'queries'), { recursive: true })
    mkdirSync(path.join(vaultPath, 'Hermes', 'Wiki', 'articles'), { recursive: true })
    mkdirSync(path.join(vaultPath, 'Hermes', 'Wiki', 'raw'), { recursive: true })
    mkdirSync(path.join(vaultPath, 'Hermes', 'Notes'), { recursive: true })
    mkdirSync(path.join(vaultPath, 'Inbox'), { recursive: true })
    mkdirSync(outputDir, { recursive: true })

    writeFileSync(
      path.join(hermesHome, '.env'),
      `OBSIDIAN_VAULT_PATH=${vaultPath}\nLLM_WIKI_PATH=${path.join(vaultPath, 'Hermes', 'Wiki')}\n`,
      'utf8'
    )
    writeFileSync(
      path.join(hermesHome, 'config.yaml'),
      `knowledge:\n  vault_path: ${vaultPath}\n  wiki_path: ${path.join(vaultPath, 'Hermes', 'Wiki')}\n  agent_prefix: Hermes\n`,
      'utf8'
    )
    writeFileSync(
        path.join(vaultPath, 'Inbox', 'External-Candidate.md'),
        readFileSync(path.join(fixtureRoot, 'obsidian-import-candidate.md'), 'utf8'),
        'utf8'
    )

    process.env.MISSION_CONTROL_DATA_DIR = dataDir
    process.env.MISSION_CONTROL_HOME_DIR = homeDir

  })

  it('imports and promotes deterministic file, URL, Teach, and Obsidian candidate sources', { timeout: 30_000 }, async () => {
    vi.resetModules()
    const originalFetch = global.fetch
    global.fetch = vi.fn(async () => {
      throw new Error('network offline in QA harness')
    }) as unknown as typeof fetch

    try {
      const {
        importKnowledgeBaseSources,
        listKnowledgeBaseSources,
        promoteKnowledgeBaseSource,
      } = await import('@/lib/knowledge-base-sources')
      const {
        getKnowledgeBaseContext,
        getKnowledgeBaseTree,
        readKnowledgeBaseContent,
        searchKnowledgeBase,
      } = await import('@/lib/knowledge-base')
      const { listKnowledgeBaseGovernanceQueue } = await import('@/lib/knowledge-base-governance')
      const { buildLinkGraph, runHealthDiagnostics } = await import('@/lib/memory-utils')

      const teachCard = JSON.parse(readFileSync(path.join(fixtureRoot, 'teach-card-seed.json'), 'utf8'))
      const fileImports = importKnowledgeBaseSources({
        kind: 'file',
        filePaths: [
          path.join(fixtureRoot, 'local-source.md'),
          path.join(fixtureRoot, 'structured-note.md'),
        ],
        domain: 'programming',
      })
      const urlImports = importKnowledgeBaseSources({
        kind: 'url',
        url: fixtureURL,
        title: 'Hermes Knowledge Base Fixture',
        domain: 'general',
      })
      const teachImports = importKnowledgeBaseSources({
        kind: 'teach_card',
        title: teachCard.topic,
        domain: 'programming',
        teachCard,
      })
      const obsidianImports = importKnowledgeBaseSources({
        kind: 'import_candidate',
        path: 'Inbox/External-Candidate.md',
        domain: 'programming',
      })

      expect(fileImports).toHaveLength(2)
      expect(urlImports).toHaveLength(1)
      expect(teachImports).toHaveLength(1)
      expect(obsidianImports).toHaveLength(1)

      const filePromotion = await promoteKnowledgeBaseSource({
        sourceID: fileImports[0].id,
        targetType: 'article',
        actor: 'qa-harness',
        domain: 'programming',
        overrideReason: 'Deterministic local QA source for release validation.',
      })
      const urlPromotion = await promoteKnowledgeBaseSource({
        sourceID: urlImports[0].id,
        targetType: 'article',
        actor: 'qa-harness',
        domain: 'general',
        overrideReason: 'Deterministic URL fixture used for release validation.',
      })
      const teachPromotion = await promoteKnowledgeBaseSource({
        sourceID: teachImports[0].id,
        targetType: 'concept',
        actor: 'qa-harness',
        domain: 'programming',
        overrideReason: 'Teach artifact promotion smoke test.',
      })
      const obsidianPromotion = await promoteKnowledgeBaseSource({
        sourceID: obsidianImports[0].id,
        targetType: 'structured_note',
        actor: 'qa-harness',
        domain: 'programming',
        overrideReason: 'Imported external note should land in structured notes during QA.',
      })

      expect(filePromotion.ok).toBe(true)
      expect(urlPromotion.ok).toBe(true)
      expect(teachPromotion.ok).toBe(true)
      expect(obsidianPromotion.ok).toBe(true)

      const context = getKnowledgeBaseContext('default')
      const sources = listKnowledgeBaseSources(context)
      const tree = await getKnowledgeBaseTree(context, { depth: 3 })
      const articlePath = filePromotion.ok ? filePromotion.path : ''
      const teachPath = teachPromotion.ok ? teachPromotion.path : ''
      const articleContent = await readKnowledgeBaseContent(context, articlePath, 'wiki')
      const teachContent = await readKnowledgeBaseContent(context, teachPath, 'wiki')
      const searchResults = await searchKnowledgeBase(context, 'Vector Search', 10)
      const graph = await buildLinkGraph(context.wikiRoot)
      const health = await runHealthDiagnostics(context.wikiRoot)
      const governance = await listKnowledgeBaseGovernanceQueue(context)

      expect(sources.length).toBeGreaterThanOrEqual(4)
      expect(tree.length).toBeGreaterThan(0)
      expect(articleContent.path).toBe(articlePath)
      expect(teachContent.content).toContain('Vector Search')
      expect(searchResults.some((result) => result.path == teachPath)).toBe(true)
      expect(graph.totalFiles).toBeGreaterThanOrEqual(3)
      expect(health.overallScore).toBeGreaterThanOrEqual(0)
      expect(governance.totalPages).toBeGreaterThanOrEqual(2)

      const report = {
        generatedAt: new Date().toISOString(),
        hermesHome,
        vaultPath,
        importedSourceIDs: sources.map((source) => source.id),
        promotedPaths: [
          filePromotion.ok ? filePromotion.path : null,
          urlPromotion.ok ? urlPromotion.path : null,
          teachPromotion.ok ? teachPromotion.path : null,
          obsidianPromotion.ok ? obsidianPromotion.path : null,
        ].filter(Boolean),
        fixtureURL,
        searchResultCount: searchResults.length,
        graph: {
          totalFiles: graph.totalFiles,
          totalLinks: graph.totalLinks,
          orphanCount: graph.orphans.length,
        },
        health: {
          overall: health.overall,
          overallScore: health.overallScore,
          categoryCount: health.categories.length,
        },
        governance: {
          totalPages: governance.totalPages,
          unreviewed: governance.stats.unreviewed,
          warnings: governance.stats.warnings,
        },
      }

      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    } finally {
      global.fetch = originalFetch
    }
  })
})
