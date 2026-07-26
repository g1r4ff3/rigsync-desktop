import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { buildReposSyncGroup } from './candidates'
import { REPOS_LAYER } from './constants'
import { makeFakeGitProvider } from './testHelpers'

// 신규 테스트 -- R6 R2: repos의 "이게 뭔지" 설명은 remote URL이다. managed
// 항목은 manifest에 이미 있는 url을 그대로 쓰고(재조회 없음), live/후보
// 항목만 GitProvider.remoteUrl로 물어본다.

function makePlainRepo(scanBase: string, name: string): string {
  const p = path.join(scanBase, name)
  fs.mkdirSync(path.join(p, '.git'), { recursive: true })
  return p
}

describe('buildReposSyncGroup', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.cleanup()
    fixture = null
  })

  it('returns null when there is nothing managed or scanned', async () => {
    fixture = makeFixture('reference')
    const group = await buildReposSyncGroup(fixture.ctx, makeFakeGitProvider())
    expect(group).toBeNull()
  })

  it('uses the manifest url for a managed entry without calling the git provider', async () => {
    fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, REPOS_LAYER, {
      repo: [
        {
          path: '~/repos/rigsync-desktop',
          url: 'git@github.com:me/rigsync-desktop.git',
          branch: 'main'
        }
      ]
    })

    const git = makeFakeGitProvider({
      remotes: { '~/repos/rigsync-desktop': 'should-not-be-used' }
    })
    const group = await buildReposSyncGroup(fixture.ctx, git)
    expect(group).not.toBeNull()
    const item = group!.items.find((i) => i.key === '~/repos/rigsync-desktop')
    expect(item?.managed).toBe(true)
    expect(item?.description).toBe('git@github.com:me/rigsync-desktop.git')
  })

  it('falls back to the git provider remote url for an unmanaged (scanned) candidate', async () => {
    const scanBase = fs.mkdtempSync(path.join(os.tmpdir(), 'repos-scan-'))
    fixture = makeFixture('reference', { settings: { repoScanDirs: [scanBase] } })
    const scratch = makePlainRepo(scanBase, 'scratch')

    const git = makeFakeGitProvider({ remotes: { [scratch]: 'https://example.com/scratch.git' } })
    const group = await buildReposSyncGroup(fixture.ctx, git)
    expect(group).not.toBeNull()
    const item = group!.items.find((i) => i.label.endsWith('scratch'))
    expect(item?.managed).toBe(false)
    expect(item?.description).toBe('https://example.com/scratch.git')

    fs.rmSync(scanBase, { recursive: true, force: true })
  })

  it('omits the description when the managed entry has no remote url (no live re-query)', async () => {
    fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, REPOS_LAYER, {
      repo: [{ path: '~/repos/no-remote', url: '', branch: 'main' }]
    })
    // 만약 재조회한다면 이 fake가 값을 돌려주겠지만, managed 항목은 manifest의
    // url을 그대로 써야 하므로(재조회 없음) 여전히 description이 없어야 한다.
    const git = makeFakeGitProvider({
      remotes: { [`${fixture.ctx.homeDir}/repos/no-remote`]: 'should-not-be-used' }
    })
    const group = await buildReposSyncGroup(fixture.ctx, git)
    const item = group!.items.find((i) => i.key === '~/repos/no-remote')
    expect(item?.description).toBeUndefined()
  })
})
