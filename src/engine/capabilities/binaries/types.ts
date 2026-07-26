/**
 * binaries capability manifest 스키마 + capture/diff 리포트 — `~/.local/bin`에
 * `curl | sh`로 떨어지는 단독 실행파일(uv, micromamba 등)을 동기화 대상으로
 * 담는다. fonts capability와 같은 원칙(2026-07-26 결정 계승): 실행파일 자체를
 * 동기화하지 않고 다운로드 좌표만 manifest에 선언한다 — 실제 바이너리는 apply
 * 때 이 좌표로 받는다("동기화 단위는 매니페스트", FORWARD.md §3/§7).
 *
 * v1 소스는 github-release 하나뿐이다(코디네이터 지시 — curl|sh로 배포되는
 * 도구는 실질적으로 전부 GitHub 릴리스 asset이 출처라 fonts의 static 소스
 * 같은 것이 필요 없다). asset은 세 가지 형태로 갈린다:
 * - single-binary: 압축 없이 실행파일 그 자체가 asset(예: micromamba-linux-64).
 * - tar.gz / tar.bz2: 압축 안에 실행파일 하나 이상(예: uv-x86_64-unknown-linux-gnu.tar.gz
 *   안의 uv+uvx).
 * (zip은 fonts capability의 AdmZipExtractor를 그대로 재사용한다 — 이번
 * 레지스트리엔 없지만 타입은 지원해 둔다.)
 */

export type BinaryAssetKind = 'single-binary' | 'tar.gz' | 'tar.bz2' | 'zip'

export interface BinaryGithubReleaseSource {
  readonly kind: 'github-release'
  /** "owner/repo" 형식 (예: "astral-sh/uv"). */
  readonly coordinate: string
  /**
   * 릴리스 asset 파일명 매칭 패턴 — `*` 와일드카드 지원(예:
   * "uv-x86_64-unknown-linux-gnu.tar.gz"). 이번 레지스트리 항목은 실측 결과
   * 아키텍처가 고정돼 있어 와일드카드 없이 정확한 파일명이지만, 패턴 매칭
   * 로직 자체는 fonts와 동일하게 유지한다(향후 아키텍처 분기 대비).
   */
  readonly assetPattern: string
  readonly assetKind: BinaryAssetKind
}

export type BinarySource = BinaryGithubReleaseSource

export interface BinaryEntry {
  /** manifest 키 — 도구 이름(예: "uv", "micromamba"). */
  readonly name: string
  readonly source: BinarySource
  /**
   * 이 엔트리가 설치하는 실행파일 이름 목록(디렉터리 없이 파일명만, 예:
   * ["uv", "uvx"]) — diff가 이 이름들이 installDir에 실행 가능한 형태로
   * 있는지로 판정한다. fonts의 버전이 파일명에 박히는 경우와 달리 실행파일
   * 이름 자체는 버전과 무관한 고정값이라(uv는 항상 "uv"), capture는 레지스트리가
   * 아니라 **실제로 발견한 이름 그대로**를 기록한다(일부만 설치돼 있으면 그
   * 일부만).
   */
  readonly binaries: readonly string[]
  /** 설치 디렉터리 — 생략하면 `~/.local/bin`(기본값). `~` 표기 허용. */
  readonly installDir?: string
  /**
   * 선택적 버전 고정. capture는 이 값을 절대 자동 설정하지 않는다(fonts/appimage와
   * 동일 계약 — 사용자가 수동으로 건 값만 재캡처 때 보존한다).
   */
  readonly pin?: string | null
}

export interface BinariesCaptureReport {
  readonly capturedCount: number
  readonly added: number
  /** 알려진 레지스트리에 없어 manifest에 담지 못한 실행파일 등 -- 재현 불가 항목 보고. */
  readonly notes: readonly string[]
}

export interface BinariesPinMismatch {
  readonly name: string
  readonly pinned: string
  readonly installedVersion: string
}

export interface BinariesDiffReport {
  /** manifest에 선언됐지만 binaries 중 일부/전부가 없거나 실행 불가능한 엔트리 이름. */
  readonly toInstall: readonly string[]
  /** pin이 설정돼 있고, 실행 파일에서 확인한 버전이 pin과 다른 경우. */
  readonly pinMismatch: readonly BinariesPinMismatch[]
  /** 레지스트리로 식별되지만 manifest엔 없는 도구 이름 — Candidates 화면용. */
  readonly uncaptured: readonly string[]
}
