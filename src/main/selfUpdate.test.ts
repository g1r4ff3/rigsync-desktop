import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  GearLeverAppConfig,
  GearLeverCommandResult
} from '../engine/capabilities/appimage/providerTypes'
import type { UpdateManagerModel } from '../engine/capabilities/appimage/types'
import {
  attemptSelfUpdateRegistration,
  decideSelfRegistration,
  readSelfUpdateState,
  type SelfRegistrationDeps,
  type SelfUpdateState,
  writeSelfUpdateState
} from './selfUpdate'

describe('decideSelfRegistration', () => {
  it('is not-appimage when appImagePath is null (dev/deb run)', () => {
    expect(
      decideSelfRegistration({
        appImagePath: null,
        alreadyAttempted: false,
        gearLeverAvailable: true,
        existingRepo: null
      })
    ).toBe('not-appimage')
  })

  it('is already-attempted when the state flag is set, even if the source is currently missing', () => {
    expect(
      decideSelfRegistration({
        appImagePath: '/opt/rigsync-desktop.AppImage',
        alreadyAttempted: true,
        gearLeverAvailable: true,
        existingRepo: null
      })
    ).toBe('already-attempted')
  })

  it('is gearlever-unavailable when Gear Lever cannot be used', () => {
    expect(
      decideSelfRegistration({
        appImagePath: '/opt/rigsync-desktop.AppImage',
        alreadyAttempted: false,
        gearLeverAvailable: false,
        existingRepo: null
      })
    ).toBe('gearlever-unavailable')
  })

  it('is source-already-set when the update source repo is already present', () => {
    expect(
      decideSelfRegistration({
        appImagePath: '/opt/rigsync-desktop.AppImage',
        alreadyAttempted: false,
        gearLeverAvailable: true,
        existingRepo: 'g1r4ff3/rigsync-desktop'
      })
    ).toBe('source-already-set')
  })

  it('is attempt only when running as AppImage, never attempted, Gear Lever available, and no source set', () => {
    expect(
      decideSelfRegistration({
        appImagePath: '/opt/rigsync-desktop.AppImage',
        alreadyAttempted: false,
        gearLeverAvailable: true,
        existingRepo: null
      })
    ).toBe('attempt')
  })
})

describe('self-update state file', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-update-state-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when no state file exists yet', () => {
    expect(readSelfUpdateState(dir)).toBeNull()
  })

  it('round-trips a written state', () => {
    const state: SelfUpdateState = {
      attempted: true,
      attemptedAt: '2026-07-26T00:00:00.000Z',
      result: 'ok',
      detail: 'exit 0'
    }
    writeSelfUpdateState(dir, state)
    expect(readSelfUpdateState(dir)).toEqual(state)
  })

  it('treats a corrupt state file as "never attempted" rather than throwing', () => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'self-update-state.json'), '{not json')
    expect(readSelfUpdateState(dir)).toBeNull()
  })

  it('creates the state directory if it does not exist yet', () => {
    const nested = path.join(dir, 'nested', 'userData')
    writeSelfUpdateState(nested, {
      attempted: true,
      attemptedAt: '2026-07-26T00:00:00.000Z',
      result: 'failed',
      detail: 'exit 1'
    })
    expect(readSelfUpdateState(nested)?.result).toBe('failed')
  })
})

function makeDeps(overrides: Partial<SelfRegistrationDeps> = {}): {
  deps: SelfRegistrationDeps
  setUpdateSourceCalls: Array<{
    appImagePath: string
    manager: UpdateManagerModel
    params: Record<string, string>
  }>
  writtenStates: SelfUpdateState[]
  logs: string[]
} {
  const setUpdateSourceCalls: Array<{
    appImagePath: string
    manager: UpdateManagerModel
    params: Record<string, string>
  }> = []
  const writtenStates: SelfUpdateState[] = []
  const logs: string[] = []

  const deps: SelfRegistrationDeps = {
    appImagePath: '/opt/rigsync-desktop.AppImage',
    isGearLeverAvailable: () => true,
    readAppConfig: (): GearLeverAppConfig | null => null,
    setUpdateSource: (appImagePath, manager, params): GearLeverCommandResult => {
      setUpdateSourceCalls.push({ appImagePath, manager, params: { ...params } })
      return { ok: true, output: 'ok' }
    },
    readState: () => null,
    writeState: (state) => writtenStates.push(state),
    now: () => new Date('2026-07-26T00:00:00.000Z'),
    log: (message) => logs.push(message),
    ...overrides
  }

  return { deps, setUpdateSourceCalls, writtenStates, logs }
}

describe('attemptSelfUpdateRegistration', () => {
  it('does nothing (and calls Gear Lever zero times) when not running as an AppImage', () => {
    const { deps, setUpdateSourceCalls, writtenStates } = makeDeps({ appImagePath: null })
    const decision = attemptSelfUpdateRegistration(deps)
    expect(decision).toBe('not-appimage')
    expect(setUpdateSourceCalls).toHaveLength(0)
    expect(writtenStates).toHaveLength(0)
  })

  it('does nothing when a previous attempt was already recorded, even if the source is missing again', () => {
    const { deps, setUpdateSourceCalls, writtenStates } = makeDeps({
      readState: () => ({
        attempted: true,
        attemptedAt: '2026-01-01T00:00:00.000Z',
        result: 'ok',
        detail: 'ok'
      })
    })
    const decision = attemptSelfUpdateRegistration(deps)
    expect(decision).toBe('already-attempted')
    expect(setUpdateSourceCalls).toHaveLength(0)
    expect(writtenStates).toHaveLength(0)
  })

  it('does nothing when Gear Lever is not available', () => {
    const { deps, setUpdateSourceCalls, writtenStates } = makeDeps({
      isGearLeverAvailable: () => false
    })
    const decision = attemptSelfUpdateRegistration(deps)
    expect(decision).toBe('gearlever-unavailable')
    expect(setUpdateSourceCalls).toHaveLength(0)
    expect(writtenStates).toHaveLength(0)
  })

  it('does nothing when the update source is already configured for this exact AppImage', () => {
    const { deps, setUpdateSourceCalls, writtenStates } = makeDeps({
      readAppConfig: () => ({ updateManager: { repo: 'g1r4ff3/rigsync-desktop' } })
    })
    const decision = attemptSelfUpdateRegistration(deps)
    expect(decision).toBe('source-already-set')
    expect(setUpdateSourceCalls).toHaveLength(0)
    expect(writtenStates).toHaveLength(0)
  })

  it('calls setUpdateSource with GithubUpdater + fixed repo coordinates for exactly this AppImage path, then records success', () => {
    const { deps, setUpdateSourceCalls, writtenStates } = makeDeps()
    const decision = attemptSelfUpdateRegistration(deps)
    expect(decision).toBe('attempt')
    expect(setUpdateSourceCalls).toEqual([
      {
        appImagePath: '/opt/rigsync-desktop.AppImage',
        manager: 'GithubUpdater',
        params: {
          repo: 'g1r4ff3/rigsync-desktop',
          repo_filename: 'rigsync-desktop-*.AppImage',
          allow_prereleases: 'false'
        }
      }
    ])
    expect(writtenStates).toEqual([
      {
        attempted: true,
        attemptedAt: '2026-07-26T00:00:00.000Z',
        result: 'ok',
        detail: 'ok'
      }
    ])
  })

  it('records a failed attempt (still attempted:true, so it does not retry next launch) when setUpdateSource fails', () => {
    const { deps, writtenStates } = makeDeps({
      setUpdateSource: () => ({ ok: false, output: 'exit 1: flatpak not found' })
    })
    const decision = attemptSelfUpdateRegistration(deps)
    expect(decision).toBe('attempt')
    expect(writtenStates).toEqual([
      {
        attempted: true,
        attemptedAt: '2026-07-26T00:00:00.000Z',
        result: 'failed',
        detail: 'exit 1: flatpak not found'
      }
    ])
  })

  it('never throws, even if a dep throws mid-flow (must not block app startup)', () => {
    const { deps } = makeDeps({
      isGearLeverAvailable: () => {
        throw new Error('boom')
      }
    })
    expect(() => attemptSelfUpdateRegistration(deps)).not.toThrow()
    expect(attemptSelfUpdateRegistration(deps)).toBe('error')
  })
})
