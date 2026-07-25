/**
 * RigsyncContext — 엔진 함수가 전부 명시 인자로 받는 실행 컨텍스트
 * (아키텍처 규칙: 전역 상태 금지). main이 실제 config.toml에서
 * `resolveContext()`로 만들어 넘기고, 테스트는 temp dir로 직접 구성해 주입한다.
 *
 * 확정 설계(코디네이터 P1 지시): `~/.config/rigsync-desktop/config.toml`이
 * 있으면 그것을, 없으면 dev 기본값(machineId=hostname, role='reference',
 * manifestDir=~/.local/share/rigsync-desktop/manifest)을 쓴다. 온보딩
 * 위저드(P4)가 나중에 이 config.toml을 만든다.
 *
 * `homeDir`·`backupRoot`는 코디네이터의 3필드 명세(machineId/role/manifestDir)
 * 에는 없지만 이번 구현에서 ctx에 추가했다 — dotfiles capture/apply는 `~`를
 * 실제 파일시스템 어딘가로 풀어야 하고, 백업 루트도 "ctx로 주입 가능하게"가
 * 명시 요구사항이었다(안전선 항목). 이를 전역 `os.homedir()`/하드코딩 상수에
 * 박아두면 테스트가 개발자의 진짜 $HOME을 건드리게 되므로, "전역 상태 금지 —
 * 테스트가 temp dir ctx를 주입" 원칙을 dotfiles에도 그대로 적용한 확장이다.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'

export type Role = 'reference' | 'follower'

export interface RigsyncContext {
  readonly machineId: string
  readonly role: Role
  /** manifest(common/hosts/dotfiles store)의 루트 디렉터리. */
  readonly manifestDir: string
  /** `~` 확장의 기준 홈 디렉터리. */
  readonly homeDir: string
  /** 덮어쓰기 전 백업을 쌓는 루트 (런별로 <backupRoot>/<ISO timestamp>/). */
  readonly backupRoot: string
}

export interface ResolvedContext {
  readonly ctx: RigsyncContext
  /** true면 config.toml이 없어 dev 기본값을 썼다는 뜻 (온보딩 미완료). */
  readonly firstRun: boolean
}

function defaultConfigPath(homeDir: string): string {
  return path.join(homeDir, '.config', 'rigsync-desktop', 'config.toml')
}

function defaultManifestDir(homeDir: string): string {
  return path.join(homeDir, '.local', 'share', 'rigsync-desktop', 'manifest')
}

function devDefaultContext(homeDir: string): RigsyncContext {
  return {
    machineId: os.hostname(),
    role: 'reference',
    manifestDir: defaultManifestDir(homeDir),
    homeDir,
    backupRoot: path.join(homeDir, '.rigsync-backup')
  }
}

/**
 * 실제 config.toml을 읽어 컨텍스트를 만든다. `configPath`/`homeDir`는 기본값이
 * 있지만 테스트가 override할 수 있게 인자로 남겨둔다(전역 os.homedir() 직접
 * 호출을 피한다).
 */
export function resolveContext(
  homeDir: string = os.homedir(),
  configPath: string = defaultConfigPath(homeDir)
): ResolvedContext {
  if (!fs.existsSync(configPath)) {
    return { ctx: devDefaultContext(homeDir), firstRun: true }
  }

  const raw = parseToml(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
  const machineId =
    typeof raw.machineId === 'string' && raw.machineId ? raw.machineId : os.hostname()
  const role: Role = raw.role === 'follower' ? 'follower' : 'reference'
  const manifestDir =
    typeof raw.manifestDir === 'string' && raw.manifestDir
      ? raw.manifestDir
      : defaultManifestDir(homeDir)
  const backupRoot =
    typeof raw.backupRoot === 'string' && raw.backupRoot
      ? raw.backupRoot
      : path.join(homeDir, '.rigsync-backup')

  return { ctx: { machineId, role, manifestDir, homeDir, backupRoot }, firstRun: false }
}
