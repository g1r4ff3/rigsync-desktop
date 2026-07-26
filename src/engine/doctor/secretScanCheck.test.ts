import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../testFixtures'
import { writeCommonLayer } from '../manifest'
import { SECRET_ALLOWLIST_LAYER } from '../safety/secretAllowlist'
import { checkSecretScanPreflight } from './secretScanCheck'

// 픽스처 주의(★): public repo -- 실제 토큰 형식을 흉내내지 않도록 `.repeat()`로
// 조립한 반복 단어 더미만 쓴다.
const FAKE_GITHUB_PAT = 'ghp_' + 'FAKE'.repeat(9)

describe('checkSecretScanPreflight (⑥ 소급 스캔)', () => {
  it('passes with no findings when the manifest is clean', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.manifestDir, 'common'), { recursive: true })
    fs.writeFileSync(path.join(fixture.manifestDir, 'common', 'dotfiles.toml'), 'entry = []\n')

    const result = checkSecretScanPreflight(fixture.ctx)
    expect(result.blockedFindings).toEqual([])
    expect(result.warnings).toEqual([])
    fixture.cleanup()
  })

  it('flags a secret already sitting in the manifest store (e.g. captured before this gate existed)', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.manifestDir, 'dotfiles'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.manifestDir, 'dotfiles', '.zshrc'),
      `export GITHUB_TOKEN=${FAKE_GITHUB_PAT}\n`
    )

    const result = checkSecretScanPreflight(fixture.ctx)
    expect(result.blockedFindings.length).toBeGreaterThan(0)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('다시 Capture하세요')
    // 값 비노출: warnings에 원문 토큰이 있으면 안 된다.
    expect(JSON.stringify(result)).not.toContain(FAKE_GITHUB_PAT)
    fixture.cleanup()
  })

  it('respects the allowlist -- an allowlisted (path,kind) pair does not show up as a finding', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.manifestDir, 'dotfiles'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.manifestDir, 'dotfiles', '.zshrc'),
      `export GITHUB_TOKEN=${FAKE_GITHUB_PAT}\n`
    )
    writeCommonLayer(fixture.ctx, SECRET_ALLOWLIST_LAYER, {
      allow: [{ path: 'dotfiles/.zshrc', kind: 'github-pat' }]
    })

    const result = checkSecretScanPreflight(fixture.ctx)
    expect(result.blockedFindings).toEqual([])
    fixture.cleanup()
  })

  it('does not scan .git internals', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.manifestDir, '.git', 'objects'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.manifestDir, '.git', 'objects', 'blob'),
      `${FAKE_GITHUB_PAT}\n`
    )

    const result = checkSecretScanPreflight(fixture.ctx)
    expect(result.blockedFindings).toEqual([])
    fixture.cleanup()
  })
})
