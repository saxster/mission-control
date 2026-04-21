import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  getKnowledgeBaseContext,
  isKnowledgeBaseWikiPathAllowed,
  isKnowledgeBaseWikiPathWritable,
  resolveKnowledgeBaseContentPath,
} from '@/lib/knowledge-base'
import {
  buildKnowledgeBaseContentHash,
  getEffectiveKnowledgeBaseGovernanceRecord,
  normalizeKnowledgeBaseGovernanceInput,
  recordKnowledgeBaseGovernanceDecision,
  reviewKnowledgeBaseGovernance,
  type KnowledgeBaseGovernanceIngestionMethod,
  type KnowledgeBaseGovernanceRecord,
  type KnowledgeBaseGovernanceReview,
} from '@/lib/knowledge-base-governance'
import {
  checkObsidianWriteConflict,
  recordKnowledgeBaseObsidianWrite,
} from '@/lib/obsidian'
import { validateSchema } from '@/lib/memory-utils'

export interface GovernedKnowledgeBaseWriteResult {
  status: number
  governance: KnowledgeBaseGovernanceReview
  context: ReturnType<typeof getKnowledgeBaseContext>
  body: {
    success?: boolean
    message?: string
    error?: string
    schemaWarnings?: string[]
    governance: KnowledgeBaseGovernanceReview
  }
}

export async function performGovernedKnowledgeBaseWrite(args: {
  runtimeProfileName?: string | null
  action: 'create' | 'save'
  path: string
  content: string
  actor: string
  governance: unknown
  expectedObsidianContentHash?: string | null
  ingestionMethod?: KnowledgeBaseGovernanceIngestionMethod
}): Promise<GovernedKnowledgeBaseWriteResult> {
  const context = getKnowledgeBaseContext(args.runtimeProfileName)
  if (!isKnowledgeBaseWikiPathAllowed(context, args.path) || !isKnowledgeBaseWikiPathWritable(context, args.path)) {
    const governance = await reviewKnowledgeBaseGovernance(
      normalizeKnowledgeBaseGovernanceInput(args.governance),
      { ingestionMethod: args.ingestionMethod || 'manual' },
    )
    return {
      status: 403,
      governance,
      context,
      body: {
        error: 'Path not allowed',
        governance,
      },
    }
  }

  const previousGovernance: KnowledgeBaseGovernanceRecord | null =
    getEffectiveKnowledgeBaseGovernanceRecord(context.runtimeProfile.name, args.path)
  const governanceInput = normalizeKnowledgeBaseGovernanceInput(args.governance, previousGovernance)
  const governanceReview = await reviewKnowledgeBaseGovernance(governanceInput, {
    ingestionMethod: args.ingestionMethod || 'manual',
  })

  if (governanceReview.requiresUserOverride) {
    return {
      status: 422,
      governance: governanceReview,
      context,
      body: {
        error: 'Source quality review requires acknowledgement before this page can be written.',
        governance: governanceReview,
      },
    }
  }

  if (!context.wikiExists && args.action !== 'create') {
    return {
      status: 400,
      governance: governanceReview,
      context,
      body: {
        error: context.firstRunReason || 'Knowledge Base wiki not initialized',
        governance: governanceReview,
      },
    }
  }

  if (!context.wikiExists && (args.action === 'create' || args.action === 'save')) {
    await mkdir(context.wikiRoot, { recursive: true })
  }

  const fullPath = await resolveKnowledgeBaseContentPath(
    { ...context, wikiExists: true },
    args.path,
    'wiki',
  )

  if (args.action === 'create') {
    await mkdir(dirname(fullPath), { recursive: true })
    const existing = await stat(fullPath).then(() => true).catch(() => false)
    if (existing) {
      return {
        status: 409,
        governance: governanceReview,
        context,
        body: {
          error: 'File already exists',
          governance: governanceReview,
        },
      }
    }
  } else {
    await mkdir(dirname(fullPath), { recursive: true })
  }

  const obsidianConflict = checkObsidianWriteConflict({
    context,
    path: args.path,
    content: args.content,
    actor: args.actor,
    expectedContentHash: args.expectedObsidianContentHash ?? null,
  })
  if (obsidianConflict.conflict) {
    return {
      status: 409,
      governance: governanceReview,
      context,
      body: {
        error: 'The vault-backed note changed since it was loaded. A conflict was recorded for review before any overwrite.',
        governance: governanceReview,
      },
    }
  }

  const schema = args.path.endsWith('.md') ? validateSchema(args.content) : null
  await writeFile(fullPath, args.content, 'utf8')
  recordKnowledgeBaseObsidianWrite({
    context,
    path: args.path,
    content: args.content,
    actor: args.actor,
  })
  recordKnowledgeBaseGovernanceDecision({
    runtimeProfileName: context.runtimeProfile.name,
    path: args.path,
    actor: args.actor,
    contentHash: buildKnowledgeBaseContentHash(args.content),
    review: governanceReview,
  })

  return {
    status: 200,
    governance: governanceReview,
    context,
    body: {
      success: true,
      message: args.action === 'create' ? 'File created successfully' : 'File saved successfully',
      schemaWarnings: schema?.errors || [],
      governance: governanceReview,
    },
  }
}
