import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinuxGitTransportProvider } from '../providers/linux/gitTransport'
import { makeFakeGitTransportProvider } from './testHelpers'
import {
  getSyncStatus,
  LIVE_EDIT_COMMIT_MESSAGE,
  sweepLiveEditsIfDirty,
  syncFollower,
  syncReference
} from './sync'

// 픽스처 주의(★): public repo -- 실제 토큰 형식을 흉내내지 않도록 `.repeat()`로
// 조립한 반복 단어 더미만 쓴다(engine/safety/secretScan.test.ts와 동일 원칙).
const FAKE_GITHUB_PAT = 'ghp_' + 'FAKE'.repeat(9)

// git 실행은 전부 temp dir 안의 로컬 bare 원격 + 로컬 clone 사이에서만
// 일어난다(네트워크 없음, 안전 -- 코디네이터 지시).

function sh(cwd: string, args: string[]): void {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} (cwd=${cwd}) failed: ${result.stdout}${result.stderr}`)
  }
}

function initWorkRepo(dir: string, bareDir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  sh(dir, ['git', 'init', '-q', '-b', 'main'])
  sh(dir, ['git', 'config', 'user.email', 'test@example.com'])
  sh(dir, ['git', 'config', 'user.name', 'Test'])
  sh(dir, ['git', 'remote', 'add', 'origin', bareDir])
}

function commitAll(dir: string, message: string): void {
  sh(dir, ['git', 'add', '-A'])
  sh(dir, ['git', 'commit', '-q', '-m', message])
}

interface GitFixture {
  readonly root: string
  readonly bareDir: string
  readonly referenceDir: string
  cleanup(): void
}

function makeGitFixture(): GitFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-transport-'))
  const bareDir = path.join(root, 'origin.git')
  sh(root, ['git', 'init', '-q', '--bare', '-b', 'main', bareDir])

  const referenceDir = path.join(root, 'reference')
  initWorkRepo(referenceDir, bareDir)
  fs.writeFileSync(path.join(referenceDir, 'seed.toml'), 'seed = true\n')
  commitAll(referenceDir, 'seed')
  sh(referenceDir, ['git', 'push', '-q', '-u', 'origin', 'main'])

  return {
    root,
    bareDir,
    referenceDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  }
}

function cloneFollower(fixture: GitFixture, name: string): string {
  const dir = path.join(fixture.root, name)
  sh(fixture.root, ['git', 'clone', '-q', fixture.bareDir, dir])
  sh(dir, ['git', 'config', 'user.email', 'test@example.com'])
  sh(dir, ['git', 'config', 'user.name', 'Test'])
  return dir
}

const provider = new LinuxGitTransportProvider()

describe('git transport (real local git, no network)', () => {
  let fixture: GitFixture

  beforeEach(() => {
    fixture = makeGitFixture()
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('getSyncStatus is local-only for a plain (non-git) directory', async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-plain-'))
    const status = await getSyncStatus({ manifestDir: plainDir }, provider)
    expect(status).toEqual({ kind: 'local-only' })
    fs.rmSync(plainDir, { recursive: true, force: true })
  })

  it('getSyncStatus is local-only for a git repo with no remote', async () => {
    const dir = path.join(fixture.root, 'no-remote')
    fs.mkdirSync(dir)
    sh(dir, ['git', 'init', '-q'])
    expect(await getSyncStatus({ manifestDir: dir }, provider)).toEqual({ kind: 'local-only' })
  })

  it('syncReference commits an uncommitted change and pushes it -- status becomes synced', async () => {
    fs.writeFileSync(path.join(fixture.referenceDir, 'apt.toml'), 'packages = ["git"]\n')
    expect(await provider.hasUncommittedChanges(fixture.referenceDir)).toBe(true)

    const status = await syncReference(
      { manifestDir: fixture.referenceDir, machineId: 'testhost' },
      provider
    )
    expect(status).toEqual({ kind: 'synced' })
    expect(await provider.hasUncommittedChanges(fixture.referenceDir)).toBe(false)

    const log = spawnSync('git', ['-C', fixture.referenceDir, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf-8'
    })
    expect(log.stdout.trim()).toMatch(/^capture: testhost \d{4}-\d{2}-\d{2}$/)
  })

  it('syncReference with nothing to commit still pushes (no-op if already synced) and reports synced', async () => {
    const status = await syncReference(
      { manifestDir: fixture.referenceDir, machineId: 'testhost' },
      provider
    )
    expect(status).toEqual({ kind: 'synced' })
  })

  it('syncReference surfaces a push failure as an error status (no silent retry)', async () => {
    // origin을 존재하지 않는 경로로 바꿔 push가 확실히 실패하게 만든다.
    sh(fixture.referenceDir, ['git', 'remote', 'set-url', 'origin', '/no/such/remote.git'])
    fs.writeFileSync(path.join(fixture.referenceDir, 'x.toml'), 'x = 1\n')
    const status = await syncReference(
      { manifestDir: fixture.referenceDir, machineId: 'testhost' },
      provider
    )
    expect(status.kind).toBe('error')
  })

  // ⑤ push 직전 재검사 -- capture 관문을 우회해(여기서는 테스트가 직접 파일을
  // 써서 시뮬레이션) manifest에 비밀이 실렸다면, 커밋은 허용하되(로컬, 회수
  // 가능) push는 막고 에러로 표면화해야 한다.
  it('syncReference commits but refuses to push when the manifest contains a secret', async () => {
    fs.mkdirSync(path.join(fixture.referenceDir, 'common'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.referenceDir, 'common', 'leaky.toml'),
      `token = "${FAKE_GITHUB_PAT}"\n`
    )

    const status = await syncReference(
      { manifestDir: fixture.referenceDir, machineId: 'testhost' },
      provider
    )

    expect(status.kind).toBe('error')
    if (status.kind === 'error') {
      expect(status.message).toContain('push 중단')
      expect(status.message).not.toContain(FAKE_GITHUB_PAT)
    }
    // 커밋은 됐어야 한다(로컬, 회수 가능) -- push만 막힌다.
    expect(await provider.hasUncommittedChanges(fixture.referenceDir)).toBe(false)
    const log = spawnSync('git', ['-C', fixture.referenceDir, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf-8'
    })
    expect(log.stdout.trim()).toMatch(/^capture: testhost \d{4}-\d{2}-\d{2}$/)
    // 원격(bare repo)엔 아직 새 커밋이 안 보여야 한다 -- push가 실제로 안 갔다는 증거.
    const remoteLog = spawnSync('git', ['-C', fixture.bareDir, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf-8'
    })
    expect(remoteLog.stdout.trim()).not.toMatch(/^capture: testhost/)
  })

  it('syncFollower fetches and fast-forward pulls a new commit from the reference', async () => {
    const followerDir = cloneFollower(fixture, 'follower')

    fs.writeFileSync(path.join(fixture.referenceDir, 'new.toml'), 'x = 1\n')
    commitAll(fixture.referenceDir, 'new file')
    sh(fixture.referenceDir, ['git', 'push', '-q'])

    const status = await syncFollower({ manifestDir: followerDir }, provider)
    expect(status).toEqual({ kind: 'synced' })
    expect(fs.existsSync(path.join(followerDir, 'new.toml'))).toBe(true)
  })

  it('getSyncStatus reflects "behind" only after an explicit fetch (behindCount is fetch-relative)', async () => {
    const followerDir = cloneFollower(fixture, 'follower-behind')

    fs.writeFileSync(path.join(fixture.referenceDir, 'new2.toml'), 'x = 1\n')
    commitAll(fixture.referenceDir, 'new file 2')
    sh(fixture.referenceDir, ['git', 'push', '-q'])

    // fetch 전: 로컬이 아직 origin의 새 커밋을 모른다 -- synced로 보인다(오판이
    // 아니라 "마지막으로 알려진 상태" 계약, 문서화된 동작).
    expect(await getSyncStatus({ manifestDir: followerDir }, provider)).toEqual({ kind: 'synced' })

    await provider.fetch(followerDir)
    expect(await getSyncStatus({ manifestDir: followerDir }, provider)).toEqual({
      kind: 'behind',
      behindBy: 1
    })
  })

  it('syncFollower refuses to auto-resolve a non-fast-forward divergence and surfaces "수동 해결 필요"', async () => {
    const followerDir = cloneFollower(fixture, 'follower-diverged')

    // follower가 로컬에서 독자적으로 커밋(진짜라면 실수 -- follower는 저작하지
    // 않아야 하지만, 비FF 상황을 안전하게 재현하는 가장 쉬운 방법).
    fs.writeFileSync(path.join(followerDir, 'local-only.toml'), 'x = 1\n')
    commitAll(followerDir, 'local divergent commit')

    // reference가 별도로 진전 -- origin이 follower의 HEAD와 무관하게 앞선다.
    fs.writeFileSync(path.join(fixture.referenceDir, 'ref-only.toml'), 'y = 1\n')
    commitAll(fixture.referenceDir, 'reference commit')
    sh(fixture.referenceDir, ['git', 'push', '-q'])

    const status = await syncFollower({ manifestDir: followerDir }, provider)
    expect(status.kind).toBe('error')
    if (status.kind === 'error') {
      expect(status.message).toContain('수동 해결 필요')
    }
    // 로컬 커밋이 그대로 남아있어야 한다 -- 어떤 자동 병합/리셋도 없었다는 증거.
    const log = spawnSync('git', ['-C', followerDir, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf-8'
    })
    expect(log.stdout.trim()).toBe('local divergent commit')
  })
})

// P4(F4/D3-a): reference에서 심링크 너머 라이브 편집이 다음 capture/toggle의
// commit과 섞이지 않고 별도 커밋으로 분리되는지 -- sweepLiveEditsIfDirty를
// syncReference와 조합해 withAutoSync(main/ipc.ts)가 실제로 만드는 "쓰기 전
// 스윕 → 쓰기 → 쓰기 후 커밋" 순서를 재현한다.
describe('sweepLiveEditsIfDirty (P4/F4/D3-a) -- real local git, no network', () => {
  let fixture: GitFixture

  beforeEach(() => {
    fixture = makeGitFixture()
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('is a no-op when the tree is clean', async () => {
    const status = await sweepLiveEditsIfDirty(
      { manifestDir: fixture.referenceDir, role: 'reference' },
      provider
    )
    expect(status).toBeNull()
  })

  it('commits and pushes pre-existing dirt under the live-edit message, separate from a later write', async () => {
    // 라이브 편집 시뮬레이션 -- withAutoSync가 실제 capability write를 부르기
    // 전 시점의 dirty 상태.
    fs.writeFileSync(path.join(fixture.referenceDir, 'dotfiles-zshrc.txt'), 'live edit\n')
    expect(await provider.hasUncommittedChanges(fixture.referenceDir)).toBe(true)

    const sweepStatus = await sweepLiveEditsIfDirty(
      { manifestDir: fixture.referenceDir, role: 'reference' },
      provider
    )
    expect(sweepStatus).toEqual({ kind: 'synced' })
    expect(await provider.hasUncommittedChanges(fixture.referenceDir)).toBe(false)

    // 이제 (withAutoSync의 run()에 해당하는) 캡처 자신의 쓰기가 일어난다 --
    // 트리는 스윕 덕분에 깨끗한 상태에서 시작했다.
    fs.writeFileSync(path.join(fixture.referenceDir, 'apt.toml'), 'packages = ["git"]\n')
    const captureStatus = await syncReference(
      { manifestDir: fixture.referenceDir, machineId: 'testhost' },
      provider
    )
    expect(captureStatus).toEqual({ kind: 'synced' })

    const log = spawnSync(
      'git',
      ['-C', fixture.referenceDir, 'log', '--pretty=%s', '-2', '--reverse'],
      { encoding: 'utf-8' }
    )
    const messages = log.stdout.trim().split('\n')
    expect(messages[0]).toBe(LIVE_EDIT_COMMIT_MESSAGE)
    expect(messages[1]).toMatch(/^capture: testhost \d{4}-\d{2}-\d{2}$/)

    // 두 번째(capture) 커밋의 diff엔 apt.toml만 있어야 한다 -- 라이브 편집과
    // 섞이지 않았다는 증거.
    const showFiles = spawnSync(
      'git',
      ['-C', fixture.referenceDir, 'show', '--name-only', '--pretty=', 'HEAD'],
      { encoding: 'utf-8' }
    )
    expect(showFiles.stdout.trim().split('\n')).toEqual(['apt.toml'])
  })

  it('follower is never swept, even if the tree is dirty (역할 가드)', async () => {
    const followerDir = cloneFollower(fixture, 'follower-live-edit')
    fs.writeFileSync(path.join(followerDir, 'local.conf'), 'edited locally\n')
    expect(await provider.hasUncommittedChanges(followerDir)).toBe(true)

    const status = await sweepLiveEditsIfDirty(
      { manifestDir: followerDir, role: 'follower' },
      provider
    )

    expect(status).toBeNull()
    // 커밋되지 않은 채 그대로 dirty해야 한다 -- follower는 절대 저작하지 않는다.
    expect(await provider.hasUncommittedChanges(followerDir)).toBe(true)
  })

  it('does not call the provider at all for a follower role (fake provider spy)', async () => {
    const fakeProvider = makeFakeGitTransportProvider({
      isGitRepo: true,
      hasRemote: true,
      hasUncommittedChanges: true
    })
    const commitSpy = vi.spyOn(fakeProvider, 'addAllAndCommit')
    const pushSpy = vi.spyOn(fakeProvider, 'push')

    const status = await sweepLiveEditsIfDirty(
      { manifestDir: '/irrelevant', role: 'follower' },
      fakeProvider
    )

    expect(status).toBeNull()
    expect(commitSpy).not.toHaveBeenCalled()
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('commits locally but refuses to push when the swept dirt contains a secret (push 게이트 우회 금지)', async () => {
    fs.mkdirSync(path.join(fixture.referenceDir, 'common'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.referenceDir, 'common', 'leaky.toml'),
      `token = "${FAKE_GITHUB_PAT}"\n`
    )

    const status = await sweepLiveEditsIfDirty(
      { manifestDir: fixture.referenceDir, role: 'reference' },
      provider
    )

    expect(status?.kind).toBe('error')
    if (status?.kind === 'error') {
      expect(status.message).toContain('push 중단')
      expect(status.message).not.toContain(FAKE_GITHUB_PAT)
    }
    // 커밋은 로컬에 남아있어야 한다(회수 가능) -- push만 막힌다.
    expect(await provider.hasUncommittedChanges(fixture.referenceDir)).toBe(false)
    const log = spawnSync('git', ['-C', fixture.referenceDir, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf-8'
    })
    expect(log.stdout.trim()).toBe(LIVE_EDIT_COMMIT_MESSAGE)
    const remoteLog = spawnSync('git', ['-C', fixture.bareDir, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf-8'
    })
    expect(remoteLog.stdout.trim()).not.toBe(LIVE_EDIT_COMMIT_MESSAGE)
  })
})
