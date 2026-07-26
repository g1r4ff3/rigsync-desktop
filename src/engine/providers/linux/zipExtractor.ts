/**
 * 실제 zip 압축 해제 — `ZipExtractor`의 구현. D2Coding 같은 github-release
 * 폰트 소스는 asset이 zip이라(appimage의 다운로더엔 없던 신규 기능) 압축
 * 해제가 필요하다. adm-zip(순수 JS, 런타임 의존성 0개, 0.6.0부터 자체
 * TypeScript 타입 포함)을 쓴다 — 0.6.0 미만은 "크래프트된 ZIP이 4GB 메모리
 * 할당을 유발"하는 고위험 취약점(GHSA-xcpc-8h2w-3j85)이 있어 반드시 그 이상.
 */
import AdmZip from 'adm-zip'
import fs from 'node:fs'
import path from 'node:path'
import type { ZipExtractor, ZipExtractResult } from '../../capabilities/fonts/providerTypes'

export class AdmZipExtractor implements ZipExtractor {
  extract(
    zipPath: string,
    destDir: string,
    filter: (entryName: string) => boolean
  ): ZipExtractResult {
    let zip: AdmZip
    try {
      zip = new AdmZip(zipPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, extractedPaths: [], detail: `zip 열기 실패: ${message}` }
    }

    fs.mkdirSync(destDir, { recursive: true })
    const extractedPaths: string[] = []
    try {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        // zip 내부 경로는 무시하고 basename만 filter에 넘긴다 -- D2Coding zip은
        // 흔히 하위 폴더에 폰트 파일을 담는다(예: "D2Coding/D2Coding-Ver....ttf").
        const baseName = path.basename(entry.entryName)
        if (!filter(baseName)) continue
        const destPath = path.join(destDir, baseName)
        fs.writeFileSync(destPath, entry.getData())
        extractedPaths.push(destPath)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, extractedPaths, detail: `zip 추출 실패: ${message}` }
    }

    return { ok: true, extractedPaths }
  }
}
