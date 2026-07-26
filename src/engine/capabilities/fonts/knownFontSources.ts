/**
 * 알려진 폰트 레지스트리 — capture는 설치된 폰트 *파일*만 보고는 소스 좌표를
 * 알 수 없다(파일 자체엔 출처 메타데이터가 없다). 여기 없는 파일은 소스
 * 미지정으로 정직하게 남긴다(추측으로 좌표를 지어내지 않는다 — CLAUDE.md
 * 규율과 동일한 원칙, 코디네이터 지시).
 *
 * 최소 2건 포함(이 머신 실측, FORWARD.md 성격의 실측 근거):
 * - MesloLGS NF — Powerlevel10k 요구 폰트 4종, static 소스(버전 개념 없음).
 * - D2Coding — naver/d2codingfont 릴리스 zip, github-release 소스. 파일명에
 *   버전이 박혀 있다(예: "D2Coding-Ver1.3.2-20180524.ttf") — 정확한 최신
 *   파일명을 하드코딩할 수 없어 `assetPattern`은 와일드카드로 release asset을
 *   찾고, `files`는 capture가 실제로 찾은 파일명을 그대로 쓴다.
 */
import type { FontSource } from './types'

export interface KnownFontDefinition {
  readonly name: string
  readonly source: FontSource
  /** 이 파일명이 이 폰트 패밀리 소속인지 판정한다. */
  matches(filename: string): boolean
  /** 파일명에서 버전 문자열을 추출한다(가능하면). 버전이 파일명에 없으면 생략. */
  extractVersion?(filename: string): string | null
  /**
   * 파일명에서 버전을 뺀 "variant 식별자"(예: 일반/Bold 구분)를 돌려준다.
   * github-release 소스처럼 asset 파일명에 버전이 박혀 매번 바뀌는 경우, diff가
   * 정확한 파일명이 아니라 이 식별자 집합으로 "설치됐는지"를 판정한다(★버전
   * drift에도 수렴하기 위한 장치 — static 소스는 버전이 없어 파일명 자체가
   * 이미 안정적인 식별자이므로 생략하면 diff가 파일명을 그대로 쓴다).
   */
  variantKey?(filename: string): string
}

const MESLO_FILE_PATTERN = /^MesloLGS NF (Regular|Bold|Italic|Bold Italic)\.ttf$/

const D2CODING_FILE_PATTERN = /^D2Coding(Bold)?-Ver([0-9.]+-[0-9]+)\.ttf$/i

export const KNOWN_FONTS: readonly KnownFontDefinition[] = [
  {
    name: 'MesloLGS NF',
    source: {
      kind: 'static',
      urls: [
        'https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Regular.ttf',
        'https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Bold.ttf',
        'https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Italic.ttf',
        'https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Bold%20Italic.ttf'
      ]
    },
    matches: (filename) => MESLO_FILE_PATTERN.test(filename)
  },
  {
    name: 'D2Coding',
    source: {
      kind: 'github-release',
      coordinate: 'naver/d2codingfont',
      assetPattern: 'D2Coding-Ver*.zip'
    },
    matches: (filename) => D2CODING_FILE_PATTERN.test(filename),
    extractVersion: (filename) => {
      const match = D2CODING_FILE_PATTERN.exec(filename)
      return match ? match[2] : null
    },
    // 버전(그룹 2)을 뺀 "D2Coding" | "D2CodingBold"만 남긴다 -- release asset이
    // Ver1.3.2든 Ver1.3.3이든 같은 variant로 취급된다.
    variantKey: (filename) => {
      const match = D2CODING_FILE_PATTERN.exec(filename)
      return match ? `D2Coding${match[1] ?? ''}` : filename
    }
  }
]

/** 파일명으로 소속 폰트 패밀리를 찾는다. 없으면 null(소스 미지정). */
export function identifyFontFamily(filename: string): KnownFontDefinition | null {
  return KNOWN_FONTS.find((def) => def.matches(filename)) ?? null
}

/** 폰트 이름(manifest 키)으로 레지스트리 정의를 찾는다 — pinMismatch 버전 추출용. */
export function getKnownFontDefinition(name: string): KnownFontDefinition | null {
  return KNOWN_FONTS.find((def) => def.name === name) ?? null
}
