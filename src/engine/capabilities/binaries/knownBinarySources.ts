/**
 * 알려진 단독 바이너리 레지스트리 — `curl | sh`로 `~/.local/bin`에 떨어지는
 * 실행파일은 그 자체에 출처 메타데이터가 없어 이름만으로는 좌표를 알 수
 * 없다. 여기 없는 실행파일은 소스 미지정으로 정직하게 남긴다(좌표를 추측하지
 * 않는다 — CLAUDE.md 규율과 동일 원칙, 코디네이터 지시).
 *
 * v1은 x86_64만 다룬다 — 다른 아키텍처는 이 레지스트리에 없으니 자동으로
 * "소스 미지정"으로 떨어진다(조용히 틀린 바이너리를 받지 않는다).
 *
 * 실측(이 머신, 2026-07-26):
 * - uv 0.11.2 (x86_64-unknown-linux-gnu) / uvx 0.11.2 — astral-sh/uv,
 *   tar.gz 자산(uv-x86_64-unknown-linux-gnu.tar.gz) 안에 uv+uvx 두 실행파일.
 * - micromamba 2.3.3 — mamba-org/micromamba-releases, 압축 없는 단독 바이너리
 *   자산(micromamba-linux-64).
 */
import type { BinarySource } from './types'

export interface KnownBinaryDefinition {
  /** manifest 키(=capture가 쓰는 이름). */
  readonly name: string
  readonly source: BinarySource
  /** 이 정의가 설치하는 실행파일 이름들(정확 일치, 버전과 무관한 고정값). */
  readonly binaries: readonly string[]
  /** 버전 확인 명령에 넘길 인자(예: ['--version']). */
  readonly versionArgs: readonly string[]
  /** 버전 확인 명령의 결합 출력(stdout+stderr)에서 버전 문자열을 뽑는다. 못 뽑으면 null. */
  parseVersion(output: string): string | null
}

// "uv 0.11.2 (x86_64-unknown-linux-gnu)" / "uvx 0.11.2 (x86_64-unknown-linux-gnu)" -> "0.11.2"
const UV_VERSION_PATTERN = /^\S+\s+(\S+)/

function parseFirstWhitespaceToken(output: string): string | null {
  const trimmed = output.trim()
  return trimmed.length > 0 ? trimmed.split(/\s+/)[0] : null
}

export const KNOWN_BINARIES: readonly KnownBinaryDefinition[] = [
  {
    name: 'uv',
    source: {
      kind: 'github-release',
      coordinate: 'astral-sh/uv',
      assetPattern: 'uv-x86_64-unknown-linux-gnu.tar.gz',
      assetKind: 'tar.gz'
    },
    binaries: ['uv', 'uvx'],
    versionArgs: ['--version'],
    parseVersion: (output) => UV_VERSION_PATTERN.exec(output.trim())?.[1] ?? null
  },
  {
    name: 'micromamba',
    source: {
      kind: 'github-release',
      coordinate: 'mamba-org/micromamba-releases',
      assetPattern: 'micromamba-linux-64',
      assetKind: 'single-binary'
    },
    binaries: ['micromamba'],
    versionArgs: ['--version'],
    // "2.3.3" -> 그대로.
    parseVersion: parseFirstWhitespaceToken
  }
]

/** 실행파일 이름(예: "uv")으로 소속 정의를 찾는다. 없으면 null(소스 미지정). */
export function identifyBinaryDefinitionByExecutable(
  executableName: string
): KnownBinaryDefinition | null {
  return KNOWN_BINARIES.find((def) => def.binaries.includes(executableName)) ?? null
}

/** 도구 이름(manifest 키)으로 레지스트리 정의를 찾는다 — pinMismatch 버전 확인용. */
export function getKnownBinaryDefinition(name: string): KnownBinaryDefinition | null {
  return KNOWN_BINARIES.find((def) => def.name === name) ?? null
}
