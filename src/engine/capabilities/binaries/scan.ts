/**
 * 설치된 실행파일 스캔 — capture/diff/candidates가 공유하는 순수 fs 로직.
 * fonts capability의 scan.ts와 같은 원칙으로 provider 뒤에 숨기지 않는다
 * (외부 시스템 명령이 아니라 ctx.homeDir 기준 fs 읽기라 테스트가 temp dir을
 * 직접 주입할 수 있다).
 *
 * fonts와 달리 **재귀 스캔하지 않는다** — `~/.local/bin`은 `curl | sh` 배포
 * 관례상 평면 디렉터리다(폰트처럼 apply가 `<name>/` 하위 디렉터리를 만들지
 * 않는다).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { expandHome } from '../../paths'
import {
  identifyBinaryDefinitionByExecutable,
  type KnownBinaryDefinition
} from './knownBinarySources'

/** 기본 설치 디렉터리 — `~/.local/bin`. */
export function defaultBinariesInstallDir(ctx: Pick<RigsyncContext, 'homeDir'>): string {
  return path.join(ctx.homeDir, '.local', 'bin')
}

/** manifest entry가 선언한 installDir(있으면 `~` 확장)을 풀거나, 없으면 기본값. */
export function resolveBinariesInstallDir(
  ctx: Pick<RigsyncContext, 'homeDir'>,
  installDir?: string
): string {
  return installDir ? expandHome(ctx, installDir) : defaultBinariesInstallDir(ctx)
}

/** 실행 권한이 있는 파일(또는 그런 파일을 가리키는 심볼릭 링크)인지. */
export function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * dir 안의 실행 가능한 항목 이름을 나열한다(하위 디렉터리 없이 평면 —
 * `~/.local/bin`엔 디렉터리가 없는 게 관례라 디렉터리 자체는 건너뛴다).
 * 이 디렉터리엔 사용자 스크립트·다른 도구가 설치한 심볼릭 링크도 섞여
 * 있으므로(예: uv tool로 설치된 `pyright`, 수동 스크립트 `sync-*.sh`) 여기는
 * "실행 가능한 이름 전부"만 나열하고, 알려진 레지스트리로 분류하는 것은
 * `groupInstalledBinaries`의 몫이다 — 사용자 스크립트를 관리 대상으로 잘못
 * 끌어들이지 않기 위한 분리다.
 */
export function scanExecutableNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    const full = path.join(dir, entry.name)
    if (isExecutableFile(full)) out.push(entry.name)
  }
  return out
}

export interface GroupedInstalledBinaries {
  /** 레지스트리로 식별된 도구 이름 -> 그 도구 소속으로 확인된 실행파일 이름들. */
  readonly resolvedByName: ReadonlyMap<string, string[]>
  /** 레지스트리 어디에도 매칭되지 않는 실행파일 이름(사용자 스크립트 포함) — "소스 미지정" 후보. */
  readonly unresolvedFiles: readonly string[]
  readonly definitionByFile: ReadonlyMap<string, KnownBinaryDefinition>
}

/**
 * installDir의 실행파일들을 레지스트리로 분류한다 — capture/candidates가
 * 공유. 레지스트리에 없는 이름(사용자 스크립트·다른 패키지 매니저가 설치한
 * 도구 등)은 `unresolvedFiles`로만 표시되고 어떤 "관리 후보" 목록에도 오르지
 * 않는다(fonts의 동일 계약).
 */
export function groupInstalledBinaries(
  ctx: Pick<RigsyncContext, 'homeDir'>,
  installDir: string = defaultBinariesInstallDir(ctx)
): GroupedInstalledBinaries {
  const resolvedByName = new Map<string, string[]>()
  const definitionByFile = new Map<string, KnownBinaryDefinition>()
  const unresolvedFiles: string[] = []

  for (const filename of scanExecutableNames(installDir)) {
    const def = identifyBinaryDefinitionByExecutable(filename)
    if (!def) {
      unresolvedFiles.push(filename)
      continue
    }
    definitionByFile.set(filename, def)
    const list = resolvedByName.get(def.name) ?? []
    list.push(filename)
    resolvedByName.set(def.name, list)
  }

  return { resolvedByName, unresolvedFiles: unresolvedFiles.sort(), definitionByFile }
}
