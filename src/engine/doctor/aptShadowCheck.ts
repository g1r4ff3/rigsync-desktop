/**
 * apt PATH shadowing 검사 — 관리(managed, manifest에 선언된) apt 패키지가
 * dpkg로 설치돼 있는데, PATH 해석 순서상 같은 이름의 **dpkg 밖(비관리)**
 * 실행파일이 먼저 잡히는 경우를 경고한다(예: `/usr/local/bin`이
 * `/usr/bin`을 가림). planApt의 사전 경고(`findNonDpkgConflicts`,
 * `../capabilities/packages/apt.ts`)와 자매 검사다 — 그쪽은 "설치 전" 시점
 * (아직 설치 안 된 패키지가 곧 충돌할 것)을, 이쪽은 "이미 설치된 뒤 계속
 * 가려지고 있는" 정상 상태를 본다. 둘 다 실증 사례(rclone 공식 설치
 * 스크립트가 apt 설치로 아무 고지 없이 덮일 뻔한 사고) 재발 방지의
 * 일반 장치다.
 *
 * **한계** — 패키지명과 실행파일명이 같다고 가정한다(예: `ripgrep` 패키지의
 * 실행파일 `rg`는 이 검사가 못 잡는다). helpCopy에 명시.
 *
 * PATH는 **프로세스 PATH**(`process.env.PATH`)를 쓴다 — rigsync 앱이 실제로
 * 관측 가능한 유일한 PATH다("앱이 아는 사실만 말한다" 원칙). 사용자 로그인
 * 셸이 `.bashrc`/`.zshrc` 등에서 PATH를 다르게 구성했다면 이 검사가 그 차이를
 * 볼 수 없다는 한계도 helpCopy에 명시한다.
 *
 * 해소 명령은 **표시만** 한다 — 안전 불변식 5(삭제는 앱이 자발적으로 하지
 * 않는다)에 따라 이 모듈은 어떤 파일도 지우지 않는다.
 */
import path from 'node:path'
import type { RigsyncContext } from '../context'
import { readEffectivePackages } from '../capabilities/packages/io'
import type { AptProvider } from '../capabilities/packages/providerTypes'

export interface AptShadowFinding {
  readonly packageName: string
  /** PATH에서 가장 먼저 잡히는 dpkg 밖 실행파일의 절대경로. */
  readonly shadowingPath: string
  /** dpkg가 실제로 관리하는 설치본의 절대경로 (PATH에서 shadowingPath 뒤에 있음). */
  readonly dpkgOwnedPath: string
  /** 사용자에게 보여줄 해소 명령 — 표시만, 이 모듈은 절대 실행하지 않는다. */
  readonly resolveCommand: string
}

export interface AptShadowCheckResult {
  readonly findings: readonly AptShadowFinding[]
  readonly warnings: readonly string[]
}

function currentPathDirs(): string[] {
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
}

export function checkAptShadowing(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  provider: Pick<AptProvider, 'isAvailable' | 'fileExists' | 'dpkgOwnsPath'>,
  pathDirs: readonly string[] = currentPathDirs()
): AptShadowCheckResult {
  if (!provider.isAvailable()) return { findings: [], warnings: [] }

  const managed = readEffectivePackages(ctx).apt?.packages ?? []
  const findings: AptShadowFinding[] = []

  for (const name of managed) {
    let shadowingPath = ''
    let dpkgOwnedPath = ''
    for (const dir of pathDirs) {
      const candidate = path.join(dir, name)
      if (!provider.fileExists(candidate)) continue
      if (provider.dpkgOwnsPath(candidate)) {
        dpkgOwnedPath = candidate
        break // dpkg 소유본을 만났다 -- 그 앞에 비관리본이 없었으면 정상 상태.
      }
      if (!shadowingPath) shadowingPath = candidate
      // 비관리본을 만나도 계속 찾아 뒤쪽의 dpkg 소유본을 확인한다.
    }
    if (shadowingPath && dpkgOwnedPath) {
      findings.push({
        packageName: name,
        shadowingPath,
        dpkgOwnedPath,
        resolveCommand: `sudo rm ${shadowingPath}`
      })
    }
  }

  const warnings = findings.map(
    (f) =>
      `${f.packageName}: ${f.shadowingPath}가 dpkg 관리본(${f.dpkgOwnedPath})을 PATH에서 가리고 ` +
      `있습니다. 해소 명령(표시만 — 직접 확인 후 실행하세요): ${f.resolveCommand}`
  )

  return { findings, warnings }
}
