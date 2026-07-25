/**
 * 실제 GitHub Releases 조회 — `AssetResolver`의 GithubUpdater 구현. 정책
 * §3.3/FORWARD.md §7의 WRITE 전략 1단계("좌표→최신 asset URL 해석, GitHub
 * REST API 등, fetch는 주입 가능하게"). Node 18+ 전역 `fetch`를 쓴다 —
 * 별도 HTTP 의존성 없음.
 */
import type { AssetResolver, ReleaseAsset } from '../../capabilities/appimage/providerTypes'

interface GithubReleaseAsset {
  readonly name: string
  readonly browser_download_url: string
}

interface GithubRelease {
  readonly assets?: readonly GithubReleaseAsset[]
}

export class GithubAssetResolver implements AssetResolver {
  async resolveAsset(
    coordinate: string,
    repoFilename: string,
    tag?: string | null
  ): Promise<ReleaseAsset | null> {
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

    const asset = (release.assets ?? []).find(
      (a) => a.name.toLowerCase() === repoFilename.toLowerCase()
    )
    if (!asset) return null

    return { name: asset.name, downloadUrl: asset.browser_download_url }
  }
}
