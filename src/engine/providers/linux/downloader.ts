/**
 * 실제 파일 다운로드 — `Downloader`의 구현. `fetch` + 스트리밍 파일 쓰기.
 * AppImage 바이너리 자체는 동기화 대상이 아니고(정책 §4) 여기서 딱 한 번,
 * apply 시점에만 받는다.
 */
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import type { DownloadResult, Downloader } from '../../capabilities/appimage/providerTypes'

export class FetchDownloader implements Downloader {
  async download(url: string, destPath: string): Promise<DownloadResult> {
    try {
      const response = await fetch(url)
      if (!response.ok || !response.body) {
        return { ok: false, detail: `download 실패: HTTP ${response.status}` }
      }
      // lib.dom.d.ts와 @types/node의 ReadableStream 제네릭이 미묘하게 어긋나
      // (양쪽 다 전역 `ReadableStream`을 선언) Readable.fromWeb의 시그니처와
      // 구조적으로 안 맞는다고 나온다 -- node:stream/web 타입으로 명시 캐스팅.
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>),
        fs.createWriteStream(destPath)
      )
      return { ok: true, detail: destPath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, detail: `download 실패: ${message}` }
    }
  }
}
