import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCommonLayer, readManifestFile } from '../manifest'
import { readIgnoreSet } from '../ignore'
import { makeFixture, type TestFixture } from '../testFixtures'
import { migrateLegacyManifest } from './legacy'

// 픽스처는 구 repo(~/repos/rigsync) 실측 스키마를 그대로 흉내낸다(코드 복사
// 아님 -- TOML 문자열만 재현).

function writeLegacyToml(legacyRoot: string, rel: string, content: string): void {
  const abs = path.join(legacyRoot, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function writeLegacyFile(legacyRoot: string, rel: string, content: string): void {
  const abs = path.join(legacyRoot, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

describe('migrateLegacyManifest', () => {
  let legacyRoot: string
  let fixture: TestFixture

  beforeEach(() => {
    legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-legacy-'))
    fixture = makeFixture('reference')

    writeLegacyToml(
      legacyRoot,
      'manifest/common/dotfiles.toml',
      `[[entry]]\nhome = "~/.zshrc"\nstore = "dotfiles/.zshrc"\ntype = "file"\nlink = true\n`
    )
    writeLegacyFile(legacyRoot, 'dotfiles/.zshrc', 'export FOO=bar\n')

    writeLegacyToml(
      legacyRoot,
      'manifest/common/apt.toml',
      `packages = ["git", "curl"]\n\n[[sources]]\nname = "docker.list"\nfile = "apt/sources/docker.list"\nkeyring_dest = "/usr/share/keyrings/docker.gpg"\n`
    )
    writeLegacyFile(
      legacyRoot,
      'manifest/files/apt/sources/docker.list',
      'deb [signed-by=/usr/share/keyrings/docker.gpg] https://x\n'
    )
    writeLegacyFile(legacyRoot, 'manifest/files/apt/keyrings/docker.gpg', 'fake-key-bytes')

    writeLegacyToml(
      legacyRoot,
      'manifest/common/snap.toml',
      `[[snap]]\nname = "code"\nclassic = true\n`
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/common/flatpak.toml',
      `[[remote]]\nname = "flathub"\nurl = "https://dl.flathub.org/repo/"\n\n[[app]]\napplication = "com.obsproject.Studio"\norigin = "flathub"\ninstallation = "system"\n`
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/common/dconf.toml',
      `[[path]]\npath = "/org/gnome/desktop/wm/keybindings/"\nfile = "dconf/org-gnome-desktop-wm-keybindings.ini"\n`
    )
    writeLegacyFile(
      legacyRoot,
      'manifest/files/dconf/org-gnome-desktop-wm-keybindings.ini',
      '[/]\nclose=[]\n'
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/common/services.toml',
      `[[unit]]\nname = "cliproxyapi.service"\nfile = "systemd-user/cliproxyapi.service"\nenabled = true\n`
    )
    writeLegacyFile(legacyRoot, 'manifest/files/systemd-user/cliproxyapi.service', '[Service]\n')

    writeLegacyFile(legacyRoot, 'manifest/files/crontab.txt', '0 * * * * true\n')

    writeLegacyToml(
      legacyRoot,
      'manifest/common/tools.toml',
      `packages = ["pnpm"]\n\n[node]\nversion = "v25.8.1"\nmanager = "nvm"\n`
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/common/repos.toml',
      `[[repo]]\npath = "~/repos/ArcReel"\nurl = "https://github.com/ArcReel/ArcReel.git"\nbranch = "main"\n`
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/common/appimage.toml',
      `[[app]]\nname = "Obsidian"\ndest_dir = "~/obsidian"\nurl_template = "https://x/{version}/Obsidian-{version}.AppImage"\nversion = "1.12.7"\n`
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/common/checks.toml',
      `[[check]]\nname = "tailscale"\ntype = "cmd"\ntarget = "tailscale status"\nhint = "tailscale up 필요"\n`
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/common/ignore.toml',
      `[apt]\npackages = ["unityhub"]\nsources = ["unityhub.sources"]\n\n[snap]\npackages = ["firefox"]\n`
    )

    writeLegacyToml(
      legacyRoot,
      'manifest/hosts/mainpc/checks.toml',
      `[[check]]\nname = "nvidia-smi"\ntype = "cmd"\ntarget = "nvidia-smi"\nhint = "ubuntu-drivers install"\n`
    )
  })

  afterEach(() => {
    fixture.cleanup()
    fs.rmSync(legacyRoot, { recursive: true, force: true })
  })

  it('reports a missing legacy repo cleanly instead of throwing', async () => {
    const summary = await migrateLegacyManifest(fixture.ctx, '/no/such/legacy/repo', {
      dryRun: true
    })
    expect(summary.items).toEqual([])
    expect(summary.warnings[0]).toContain('없음')
  })

  it('dry-run computes the full summary but writes nothing', async () => {
    const summary = await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: true })
    expect(summary.dryRun).toBe(true)
    const byCap = Object.fromEntries(summary.items.map((i) => [i.capability, i.action]))
    expect(byCap.dotfiles).toBe('migrated')
    expect(byCap.apt).toBe('migrated')
    expect(byCap.snap).toBe('reported-only')
    expect(byCap.flatpak).toBe('migrated')
    expect(byCap.settings).toBe('migrated')
    expect(byCap.services).toBe('migrated')
    expect(byCap.scheduled).toBe('migrated')
    expect(byCap.tools).toBe('migrated')
    expect(byCap.repos).toBe('migrated')
    expect(byCap.appimage).toBe('reported-only')
    expect(byCap.checks).toBe('migrated')
    expect(byCap.ignore).toBe('migrated')
    expect(byCap.hosts).toBe('migrated')

    // dry-run이므로 새 manifestDir엔 아무것도 쓰이지 않았어야 한다.
    expect(fs.existsSync(path.join(fixture.ctx.manifestDir, 'common'))).toBe(false)
  })

  it('snap is reported-only and never written to the new manifest (정책 §7)', async () => {
    await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    const doc = readCommonLayer(fixture.ctx, 'packages') as { snap?: unknown }
    expect(doc.snap).toBeUndefined()
  })

  it('appimage is reported-only with app names, never auto-converted to the T3 schema', async () => {
    const summary = await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    const appimageItem = summary.items.find((i) => i.capability === 'appimage')
    expect(appimageItem?.action).toBe('reported-only')
    expect(appimageItem?.detail).toContain('Obsidian')
    const doc = readCommonLayer(fixture.ctx, 'appimage')
    expect(Object.keys(doc)).toEqual([])
  })

  it('execute actually writes dotfiles (manifest entry + store file byte-identical)', async () => {
    await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    const doc = readCommonLayer(fixture.ctx, 'dotfiles') as {
      entry?: Array<{ home: string; store: string }>
    }
    expect(doc.entry).toEqual([
      { home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }
    ])
    const stored = fs.readFileSync(path.join(fixture.ctx.manifestDir, 'dotfiles/.zshrc'), 'utf-8')
    expect(stored).toBe('export FOO=bar\n')
  })

  it('apt keyring_dest is renamed to keyringDest and the keyring file is copied', async () => {
    await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    const doc = readCommonLayer(fixture.ctx, 'packages') as {
      apt?: { sources?: Array<{ name: string; keyringDest: string }> }
    }
    expect(doc.apt?.sources?.[0]).toEqual({
      name: 'docker.list',
      file: 'packages/apt/sources/docker.list',
      keyringDest: '/usr/share/keyrings/docker.gpg'
    })
    expect(
      fs.existsSync(path.join(fixture.ctx.manifestDir, 'packages/apt/keyrings/docker.gpg'))
    ).toBe(true)
  })

  it('ignore.toml is copied through unchanged (schema is structurally identical)', async () => {
    await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(new Set(['unityhub']))
    expect(readIgnoreSet(fixture.ctx, 'snap', 'packages')).toEqual(new Set(['firefox']))
  })

  it('host overlays preserve their original directory name (mainpc, not the new machineId)', async () => {
    await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    const doc = readManifestFile(
      path.join(fixture.ctx.manifestDir, 'hosts', 'mainpc', 'checks.toml')
    )
    expect((doc as { check?: unknown[] }).check).toHaveLength(1)
  })

  it('settings(dconf) file store is remapped from files/dconf/ to settings/dconf/', async () => {
    await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    const stored = fs.readFileSync(
      path.join(fixture.ctx.manifestDir, 'settings/dconf/org-gnome-desktop-wm-keybindings.ini'),
      'utf-8'
    )
    expect(stored).toBe('[/]\nclose=[]\n')
  })

  it('scheduled crontab.txt is copied to the new fixed store path', async () => {
    await migrateLegacyManifest(fixture.ctx, legacyRoot, { dryRun: false })
    const stored = fs.readFileSync(
      path.join(fixture.ctx.manifestDir, 'scheduled/crontab.txt'),
      'utf-8'
    )
    expect(stored).toBe('0 * * * * true\n')
  })
})
