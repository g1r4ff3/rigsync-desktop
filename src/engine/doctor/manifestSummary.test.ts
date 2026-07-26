import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOTFILES_LAYER } from '../capabilities/dotfiles/constants'
import { PACKAGES_LAYER } from '../capabilities/packages/constants'
import { SCHEDULED_STORE_REL_PATH } from '../capabilities/scheduled/constants'
import { writeCommonLayer } from '../manifest'
import { makeFixture } from '../testFixtures'
import { countManifestDeclarations } from './manifestSummary'

describe('countManifestDeclarations', () => {
  it('is 0 for a brand new manifest directory with no layer files at all (the real-world bug case)', () => {
    const fixture = makeFixture('follower')
    expect(countManifestDeclarations(fixture.ctx)).toBe(0)
    fixture.cleanup()
  })

  it('counts top-level array entries across capability layers generically', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [
        { home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file' },
        { home: '~/.gitconfig', store: 'dotfiles/.gitconfig', type: 'file' }
      ]
    })
    writeCommonLayer(fixture.ctx, PACKAGES_LAYER, {
      packages: ['git', 'tmux', 'ripgrep'],
      snap: [{ name: 'code', classic: true }]
    })
    // dotfiles: 2 + packages.packages: 3 + packages.snap: 1 = 6
    expect(countManifestDeclarations(fixture.ctx)).toBe(6)
    fixture.cleanup()
  })

  it('counts a non-empty scheduled(cron) store file as one declaration', () => {
    const fixture = makeFixture('reference')
    const scheduledPath = path.join(fixture.manifestDir, SCHEDULED_STORE_REL_PATH)
    fs.mkdirSync(path.dirname(scheduledPath), { recursive: true })
    fs.writeFileSync(scheduledPath, '0 3 * * * /usr/bin/backup.sh\n')
    expect(countManifestDeclarations(fixture.ctx)).toBe(1)
    fixture.cleanup()
  })

  it('does not count a scheduled store file that is present but blank', () => {
    const fixture = makeFixture('reference')
    const scheduledPath = path.join(fixture.manifestDir, SCHEDULED_STORE_REL_PATH)
    fs.mkdirSync(path.dirname(scheduledPath), { recursive: true })
    fs.writeFileSync(scheduledPath, '\n\n')
    expect(countManifestDeclarations(fixture.ctx)).toBe(0)
    fixture.cleanup()
  })
})
