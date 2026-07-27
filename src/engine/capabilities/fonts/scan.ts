/**
 * 설치된 폰트 파일 스캔 — capture/diff/checks(doctor)가 공유하는 순수 fs 로직.
 * dotfiles capability와 같은 원칙으로 provider 뒤에 숨기지 않는다(외부 시스템
 * 명령이 아니라 ctx.homeDir 기준 fs 읽기라 테스트가 temp dir을 직접 주입할 수
 * 있다 — dotfiles/capture.ts와 동일한 패턴).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { identifyFontFamily, type KnownFontDefinition } from './knownFontSources'
import type { FontEntry } from './types'

const FONT_FILE_PATTERN = /\.(ttf|otf|ttc|woff2?)$/i

/**
 * 폰트가 설치될 수 있는 디렉터리들 — `~/.local/share/fonts`(항상)와
 * `~/.fonts`(레거시, 존재할 때만). apply는 `~/.local/share/fonts/<name>/`에만
 * 설치하지만(capture-first 원칙과 무관하게 착지점 하나로 통일), capture는
 * 사용자가 어느 쪽에 수동 설치했든 전부 스캔한다(코디네이터 지시).
 */
export function fontDirs(ctx: Pick<RigsyncContext, 'homeDir'>): string[] {
  const primary = path.join(ctx.homeDir, '.local', 'share', 'fonts')
  const legacy = path.join(ctx.homeDir, '.fonts')
  const dirs = [primary]
  if (fs.existsSync(legacy)) dirs.push(legacy)
  return dirs
}

/** apply가 새 폰트를 설치할 착지점 — `~/.local/share/fonts/<name>/`. */
export function fontInstallDir(ctx: Pick<RigsyncContext, 'homeDir'>, name: string): string {
  return path.join(ctx.homeDir, '.local', 'share', 'fonts', sanitizeDirName(name))
}

function sanitizeDirName(name: string): string {
  return name.replace(/[/\\]/g, '-')
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (FONT_FILE_PATTERN.test(entry.name)) {
      out.push(entry.name)
    }
  }
}

/** 폰트 디렉터리들(하위 디렉터리 포함)을 재귀 스캔해 설치된 파일명 목록을 돌려준다. */
export function scanInstalledFontFiles(ctx: Pick<RigsyncContext, 'homeDir'>): string[] {
  const out: string[] = []
  for (const dir of fontDirs(ctx)) walk(dir, out)
  return out
}

export interface GroupedInstalledFonts {
  /** 레지스트리로 식별된 폰트 이름 -> 그 패밀리에 속한다고 판정된 설치 파일명. */
  readonly resolvedByName: ReadonlyMap<string, string[]>
  /** 레지스트리 어디에도 매칭되지 않는 설치 파일명 — "소스 미지정" 후보. */
  readonly unresolvedFiles: readonly string[]
  /** 파일명 -> 매칭된 레지스트리 정의(있으면). */
  readonly definitionByFile: ReadonlyMap<string, KnownFontDefinition>
}

/**
 * 파일명 목록(예: `groupInstalledFontFiles().resolvedByName`이 돌려주는 이름
 * 그대로)에 대응하는 실제 전체 경로를 fontDirs() 하위(재귀)에서 찾는다.
 * `scanInstalledFontFiles`/`walk`는 디렉터리 구조를 버리고 파일명만 돌려주므로
 * (capture는 이름만 필요) uninstall처럼 실제로 지울 경로가 필요한 호출자를
 * 위해 별도로 둔다 — 기존 스캔 계약(파일명만)은 건드리지 않는다.
 */
export function locateFontFiles(
  ctx: Pick<RigsyncContext, 'homeDir'>,
  filenames: readonly string[]
): string[] {
  const wanted = new Set(filenames)
  const out: string[] = []

  function walkForPaths(dir: string): void {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkForPaths(full)
      } else if (wanted.has(entry.name)) {
        out.push(full)
      }
    }
  }

  for (const dir of fontDirs(ctx)) walkForPaths(dir)
  return out
}

/**
 * 설치된 폰트 파일을 분류한다 — capture/candidates/doctor/diff가 공유.
 *
 * 식별의 1차 진실은 **manifest** 다(실사용 버그 수정, 2026-07-27): manifest
 * 엔트리의 `files`에 정확히 등장하는 파일명은 하드코딩 레지스트리 패턴이
 * 무엇을 인식하든 그 엔트리 이름 소속으로 분류하고 unresolvedFiles에서
 * 제외한다. 레지스트리(`identifyFontFamily`) 매칭은 manifest에 없는 파일에
 * 대해서만(미등록 파일 자동 인식용 보조) 적용한다. 이러면 하드코딩 패턴이
 * 아직 못 따라잡은 새 파일 종류(예: D2Coding의 .ttc·-ligature 변종)도, 이미
 * capture가 예전에 잡아 manifest에 박아 둔 경우라면 "재현 불가"로 오탐되지
 * 않는다.
 *
 * `scanInstalledFontFiles`가 돌려주는 파일명은 `~/.fonts`와
 * `~/.local/share/fonts` 양쪽에 같은 파일이 있으면 중복될 수 있어(fontDirs가
 * 둘 다 스캔), 분류 전에 Set으로 걷어낸다 — resolvedByName·unresolvedFiles
 * 어디에도 같은 파일명이 두 번 나오지 않는다(Doctor 경고 중복 방지).
 */
export function groupInstalledFontFiles(
  ctx: Pick<RigsyncContext, 'homeDir'>,
  manifestEntries: readonly FontEntry[] = []
): GroupedInstalledFonts {
  const manifestNameByFile = new Map<string, string>()
  for (const entry of manifestEntries) {
    for (const file of entry.files) {
      if (!manifestNameByFile.has(file)) manifestNameByFile.set(file, entry.name)
    }
  }

  const resolvedByName = new Map<string, string[]>()
  const definitionByFile = new Map<string, KnownFontDefinition>()
  const unresolvedFiles: string[] = []

  for (const filename of new Set(scanInstalledFontFiles(ctx))) {
    const def = identifyFontFamily(filename)
    if (def) definitionByFile.set(filename, def)

    const name = manifestNameByFile.get(filename) ?? def?.name
    if (!name) {
      unresolvedFiles.push(filename)
      continue
    }
    const list = resolvedByName.get(name) ?? []
    list.push(filename)
    resolvedByName.set(name, list)
  }

  return { resolvedByName, unresolvedFiles: unresolvedFiles.sort(), definitionByFile }
}
