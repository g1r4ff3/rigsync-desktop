/**
 * 실제 GitHub Releases 조회 — fonts capability의 `FontAssetResolver` 구현.
 * appimage의 `GithubAssetResolver`와 거의 같지만 정확 일치가 아니라
 * **와일드카드 패턴 매칭**이다(D2Coding처럼 asset 파일명이 매 릴리스마다
 * 버전/날짜를 포함해 바뀌기 때문 — 예: "D2Coding-Ver1.3.3-20260725.zip").
 * Node 18+ 전역 `fetch`를 쓴다 — 별도 HTTP 의존성 없음.
 */
import type { FontAssetResolver, FontReleaseAsset } from '../../capabilities/fonts/providerTypes'

interface GithubReleaseAsset {
  readonly name: string
  readonly browser_download_url: string
}

interface GithubRelease {
  readonly assets?: readonly GithubReleaseAsset[]
}

/** `*`만 지원하는 단순 와일드카드 -> 정규식. 나머지 특수문자는 이스케이프한다. */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

export class FontsGithubAssetResolver implements FontAssetResolver {
  async resolveAsset(
    coordinate: string,
    assetPattern: string,
    tag?: string | null
  ): Promise<FontReleaseAsset | null> {
    const url = tag
      ? `https://api.github.com/repos/${coordinate}/releases/tags/${encodeURIComponent(tag)}`
      : `https://api.github.com/repos/${coordinate}/releases/latest`

    let response: Response
    try {
      response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
    } catch {
      return null
    }
    if (!response.ok) return null

    let release: GithubRelease
    try {
      release = (await response.json()) as GithubRelease
    } catch {
      return null
    }

    const regex = wildcardToRegExp(assetPattern)
    const asset = (release.assets ?? []).find((a) => regex.test(a.name))
    if (!asset) return null

    return { name: asset.name, downloadUrl: asset.browser_download_url }
  }
}
