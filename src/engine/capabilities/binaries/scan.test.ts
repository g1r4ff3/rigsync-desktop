import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import {
  defaultBinariesInstallDir,
  groupInstalledBinaries,
  isExecutableFile,
  resolveBinariesInstallDir,
  scanExecutableNames
} from './scan'

function writeExecutable(fixture: TestFixture, relDir: string, filename: string): string {
  const dir = path.join(fixture.homeDir, relDir)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, filename)
  fs.writeFileSync(target, '#!/bin/sh\necho fake\n')
  fs.chmodSync(target, 0o755)
  return target
}

function writeNonExecutable(fixture: TestFixture, relDir: string, filename: string): string {
  const dir = path.join(fixture.homeDir, relDir)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, filename)
  fs.writeFileSync(target, 'not a script')
  fs.chmodSync(target, 0o644)
  return target
}

describe('defaultBinariesInstallDir / resolveBinariesInstallDir', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('defaults to ~/.local/bin', () => {
    expect(defaultBinariesInstallDir(fixture.ctx)).toBe(path.join(fixture.homeDir, '.local', 'bin'))
  })

  it('resolves an entry-declared installDir with ~ expansion', () => {
    expect(resolveBinariesInstallDir(fixture.ctx, '~/bin')).toBe(path.join(fixture.homeDir, 'bin'))
  })

  it('falls back to the default when installDir is not declared', () => {
    expect(resolveBinariesInstallDir(fixture.ctx, undefined)).toBe(
      defaultBinariesInstallDir(fixture.ctx)
    )
  })
})

describe('isExecutableFile', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('is true for a file with the executable bit set', () => {
    const p = writeExecutable(fixture, '.local/bin', 'uv')
    expect(isExecutableFile(p)).toBe(true)
  })

  it('is false for a non-executable file', () => {
    const p = writeNonExecutable(fixture, '.local/bin', 'env')
    expect(isExecutableFile(p)).toBe(false)
  })

  it('is false for a path that does not exist', () => {
    expect(isExecutableFile(path.join(fixture.homeDir, '.local', 'bin', 'nope'))).toBe(false)
  })
})

describe('scanExecutableNames / groupInstalledBinaries', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('lists only executable files directly inside the given directory (no recursion)', () => {
    writeExecutable(fixture, '.local/bin', 'uv')
    writeNonExecutable(fixture, '.local/bin', 'env')
    fs.mkdirSync(path.join(fixture.homeDir, '.local', 'bin', 'a-subdir'), { recursive: true })
    const names = scanExecutableNames(defaultBinariesInstallDir(fixture.ctx))
    expect(names).toEqual(['uv'])
  })

  it('returns empty results when the install directory does not exist', () => {
    expect(scanExecutableNames(defaultBinariesInstallDir(fixture.ctx))).toEqual([])
  })

  it('groups resolved executables by registry name and separates unresolved ones (real machine fixture: uv, uvx, micromamba + noise)', () => {
    writeExecutable(fixture, '.local/bin', 'uv')
    writeExecutable(fixture, '.local/bin', 'uvx')
    writeExecutable(fixture, '.local/bin', 'micromamba')
    // 실사례: 사용자 스크립트·uv tool 심링크류는 관리 대상이 아니다.
    writeExecutable(fixture, '.local/bin', 'sync-claude-to-opencode.sh')
    writeExecutable(fixture, '.local/bin', 'rtk')

    const { resolvedByName, unresolvedFiles } = groupInstalledBinaries(fixture.ctx)
    expect(resolvedByName.get('uv')?.sort()).toEqual(['uv', 'uvx'])
    expect(resolvedByName.get('micromamba')).toEqual(['micromamba'])
    expect([...unresolvedFiles].sort()).toEqual(['rtk', 'sync-claude-to-opencode.sh'])
  })

  it(
    '실사례(코디네이터 확인): ~/micromamba/envs/<name>/bin/uv 같은 conda/micromamba 환경 스코프 ' +
      '설치는 절대 스캔·후보로 잡히지 않는다 -- installDir(기본 ~/.local/bin)만 관리 대상이다 ' +
      '(환경 안 도구는 그 환경의 lockfile/스펙이 버전을 책임진다, FORWARD.md §7 정책 비목표)',
    () => {
      // 전역 uv(0.11.2 격) -- 관리 대상.
      writeExecutable(fixture, '.local/bin', 'uv')
      // 같은 이름의 환경 스코프 uv(예: conda-forge 0.10.4) -- 절대 섞이면 안 됨.
      writeExecutable(fixture, 'micromamba/envs/yolo26pose/bin', 'uv')
      // micromamba base 환경엔 uv가 없고 uvicorn만 있는 실사례 -- 이름이 비슷해도
      // 다른 실행파일이라 애초에 매칭되지 않는다.
      writeExecutable(fixture, 'micromamba/bin', 'uvicorn')

      const { resolvedByName, unresolvedFiles } = groupInstalledBinaries(fixture.ctx)
      // 기본 installDir(~/.local/bin) 스캔 결과엔 전역 uv 하나만 잡힌다 --
      // micromamba/envs 아래는 디렉터리 자체가 스캔 범위 밖이라 등장할 수 없다.
      expect(resolvedByName.get('uv')).toEqual(['uv'])
      expect(unresolvedFiles).toEqual([])

      // scanExecutableNames가 재귀하지 않는다는 계약을 직접 재확인 -- 기본
      // installDir 결과 목록 자체에 환경 스코프 디렉터리의 흔적이 전혀 없다.
      expect(scanExecutableNames(defaultBinariesInstallDir(fixture.ctx))).toEqual(['uv'])
    }
  )
})
