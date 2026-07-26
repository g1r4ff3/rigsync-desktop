/**
 * 실제 tar.gz/tar.bz2 압축 해제 — `TarExtractor`의 구현. binaries capability의
 * uv 같은 github-release 소스는 asset이 tar.gz라 압축 해제가 필요하다.
 * 새 npm 의존성을 넣지 않고 시스템 `tar` 명령을 shell out한다(다른 에이전트가
 * package.json을 동시에 작업 중이라 이번 라운드는 새 런타임 의존성을 넣을 수
 * 없다 — binaries/providerTypes.ts의 `TarExtractor` 주석과 동일한 제약).
 *
 * 절차: `tar -tzf/-tjf`로 아카이브 엔트리 목록을 먼저 읽고, basename이
 * `filter`를 통과하는 엔트리만 임시 디렉터리로 추출한 뒤 destDir에 basename
 * 그대로 복사한다(zip의 `AdmZipExtractor`와 동일하게 아카이브 내부 하위
 * 디렉터리 구조는 무시 — uv 릴리스는 흔히 "uv-x86_64-unknown-linux-gnu/uv"
 * 처럼 폴더 하나로 감싸 배포한다). 실행 권한 부여는 plan.ts가 추출 결과
 * 경로에 대해 일괄 처리한다(코디네이터 지시: "추출 후 실행 권한 부여 필수").
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TarExtractor, TarExtractResult } from '../../capabilities/binaries/providerTypes'
import { run } from './exec'

function listEntries(tarPath: string, listFlag: string): string[] | null {
  const result = run(['tar', listFlag, tarPath], 30_000)
  if (result.code !== 0) return null
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function extract(
  tarPath: string,
  destDir: string,
  filter: (entryName: string) => boolean,
  listFlag: string,
  extractFlag: string
): TarExtractResult {
  const entries = listEntries(tarPath, listFlag)
  if (entries === null) {
    return { ok: false, extractedPaths: [], detail: `tar 목록 조회 실패: ${tarPath}` }
  }

  const matched = entries.filter((entry) => !entry.endsWith('/') && filter(path.basename(entry)))
  if (matched.length === 0) {
    return { ok: true, extractedPaths: [] }
  }

  fs.mkdirSync(destDir, { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-tar-'))
  try {
    const result = run(['tar', extractFlag, tarPath, '-C', tmpDir, ...matched], 60_000)
    if (result.code !== 0) {
      return { ok: false, extractedPaths: [], detail: `tar 추출 실패: ${result.stderr}` }
    }

    const extractedPaths: string[] = []
    for (const entry of matched) {
      const from = path.join(tmpDir, entry)
      const to = path.join(destDir, path.basename(entry))
      try {
        fs.copyFileSync(from, to)
        extractedPaths.push(to)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, extractedPaths, detail: `추출 파일 배치 실패(${entry}): ${message}` }
      }
    }
    return { ok: true, extractedPaths }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export class LinuxTarExtractor implements TarExtractor {
  extractGz(
    tarPath: string,
    destDir: string,
    filter: (entryName: string) => boolean
  ): TarExtractResult {
    return extract(tarPath, destDir, filter, '-tzf', '-xzf')
  }

  extractBz2(
    tarPath: string,
    destDir: string,
    filter: (entryName: string) => boolean
  ): TarExtractResult {
    return extract(tarPath, destDir, filter, '-tjf', '-xjf')
  }
}
