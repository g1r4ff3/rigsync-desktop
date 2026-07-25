import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LinuxGitTransportProvider } from '../providers/linux/gitTransport'
import { getSyncStatus, syncFollower, syncReference } from './sync'

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

  it('getSyncStatus is local-only for a plain (non-git) directory', () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-plain-'))
    const status = getSyncStatus({ manifestDir: plainDir }, provider)
    expect(status).toEqual({ kind: 'local-only' })
    fs.rmSync(plainDir, { recursive: true, force: true })
  })

  it('getSyncStatus is local-only for a git repo with no remote', () => {
    const dir = path.join(fixture.root, 'no-remote')
    fs.mkdirSync(dir)
    sh(dir, ['git', 'init', '-q'])
    expect(getSyncStatus({ manifestDir: dir }, provider)).toEqual({ kind: 'local-only' })
  })

  it('syncReference commits an uncommitted change and pushes it -- status becomes synced', async () => {
    fs.writeFileSync(path.join(fixture.referenceDir, 'apt.toml'), 'packages = ["git"]\n')
    expect(provider.hasUncommittedChanges(fixture.referenceDir)).toBe(true)

    const status = await syncReference(
      { manifestDir: fixture.referenceDir, machineId: 'testhost' },
      provider
    )
    expect(status).toEqual({ kind: 'synced' })
    expect(provider.hasUncommittedChanges(fixture.referenceDir)).toBe(false)

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
    expect(getSyncStatus({ manifestDir: followerDir }, provider)).toEqual({ kind: 'synced' })

    provider.fetch(followerDir)
    expect(getSyncStatus({ manifestDir: followerDir }, provider)).toEqual({
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
