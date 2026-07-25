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
import { parse as parseToml, stringify as stringifyToml, type TomlTable } from 'smol-toml'

export type Role = 'reference' | 'follower'

/**
 * P2d: config.toml `[settings]` 테이블 — 구 repo `cfg.setting(*keys, default)`가
 * 읽던 `rigsync.toml`의 사용자 조정 값들(감시할 dconf 경로, repos 스캔 디렉터리,
 * nvm 버전 핀 등) 묶음. 각 capability가 이 값 없이도 동작해야 하므로(빈 설정 =
 * "아직 아무것도 감시하지 않음") 전부 optional이고, 개별 capability에서
 * `?? []`/`?? 기본값`으로 받는다.
 */
export interface RigsyncSettings {
  /** dconf 레이어가 dump/load할 절대 경로 목록 (예: "/org/gnome/desktop/wm/keybindings"). */
  readonly dconfPaths?: readonly string[]
  /** repos 레이어가 depth-1로 스캔할 디렉터리 (예: "~/repos"). */
  readonly repoScanDirs?: readonly string[]
  /** scan_dirs 밖에 있지만 관리하고 싶은 개별 저장소 경로. */
  readonly repoExtra?: readonly string[]
  /** nvm 설치 스크립트 버전 핀 (기본 "v0.40.3" — 구 repo 기본값과 동일). */
  readonly nvmVersion?: string
  /**
   * P3: 트레이 상주 drift 체크 반복 간격(시간 단위). 기본
   * `DEFAULT_DRIFT_CHECK_INTERVAL_HOURS`(6), 0이면 스케줄러 전체 비활성(첫
   * 체크도 하지 않음 — "감시 끔" 의미로 해석; `main/scheduler.ts` 주석 참조).
   */
  readonly driftCheckIntervalHours?: number
}

/** P3 drift 체크 반복 간격 기본값 (시간) — config.toml에 없으면 이 값. */
export const DEFAULT_DRIFT_CHECK_INTERVAL_HOURS = 6

export interface RigsyncContext {
  readonly machineId: string
  readonly role: Role
  /** manifest(common/hosts/dotfiles store)의 루트 디렉터리. */
  readonly manifestDir: string
  /** `~` 확장의 기준 홈 디렉터리. */
  readonly homeDir: string
  /** 덮어쓰기 전 백업을 쌓는 루트 (런별로 <backupRoot>/<ISO timestamp>/). */
  readonly backupRoot: string
  /**
   * P2c: 있으면 manifest 오버레이가 `common → profile → host` 3단으로
   * 병합된다(FORWARD.md §7 "profiles 계층"). 없으면 profile 단계는 건너뛰고
   * 기존 common→host 2단 그대로(하위 호환).
   */
  readonly profile?: string
  /**
   * P2c apt baseline 필터: `apt-mark showmanual` 전체 스냅샷을 저장하는 경로.
   * 기본은 `<homeDir>/.local/share/rigsync-desktop/apt-baseline.txt`지만
   * 테스트가 temp 경로로 주입할 수 있어야 한다(안전선 — 실제 홈을 안 건드림).
   */
  readonly aptBaselinePath: string
  /** P2d: 사용자 조정 설정 묶음 (없으면 모든 capability가 빈 배열/기본값으로 취급). */
  readonly settings: RigsyncSettings
  /** P4: 로그인 자동 시작(XDG autostart) 활성 여부 — 온보딩 위저드/트레이 메뉴가 토글. */
  readonly autostartEnabled: boolean
}

export interface ResolvedContext {
  readonly ctx: RigsyncContext
  /** true면 config.toml이 없어 dev 기본값을 썼다는 뜻 (온보딩 미완료). */
  readonly firstRun: boolean
}

export function defaultConfigPath(homeDir: string): string {
  return path.join(homeDir, '.config', 'rigsync-desktop', 'config.toml')
}

export function defaultManifestDir(homeDir: string): string {
  return path.join(homeDir, '.local', 'share', 'rigsync-desktop', 'manifest')
}

function defaultAptBaselinePath(homeDir: string): string {
  return path.join(homeDir, '.local', 'share', 'rigsync-desktop', 'apt-baseline.txt')
}

function devDefaultContext(homeDir: string): RigsyncContext {
  return {
    machineId: os.hostname(),
    role: 'reference',
    manifestDir: defaultManifestDir(homeDir),
    homeDir,
    backupRoot: path.join(homeDir, '.rigsync-backup'),
    aptBaselinePath: defaultAptBaselinePath(homeDir),
    settings: {},
    autostartEnabled: false
  }
}

function readSettings(raw: Record<string, unknown>): RigsyncSettings {
  const table = raw.settings
  if (typeof table !== 'object' || table === null || Array.isArray(table)) return {}
  const t = table as Record<string, unknown>
  const strings = (v: unknown): readonly string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
  return {
    ...(strings(t.dconfPaths) ? { dconfPaths: strings(t.dconfPaths) } : {}),
    ...(strings(t.repoScanDirs) ? { repoScanDirs: strings(t.repoScanDirs) } : {}),
    ...(strings(t.repoExtra) ? { repoExtra: strings(t.repoExtra) } : {}),
    ...(typeof t.nvmVersion === 'string' && t.nvmVersion ? { nvmVersion: t.nvmVersion } : {}),
    ...(typeof t.driftCheckIntervalHours === 'number' && Number.isFinite(t.driftCheckIntervalHours)
      ? { driftCheckIntervalHours: t.driftCheckIntervalHours }
      : {})
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
  const aptBaselinePath =
    typeof raw.aptBaselinePath === 'string' && raw.aptBaselinePath
      ? raw.aptBaselinePath
      : defaultAptBaselinePath(homeDir)
  const profile = typeof raw.profile === 'string' && raw.profile ? raw.profile : undefined
  const settings = readSettings(raw)
  const autostartEnabled = raw.autostartEnabled === true

  return {
    ctx: {
      machineId,
      role,
      manifestDir,
      homeDir,
      backupRoot,
      aptBaselinePath,
      profile,
      settings,
      autostartEnabled
    },
    firstRun: false
  }
}

// --------------------------------------------------------------------------
// 온보딩 위저드(P4) — config.toml 쓰기
// --------------------------------------------------------------------------

export interface OnboardingConfig {
  readonly machineId: string
  readonly role: Role
  readonly manifestDir: string
  readonly profile?: string
  readonly autostartEnabled: boolean
}

/**
 * 온보딩 위저드 완료 시 config.toml을 쓰는 유일한 통로. `resolveContext()`가
 * 읽는 필드와 1:1 대응한다 — 필드를 추가하면 여기와 `resolveContext` 양쪽을
 * 같이 고친다.
 */
export function writeConfigFile(
  homeDir: string,
  config: OnboardingConfig,
  configPath: string = defaultConfigPath(homeDir)
): void {
  const doc: Record<string, unknown> = {
    machineId: config.machineId,
    role: config.role,
    manifestDir: config.manifestDir,
    autostartEnabled: config.autostartEnabled,
    ...(config.profile ? { profile: config.profile } : {})
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, stringifyToml(doc as unknown as TomlTable))
}
