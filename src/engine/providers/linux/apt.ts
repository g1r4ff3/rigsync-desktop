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
}
