import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hermesRuntimeProfileTestState = vi.hoisted(() => ({
  hermesHome: '',
  homeDir: '',
}))

vi.mock('@/lib/hermes-bootstrap', () => ({
  getHermesCommandContext: vi.fn(() => ({
    hermesHome: hermesRuntimeProfileTestState.hermesHome,
    homeDir: hermesRuntimeProfileTestState.homeDir,
    binCandidates: ['hermes'],
    pathPrefix: '',
  })),
}))

describe('hermes runtime profiles', () => {
  let tempHomeDir = ''

  beforeEach(() => {
    tempHomeDir = mkdtempSync(path.join(os.tmpdir(), 'mc-hermes-runtime-'))
    hermesRuntimeProfileTestState.homeDir = tempHomeDir
    hermesRuntimeProfileTestState.hermesHome = path.join(tempHomeDir, '.hermes')
    mkdirSync(path.join(tempHomeDir, '.hermes', 'profiles', 'researcher'), { recursive: true })
    mkdirSync(path.join(tempHomeDir, '.hermes', 'profiles', 'ops'), { recursive: true })
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(tempHomeDir, { recursive: true, force: true })
    hermesRuntimeProfileTestState.hermesHome = ''
    hermesRuntimeProfileTestState.homeDir = ''
    vi.resetModules()
  })

  it('discovers named Hermes homes and resolves source bindings onto real runtime profiles', async () => {
    const {
      buildHermesRuntimeBindingTargets,
      discoverHermesRuntimeProfiles,
      resolveHermesRuntimeBindingForSource,
    } = await import('@/lib/hermes-runtime-profiles')

    const profiles = discoverHermesRuntimeProfiles()
    expect(profiles.map((profile) => profile.name)).toEqual(['default', 'ops', 'researcher'])

    const resolved = resolveHermesRuntimeBindingForSource(
      'telegram',
      { telegram: 'personal' },
      { personal: 'researcher' },
      profiles,
    )
    expect(resolved).toMatchObject({
      sourceKey: 'telegram',
      profile: 'personal',
      runtimeProfileName: 'researcher',
      runtimeProfileHome: path.join(tempHomeDir, '.hermes', 'profiles', 'researcher'),
    })

    const targets = buildHermesRuntimeBindingTargets({ personal: 'researcher', work: 'ops' }, profiles)
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        profile: 'personal',
        runtimeProfileName: 'researcher',
      }),
      expect.objectContaining({
        profile: 'work',
        runtimeProfileName: 'ops',
      }),
      expect.objectContaining({
        profile: 'primary',
        runtimeProfileName: 'default',
      }),
    ]))
  })
})
