/**
 * dotfiles 테스트 전용 fixture. Vitest include 패턴(`*.{test,spec}.ts`)에
 *안 걸리므로 테스트 파일이 아니다 — 헬퍼만 모아둔다.
 *
 * 구 repo `tests/test_dotfiles.py`의 `DotfilesTestBase`(HOME 환경변수를 temp
 * dir로 patch)와 동등한 역할을 하되, 전역 상태(process.env.HOME)를 건드리지
 * 않고 RigsyncContext.homeDir/manifestDir/backupRoot를 temp dir로 명시
 * 주입한다 (아키텍처 규칙: 전역 상태 금지 — 엔진 함수는 ctx를 인자로 받는다).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RigsyncContext } from '../../context'

export interface TestFixture {
  readonly ctx: RigsyncContext
  readonly homeDir: string
  readonly manifestDir: string
  cleanup(): void
}

export function makeFixture(role: RigsyncContext['role'] = 'reference'): TestFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-desktop-test-'))
  const homeDir = path.join(root, 'home')
  const manifestDir = path.join(root, 'manifest')
  fs.mkdirSync(homeDir, { recursive: true })

  const ctx: RigsyncContext = {
    machineId: 'testhost',
    role,
    manifestDir,
    homeDir,
    backupRoot: path.join(homeDir, '.rigsync-backup')
  }

  return {
    ctx,
    homeDir,
    manifestDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  }
}

export function writeHomeFile(
  fixture: TestFixture,
  relPath: string,
  content: string,
  mode?: number
): string {
  const p = path.join(fixture.homeDir, relPath)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  if (mode !== undefined) fs.chmodSync(p, mode)
  return p
}
