import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../testFixtures'
import { writeCommonLayer } from '../manifest'
import {
  filterAllowlistedFindings,
  isSecretAllowlisted,
  readSecretAllowlist,
  SECRET_ALLOWLIST_LAYER
} from './secretAllowlist'
import type { SecretFinding } from './secretScan'

describe('secret allowlist', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reads an empty allowlist when common/secret-allowlist.toml does not exist', () => {
    const allowlist = readSecretAllowlist(fixture.ctx)
    expect(allowlist.size).toBe(0)
  })

  it('reads (path,kind) entries from common/secret-allowlist.toml', () => {
    writeCommonLayer(fixture.ctx, SECRET_ALLOWLIST_LAYER, {
      allow: [{ path: '~/.bashrc', kind: 'generic-secret-assignment' }]
    })
    const allowlist = readSecretAllowlist(fixture.ctx)
    expect(isSecretAllowlisted(allowlist, '~/.bashrc', 'generic-secret-assignment')).toBe(true)
    expect(isSecretAllowlisted(allowlist, '~/.bashrc', 'github-pat')).toBe(false)
    expect(isSecretAllowlisted(allowlist, '~/.zshrc', 'generic-secret-assignment')).toBe(false)
  })

  it('never stores or exposes the secret value itself -- only path+kind pairs', () => {
    writeCommonLayer(fixture.ctx, SECRET_ALLOWLIST_LAYER, {
      allow: [{ path: '~/.bashrc', kind: 'generic-secret-assignment' }]
    })
    const raw = fs.readFileSync(
      path.join(fixture.manifestDir, 'common', 'secret-allowlist.toml'),
      'utf-8'
    )
    // 스키마 자체가 path/kind 필드만 -- 값이 끼어들 필드가 없다는 것을 파일
    // 내용으로도 재확인한다.
    expect(raw).toContain('path')
    expect(raw).toContain('kind')
    expect(raw).not.toMatch(/value|secret\s*=/i)
  })

  it('filters allowlisted (path,kind) findings out of a finding list', () => {
    writeCommonLayer(fixture.ctx, SECRET_ALLOWLIST_LAYER, {
      allow: [{ path: '~/.bashrc', kind: 'generic-secret-assignment' }]
    })
    const allowlist = readSecretAllowlist(fixture.ctx)
    const findings: SecretFinding[] = [
      {
        path: '~/.bashrc',
        line: 3,
        kind: 'generic-secret-assignment',
        confidence: 'medium',
        label: 'x',
        maskedExcerpt: 'X=****'
      },
      {
        path: '~/.bashrc',
        line: 4,
        kind: 'github-pat',
        confidence: 'high',
        label: 'y',
        maskedExcerpt: 'ghp_****'
      }
    ]
    const filtered = filterAllowlistedFindings(allowlist, findings)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].kind).toBe('github-pat')
  })

  it('does NOT provide a global disable switch -- an empty allow list blocks everything as normal', () => {
    writeCommonLayer(fixture.ctx, SECRET_ALLOWLIST_LAYER, { allow: [] })
    const allowlist = readSecretAllowlist(fixture.ctx)
    const findings: SecretFinding[] = [
      {
        path: '~/.bashrc',
        line: 1,
        kind: 'github-pat',
        confidence: 'high',
        label: 'y',
        maskedExcerpt: 'ghp_****'
      }
    ]
    expect(filterAllowlistedFindings(allowlist, findings)).toHaveLength(1)
  })
})
