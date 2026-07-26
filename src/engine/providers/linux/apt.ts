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

  manualInstalled(): string[] {
    const result = run(['apt-mark', 'showmanual'])
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

  descriptions(names: readonly string[]): Readonly<Record<string, string>> {
    if (names.length === 0) return {}
    // 배치 1회 호출 -- 이름마다 프로세스를 띄우지 않는다. 158개 실측 수십 ms.
    const result = run(['apt-cache', 'show', ...names], 30_000)
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
}
