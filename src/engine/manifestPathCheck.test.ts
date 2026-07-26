/**
 * 실사용 결함 수정 검증 -- 온보딩 "기존 경로 지정"의 검증. **경고만 만들고
 * 진행 자체는 막지 않는다** — 함수는 항상 어떤 값이든 반환하고, 절대 던지지
 * 않는다(호출자가 warnings를 그대로 보여줄 뿐).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkExistingManifestPath } from './manifestPathCheck'
import { makeFakeGitTransportProvider } from './transport/testHelpers'

describe('checkExistingManifestPath', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-pathcheck-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('warns (but does not block) when the path does not exist yet', () => {
    const targetDir = path.join(root, 'does-not-exist')
    const result = checkExistingManifestPath(targetDir, makeFakeGitTransportProvider())
    expect(result.exists).toBe(false)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('아직 없습니다')
  })

  it('warns when the path exists but is not a git repo', () => {
    const targetDir = path.join(root, 'plain')
    fs.mkdirSync(targetDir)
    const result = checkExistingManifestPath(
      targetDir,
      makeFakeGitTransportProvider({ isGitRepo: false })
    )
    expect(result.isGitRepo).toBe(false)
    expect(result.warnings.some((w) => w.includes('git 저장소가 아닙니다'))).toBe(true)
  })

  it('warns when it is a git repo but has no remote (this is exactly the real-world bug)', () => {
    const targetDir = path.join(root, 'local-only')
    fs.mkdirSync(targetDir)
    const result = checkExistingManifestPath(
      targetDir,
      makeFakeGitTransportProvider({ isGitRepo: true, hasRemote: false })
    )
    expect(result.hasRemote).toBe(false)
    expect(result.warnings.some((w) => w.includes('원격이 연결돼 있지 않습니다'))).toBe(true)
  })

  it('warns when common/ is missing even if git+remote are fine (still just a warning)', () => {
    const targetDir = path.join(root, 'no-manifest-structure')
    fs.mkdirSync(targetDir)
    const result = checkExistingManifestPath(
      targetDir,
      makeFakeGitTransportProvider({ isGitRepo: true, hasRemote: true })
    )
    expect(result.hasManifestStructure).toBe(false)
    expect(result.warnings.some((w) => w.includes('manifest(common/)가 없습니다'))).toBe(true)
  })

  it('has no warnings for a fully valid existing manifest (git + remote + common/)', () => {
    const targetDir = path.join(root, 'valid')
    fs.mkdirSync(path.join(targetDir, 'common'), { recursive: true })
    const result = checkExistingManifestPath(
      targetDir,
      makeFakeGitTransportProvider({ isGitRepo: true, hasRemote: true })
    )
    expect(result.warnings).toEqual([])
  })
})
