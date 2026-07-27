/**
 * dotfiles manifest 엔트리 + capture/diff 리포트 타입. 필드 이름은 구 repo
 * manifest TOML 스키마(`[[entry]]` — home/store/type/link/mode)를 그대로
 * 따른다(정신적 호환 — CLAUDE.md "manifest 포맷은 TOML 유지").
 */
import type { SecretFinding } from '../../safety/secretScan'

/** 내용 수준 비밀 스캔에 걸려 스토어에 담기지 않은 entry 하나. */
export interface SecretScanBlockedEntry {
  readonly home: string
  /** 절대 원문 값을 담지 않는다 — 경로+줄 번호+패턴 종류+마스킹된 발췌뿐. */
  readonly findings: readonly SecretFinding[]
}

export interface DotfileEntry {
  /** `~` 축약형 홈 경로. manifest의 유일 키(host overlay key field). */
  readonly home: string
  /** manifestDir 기준 상대 스토어 경로 (예: "dotfiles/.zshrc"). */
  readonly store: string
  readonly type: 'file' | 'dir'
  /**
   * true(기본)=symlink apply, false=copy+chmod apply — 단 이 의미는
   * **reference role에서만** 유효하다. follower role에서는 이 필드 값과
   * 무관하게 항상 copy+chmod로 배포한다(F3/D2-b, diff.ts·plan.ts 참조) —
   * follower의 홈 파일은 manifest로의 라이브 뷰가 아니라 배포 결과물이어야
   * 하기 때문이다. 즉 `link`는 실질적으로 "reference에서 심링크로 둘지"만
   * 결정한다.
   */
  readonly link?: boolean
  /** link=false일 때만 의미 있는 8진수 문자열 권한 (예: "600"). */
  readonly mode?: string
}

export interface CaptureReport {
  readonly capability: 'dotfiles'
  readonly seededNew: number
  readonly copied: number
  readonly alreadyLinked: number
  readonly skippedDenylist: number
  readonly missingHome: number
  readonly skippedBrokenSymlink: number
  readonly skippedInvalidStore: number
  /** ignore.toml에 의해 건너뛴(그리고 manifest에서 제거된) 엔트리 수. */
  readonly ignored: number
  /** 내용 수준 비밀 스캔에 걸려 스토어·manifest 어느 쪽에도 담기지 않은 entry 수. */
  readonly skippedSecretScan: number
  /** 차단된 entry별 상세(경로+줄 번호+패턴 종류만 — 값은 절대 없음). */
  readonly secretScanBlocked: readonly SecretScanBlockedEntry[]
  readonly notes: readonly string[]
}

export interface DiffReport {
  readonly capability: 'dotfiles'
  /** symlink apply가 필요한 엔트리 (home 문자열). */
  readonly toLink: readonly string[]
  /** copy-mode 엔트리 중 내용/권한이 다른 것. 권한만 다르면 "<home> (mode a != b)" 형태. */
  readonly contentChanged: readonly string[]
  /** 홈에 아예 없는 엔트리. */
  readonly missingHome: readonly string[]
  /** manifest의 store 필드가 manifestDir을 벗어나 무효 처리된 엔트리. */
  readonly invalidStore: readonly string[]
}
