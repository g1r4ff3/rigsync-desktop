/**
 * NVIDIA 커널 모듈(NVRM) vs 유저스페이스 드라이버(dpkg) 버전 불일치 체크 —
 * P4 doctor 확장. 이 머신이 실제로 이 상태다(2026-07-25 실측): NVRM
 * 580.159.03(커널 모듈, 마지막 재부팅 시점 고정) vs dpkg
 * nvidia-driver-580 580.173.02(유저스페이스, apt가 이미 업그레이드함) —
 * apt가 드라이버 패키지를 올렸지만 재부팅 전이라 커널 모듈은 구버전 그대로인
 * 흔한 상태. 불일치 자체는 시스템 오류가 아니라 "재부팅하면 해소되는" 정상
 * 과도 상태이므로 doctor가 fail이 아니라 warning으로만 표면화한다.
 *
 * GPU가 없는 머신(NVRM 파일도 없고 dpkg 드라이버 패키지도 없음)은 이 체크
 * 자체를 skip 취급한다(`applicable:false`).
 */
import type { MaybePromise } from '../async'

export interface NvidiaDriverPackage {
  readonly name: string
  readonly version: string
}

export interface NvidiaCheckProvider {
  /** `/proc/driver/nvidia/version`에서 뽑은 NVRM 커널 모듈 버전 문자열, 파일 없으면 null. */
  readNvrmVersion(): string | null
  /** `dpkg-query`로 찾은 `nvidia-driver-*` 패키지들(설치된 것만). */
  listInstalledDriverPackages(): MaybePromise<readonly NvidiaDriverPackage[]>
}

export interface NvidiaDriverCheckResult {
  /** false면 이 머신에 NVIDIA GPU/드라이버 자체가 없다는 뜻 — doctor에서 skip 취급. */
  readonly applicable: boolean
  readonly nvrmVersion: string | null
  readonly userspaceVersion: string | null
  readonly matched: boolean
  readonly warning?: string
}

/**
 * dpkg 버전 문자열은 흔히 데비안 리비전이 붙는다(예: "580.173.02-0ubuntu0.24.04.1")
 * — NVRM은 순수 업스트림 버전만 보고한다("580.173.02"). 선행 `[0-9.]+` 구간만
 * 비교 기준으로 뽑는다.
 */
function upstreamVersion(version: string): string {
  const match = /^[0-9][0-9.]*/.exec(version)
  return match ? match[0] : version
}

export async function checkNvidiaDriverMismatch(
  provider: NvidiaCheckProvider
): Promise<NvidiaDriverCheckResult> {
  const nvrmVersion = provider.readNvrmVersion()
  const packages = await provider.listInstalledDriverPackages()

  if (!nvrmVersion && packages.length === 0) {
    return { applicable: false, nvrmVersion: null, userspaceVersion: null, matched: true }
  }

  const nvrmMajor = nvrmVersion?.split('.')[0]
  const matchingPackage =
    packages.find((p) => upstreamVersion(p.version).split('.')[0] === nvrmMajor) ??
    packages[0] ??
    null
  const userspaceVersion = matchingPackage?.version ?? null
  const matched =
    nvrmVersion !== null &&
    userspaceVersion !== null &&
    nvrmVersion === upstreamVersion(userspaceVersion)

  if (matched) {
    return { applicable: true, nvrmVersion, userspaceVersion, matched: true }
  }

  const warning =
    nvrmVersion && userspaceVersion
      ? `NVIDIA 커널 모듈(${nvrmVersion})과 유저스페이스 드라이버(${userspaceVersion})가 다릅니다 -- 드라이버 업데이트 후 재부팅 필요`
      : !nvrmVersion
        ? `nvidia-driver 패키지는 설치돼 있지만(${userspaceVersion}) 커널 모듈이 로드되지 않았습니다 -- 재부팅 필요`
        : `NVIDIA 커널 모듈(${nvrmVersion})은 로드됐지만 대응하는 nvidia-driver 패키지를 찾을 수 없습니다`

  return { applicable: true, nvrmVersion, userspaceVersion, matched: false, warning }
}
