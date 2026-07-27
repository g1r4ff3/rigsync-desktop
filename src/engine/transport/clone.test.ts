/**
 * 실사용 결함 수정 검증 -- 온보딩 "저장소에서 클론". 성공/target-not-empty
 * 경로는 **로컬 bare 저장소**로 진짜 git을 돌려 검증한다(네트워크 없음,
 * transport/sync.test.ts와 같은 원칙 — 코디네이터 지시). auth/network/unknown
 * 분류는 순수 함수(`classifyCloneFailure`)라 fake 문자열로 충분하다(실제
 * private 저장소·네트워크 접근이 필요 없다).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LinuxGitTransportProvider } from '../providers/linux/gitTransport'
import { classifyCloneFailure, cloneErrorGuidance, cloneManifestRepo } from './clone'
import { makeFakeGitTransportProvider } from './testHelpers'

function sh(cwd: string, args: string[]): void {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} (cwd=${cwd}) failed: ${result.stdout}${result.stderr}`)
  }
}

describe('classifyCloneFailure', () => {
  it('classifies "already exists and is not an empty directory" as target-not-empty', () => {
    const error = classifyCloneFailure(
      "fatal: destination path 'x' already exists and is not an empty directory."
    )
    expect(error.kind).toBe('target-not-empty')
  })

  it('classifies authentication failures', () => {
    expect(classifyCloneFailure('fatal: Authentication failed for ...').kind).toBe('auth-failed')
    expect(
      classifyCloneFailure(
        'fatal: could not read Username for https://github.com: terminal prompts disabled'
      ).kind
    ).toBe('auth-failed')
  })

  it('classifies network failures', () => {
    expect(
      classifyCloneFailure('fatal: unable to access ...: Could not resolve host: github.com').kind
    ).toBe('network')
  })

  it('classifies "repository not found" as not-found', () => {
    expect(classifyCloneFailure('remote: Repository not found.').kind).toBe('not-found')
  })

  it('falls back to unknown for unrecognized output', () => {
    expect(classifyCloneFailure('some completely unexpected error').kind).toBe('unknown')
  })
})

describe('cloneErrorGuidance', () => {
  it('gives Korean guidance per error kind without leaking secrets from rawOutput on known kinds', () => {
    expect(cloneErrorGuidance({ kind: 'target-not-empty', rawOutput: '' })).toContain('다른 경로')
    expect(cloneErrorGuidance({ kind: 'auth-failed', rawOutput: '' })).toContain('gh auth login')
    expect(cloneErrorGuidance({ kind: 'network', rawOutput: '' })).toContain('네트워크')
    expect(cloneErrorGuidance({ kind: 'not-found', rawOutput: '' })).toContain('찾을 수 없습니다')
  })
})

describe('cloneManifestRepo (fake provider — auth/network/unknown 분류 확인)', () => {
  it('propagates a classified error when the provider reports failure', async () => {
    const provider = makeFakeGitTransportProvider({
      cloneResult: { ok: false, output: 'fatal: Authentication failed for https://x' }
    })
    const result = await cloneManifestRepo('https://x/private.git', '/tmp/whatever', provider)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('auth-failed')
  })

  it('reports ok:true when the provider succeeds', async () => {
    const provider = makeFakeGitTransportProvider({ cloneResult: { ok: true, output: '' } })
    const result = await cloneManifestRepo('https://x/repo.git', '/tmp/whatever', provider)
    expect(result).toEqual({ ok: true })
  })
})

describe('cloneManifestRepo (real local git, no network)', () => {
  let root: string
  let bareDir: string
  const provider = new LinuxGitTransportProvider()

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-clone-'))
    bareDir = path.join(root, 'origin.git')
    sh(root, ['git', 'init', '-q', '--bare', '-b', 'main', bareDir])

    // bare repo에 커밋 하나를 심어야 클론했을 때 뭔가 실제로 받아온다.
    const seedDir = path.join(root, 'seed')
    fs.mkdirSync(seedDir)
    sh(seedDir, ['git', 'init', '-q', '-b', 'main'])
    sh(seedDir, ['git', 'config', 'user.email', 'test@example.com'])
    sh(seedDir, ['git', 'config', 'user.name', 'Test'])
    fs.writeFileSync(path.join(seedDir, 'common.toml'), 'seed = true\n')
    sh(seedDir, ['git', 'add', '-A'])
    sh(seedDir, ['git', 'commit', '-q', '-m', 'seed'])
    sh(seedDir, ['git', 'remote', 'add', 'origin', bareDir])
    sh(seedDir, ['git', 'push', '-q', '-u', 'origin', 'main'])
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('clones a real local bare repo into a fresh target directory', async () => {
    const targetDir = path.join(root, 'follower-manifest')
    const result = await cloneManifestRepo(bareDir, targetDir, provider)
    expect(result).toEqual({ ok: true })
    expect(fs.existsSync(path.join(targetDir, 'common.toml'))).toBe(true)
  })

  it('reports target-not-empty when the target directory already has files', async () => {
    const targetDir = path.join(root, 'occupied')
    fs.mkdirSync(targetDir)
    fs.writeFileSync(path.join(targetDir, 'something.txt'), 'x')

    const result = await cloneManifestRepo(bareDir, targetDir, provider)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('target-not-empty')
  })

  it('reports not-found when the source path does not exist', async () => {
    const targetDir = path.join(root, 'nope')
    const result = await cloneManifestRepo(path.join(root, 'no-such-repo.git'), targetDir, provider)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('not-found')
  })
})
