/**
 * 실제 apt 조회 — `AptProvider`의 Linux 구현. dev 환경에서만 쓰인다(테스트는
 * fake를 주입). 구 repo `probe_apt_manual` 행동 이식 + `/etc/apt/sources.list.d`
 * 파일 읽기.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AptProvider, AptSourceFile } from '../../capabilities/packages/providerTypes'
import { commandExists, run } from './exec'

const LIVE_SOURCES_DIR = '/etc/apt/sources.list.d'

export class LinuxAptProvider implements AptProvider {
  isAvailable(): boolean {
    return commandExists('apt-mark')
  }

  async manualInstalled(): Promise<string[]> {
    const result = await run(['apt-mark', 'showmanual'])
    if (result.code !== 0) return []
    return result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort()
  }

  listSourceFiles(): AptSourceFile[] {
    if (!fs.existsSync(LIVE_SOURCES_DIR)) return []
    const out: AptSourceFile[] = []
    for (const name of fs.readdirSync(LIVE_SOURCES_DIR).sort()) {
      const full = path.join(LIVE_SOURCES_DIR, name)
      try {
        if (!fs.statSync(full).isFile()) continue
        out.push({ name, content: fs.readFileSync(full, 'utf-8') })
      } catch {
        // 읽기 실패 -- 이 파일만 건너뛴다.
      }
    }
    return out
  }

  fileExists(absPath: string): boolean {
    try {
      return fs.statSync(absPath).isFile()
    } catch {
      return false
    }
  }

  readFileBytes(absPath: string): Buffer | null {
    try {
      return fs.readFileSync(absPath)
    } catch {
      return null
    }
  }

  async descriptions(names: readonly string[]): Promise<Readonly<Record<string, string>>> {
    if (names.length === 0) return {}
    // 배치 1회 호출 -- 이름마다 프로세스를 띄우지 않는다. 158개 실측 수십 ms.
    const result = await run(['apt-cache', 'show', ...names], 30_000)
    if (result.code !== 0 && !result.stdout) return {}
    const out: Record<string, string> = {}
    let currentPackage: string | null = null
    for (const line of result.stdout.split('\n')) {
      const pkgMatch = /^Package:\s*(.+)$/.exec(line)
      if (pkgMatch) {
        currentPackage = pkgMatch[1].trim()
        continue
      }
      // 한 패키지에 여러 버전 스탠자가 나올 수 있으니 첫 스탠자(가장 먼저
      // 만난 Description)만 채택한다 -- 이후 같은 이름의 스탠자는 무시.
      if (!currentPackage || currentPackage in out) continue
      const descMatch = /^Description(?:-en)?:\s*(.*)$/.exec(line)
      if (descMatch) out[currentPackage] = descMatch[1].trim()
    }
    return out
  }

  async removeDryRun(names: readonly string[]): Promise<string> {
    const result = await run(['apt-get', 'remove', '--dry-run', ...names], 30_000)
    return result.stdout + result.stderr
  }

  async policySourcesRaw(): Promise<string> {
    const result = await run(['apt-cache', 'policy'], 30_000)
    return result.code === 0 ? result.stdout : ''
  }

  async policyPackagesRaw(names: readonly string[]): Promise<string> {
    if (names.length === 0) return ''
    // 배치 1회 호출 -- 실측 159개 수십 ms.
    const result = await run(['apt-cache', 'policy', ...names], 30_000)
    return result.stdout
  }

  async dependsClosureRaw(metapackages: readonly string[]): Promise<string> {
    if (metapackages.length === 0) return ''
    const result = await run(
      [
        'apt-cache',
        'depends',
        '--recurse',
        '--installed',
        '--no-suggests',
        '--no-conflicts',
        '--no-breaks',
        '--no-replaces',
        '--no-enhances',
        ...metapackages
      ],
      30_000
    )
    return result.code === 0 ? result.stdout : ''
  }

  async prioritiesRaw(): Promise<string> {
    const result = await run(
      ['dpkg-query', '-W', '-f=${Package}\\t${Priority}\\t${db:Status-Status}\\n'],
      30_000
    )
    return result.code === 0 ? result.stdout : ''
  }

  async dpkgOwnsPaths(absPaths: readonly string[]): Promise<ReadonlySet<string>> {
    if (absPaths.length === 0) return new Set()
    // 종료코드는 무시한다 -- 실기 확인(2026-07-27): 여러 경로 중 하나라도
    // 못 찾으면 전체 종료코드가 0이 아니게 된다("no path found matching
    // pattern" 이 stderr로만 나가고, 매치된 나머지는 그대로 stdout에 남는다).
    const result = await run(['dpkg', '-S', ...absPaths], 10_000)
    return parseDpkgOwnedPaths(result.stdout)
  }
}

/**
 * `dpkg -S` 배치 출력(`pkg[,pkg2]: /abs/path` 줄들, 매치 못 한 경로는 stderr로만
 * 나가 여기 안 섞인다)에서 실제로 소유가 확인된 절대경로만 뽑는다. 패키지명이
 * ':'를 포함할 수 있어(예: "git:amd64: /usr/bin/git" 다중 아키텍처) 줄의
 * **마지막** ": " 뒤를 경로로 본다.
 */
export function parseDpkgOwnedPaths(stdout: string): ReadonlySet<string> {
  const owned = new Set<string>()
  for (const line of stdout.split('\n')) {
    const idx = line.lastIndexOf(': ')
    if (idx === -1) continue
    const p = line.slice(idx + 2).trim()
    if (p) owned.add(p)
  }
  return owned
}
