/**
 * capability 테스트 전반이 공유하는 fixture. Vitest include 패턴
 * (`*.{test,spec}.ts`)에 안 걸리므로 테스트 파일이 아니다.
 *
 * 구 repo `tests/test_dotfiles.py`/`tests/test_ignore.py`의 `TestBase`류
 * (HOME 환경변수를 temp dir로 patch)와 동등한 역할을 하되, 전역 상태
 * (process.env.HOME)를 건드리지 않고 RigsyncContext.homeDir/manifestDir/
 * backupRoot를 temp dir로 명시 주입한다 (아키텍처 규칙: 전역 상태 금지 — 엔진
 * 함수는 ctx를 인자로 받고, 테스트는 그 ctx를 직접 구성해서 준다).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RigsyncContext, RigsyncSettings } from './context'
import {
  writeCommonLayer,
  writeManifestFile,
  hostLayerPath,
  profileLayerPath,
  type ManifestDocument
} from './manifest'

export interface TestFixture {
  readonly ctx: RigsyncContext
  readonly homeDir: string
  readonly manifestDir: string
  cleanup(): void
}

export interface MakeFixtureOptions {
  /** P2c: 있으면 ctx.profile을 세팅해 common→profile→host 3단 병합을 테스트할 수 있다. */
  readonly profile?: string
  /** P2d: settings/services/scheduled/tools/repos capability용 config.toml [settings] 오버라이드. */
  readonly settings?: RigsyncSettings
}

export function makeFixture(
  role: RigsyncContext['role'] = 'reference',
  options: MakeFixtureOptions = {}
): TestFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-desktop-test-'))
  const homeDir = path.join(root, 'home')
  const manifestDir = path.join(root, 'manifest')
  fs.mkdirSync(homeDir, { recursive: true })

  const ctx: RigsyncContext = {
    machineId: 'testhost',
    role,
    manifestDir,
    homeDir,
    backupRoot: path.join(homeDir, '.rigsync-backup'),
    aptBaselinePath: path.join(homeDir, '.local', 'share', 'rigsync-desktop', 'apt-baseline.txt'),
    settings: options.settings ?? {},
    autostartEnabled: false,
    ...(options.profile ? { profile: options.profile } : {})
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

/** ignore.toml(common 또는 host 오버레이)을 직접 써 넣는다 — 구 `write_ignore` 이식. */
export function writeIgnore(fixture: TestFixture, data: ManifestDocument, host = false): void {
  if (host) {
    writeManifestFile(hostLayerPath(fixture.ctx, 'ignore'), data)
  } else {
    writeCommonLayer(fixture.ctx, 'ignore', data)
  }
}

/** P2c: profiles/<profile>/<layer>.toml을 직접 써 넣는다 (3단 병합 테스트용). */
export function writeProfileLayer(
  fixture: TestFixture,
  profile: string,
  layer: string,
  data: ManifestDocument
): void {
  writeManifestFile(profileLayerPath(fixture.ctx, profile, layer), data)
}
