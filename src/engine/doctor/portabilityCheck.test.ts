import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../testFixtures'
import { hostLayerPath, writeCommonLayer, writeManifestFile } from '../manifest'
import { checkManifestPortability } from './portabilityCheck'

// refactor-spec-v0.2 P2 — F1 재발 방지: 이 머신에 적용될 스토어 콘텐츠에서
// 다른 사용자의 /home/<이름> 참조를 찾는다. makeFixture의 homeDir은
// <tmp>/home이라 "이 머신의 사용자"는 'home'이다 — 픽스처 사용자명과
// 겹치지 않는 'cglab'을 외래 사용자로 쓴다(실사고와 같은 이름).

function writeStoreFile(fixture: TestFixture, rel: string, content: string): void {
  const p = path.join(fixture.manifestDir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

describe('checkManifestPortability', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('flags a foreign /home/<user> reference in a dotfiles store file with line info', () => {
    writeCommonLayer(fixture.ctx, 'dotfiles', {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    writeStoreFile(fixture, 'dotfiles/.zshrc', 'export A=1\nexport P=/home/cglab/.local/bin\n')

    const result = checkManifestPortability(fixture.ctx)

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      path: 'dotfiles/.zshrc',
      line: 2,
      foreignUser: 'cglab'
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('dotfiles/.zshrc:2')
    expect(result.warnings[0]).toContain('cglab')
  })

  it('does not flag the own user home path', () => {
    // makeFixture의 홈 사용자명은 'home' (homeDir = <tmp>/home).
    writeCommonLayer(fixture.ctx, 'dotfiles', {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    writeStoreFile(fixture, 'dotfiles/.zshrc', 'export P=/home/home/.local/bin\n')

    expect(checkManifestPortability(fixture.ctx).findings).toEqual([])
  })

  it('scans the crontab store (common) and unit files referenced by effective services', () => {
    writeStoreFile(
      fixture,
      'scheduled/crontab.txt',
      '*/15 * * * * /home/cglab/.local/bin/sync.sh\n'
    )
    writeCommonLayer(fixture.ctx, 'services', {
      unit: [
        { name: 'x.service', file: 'services/systemd-user/x.service', enabled: true },
        { name: 'clean.service', file: 'services/systemd-user/clean.service', enabled: true }
      ]
    })
    writeStoreFile(
      fixture,
      'services/systemd-user/x.service',
      '[Service]\nExecStart=/home/cglab/cliproxyapi/cli-proxy-api\n'
    )
    writeStoreFile(fixture, 'services/systemd-user/clean.service', '[Service]\nExecStart=%h/ok\n')

    const result = checkManifestPortability(fixture.ctx)

    const paths = result.findings.map((f) => f.path)
    expect(paths).toContain('scheduled/crontab.txt')
    expect(paths).toContain('services/systemd-user/x.service')
    expect(paths).not.toContain('services/systemd-user/clean.service')
  })

  it('prefers the host crontab store when it exists (matches capture/diff resolution)', () => {
    writeStoreFile(fixture, 'scheduled/crontab.txt', '# clean\n')
    writeStoreFile(
      fixture,
      'hosts/testhost/scheduled/crontab.txt',
      '*/15 * * * * /home/cglab/x.sh\n'
    )

    const result = checkManifestPortability(fixture.ctx)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].path).toBe('hosts/testhost/scheduled/crontab.txt')
  })

  it('scans host-overlay dotfiles entries of this machine but ignores other hosts', () => {
    writeManifestFile(hostLayerPath(fixture.ctx, 'dotfiles'), {
      entry: [
        { home: '~/own.conf', store: 'hosts/testhost/dotfiles/own.conf', type: 'file', link: false }
      ]
    })
    writeStoreFile(fixture, 'hosts/testhost/dotfiles/own.conf', 'path=/home/cglab/x\n')
    // 다른 호스트의 오버레이 스토어 — 이 머신에 적용되지 않으므로 안 본다.
    writeStoreFile(fixture, 'hosts/otherhost/dotfiles/other.conf', 'path=/home/cglab/y\n')

    const result = checkManifestPortability(fixture.ctx)
    const paths = result.findings.map((f) => f.path)
    expect(paths).toContain('hosts/testhost/dotfiles/own.conf')
    expect(paths.some((p) => p.includes('otherhost'))).toBe(false)
  })

  it('compresses multiple references in one file into a single per-file warning', () => {
    writeCommonLayer(fixture.ctx, 'dotfiles', {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    writeStoreFile(
      fixture,
      'dotfiles/.zshrc',
      'a=/home/cglab/a\nb=/home/cglab/b\nc=/home/seongil/c\n'
    )

    const result = checkManifestPortability(fixture.ctx)
    expect(result.findings).toHaveLength(3)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('cglab, seongil')
    expect(result.warnings[0]).toContain('3곳')
  })

  it('skips binary files and scans directory-tree dotfile stores recursively', () => {
    writeCommonLayer(fixture.ctx, 'dotfiles', {
      entry: [{ home: '~/.config/tool', store: 'dotfiles/.config/tool', type: 'dir', link: true }]
    })
    writeStoreFile(fixture, 'dotfiles/.config/tool/a.conf', 'x=/home/cglab/bin\n')
    const binPath = path.join(fixture.manifestDir, 'dotfiles/.config/tool/blob.bin')
    fs.writeFileSync(binPath, Buffer.from([0, 1, 2, 47, 104, 111, 109, 101]))

    const result = checkManifestPortability(fixture.ctx)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].path).toBe('dotfiles/.config/tool/a.conf')
  })

  it('suppresses documentation placeholder names like /home/username (실측 오탐: p10k.zsh 주석)', () => {
    writeCommonLayer(fixture.ctx, 'dotfiles', {
      entry: [{ home: '~/.p10k.zsh', store: 'dotfiles/.p10k.zsh', type: 'file', link: true }]
    })
    writeStoreFile(
      fixture,
      'dotfiles/.p10k.zsh',
      '# - global  `asdf current` says "set by /home/username/file"\n# /home/directory/x\n'
    )
    expect(checkManifestPortability(fixture.ctx).findings).toEqual([])
  })

  it('returns a clean result on an empty manifest', () => {
    expect(checkManifestPortability(fixture.ctx)).toEqual({ findings: [], warnings: [] })
  })
})
