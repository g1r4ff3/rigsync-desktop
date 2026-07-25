/**
 * 실제 NVIDIA 드라이버 버전 조회 — `NvidiaCheckProvider`의 Linux 구현.
 * `/proc/driver/nvidia/version`(NVRM 커널 모듈)과 `dpkg-query`(유저스페이스
 * `nvidia-driver-*` 패키지)를 읽는다. 둘 다 읽기 전용.
 */
import fs from 'node:fs'
import type { NvidiaCheckProvider, NvidiaDriverPackage } from '../../doctor/nvidia'
import { run } from './exec'

const NVRM_VERSION_RE = /Kernel Module\s+([0-9][0-9.]*)/

export class LinuxNvidiaCheckProvider implements NvidiaCheckProvider {
  readNvrmVersion(): string | null {
    try {
      const text = fs.readFileSync('/proc/driver/nvidia/version', 'utf-8')
      const match = NVRM_VERSION_RE.exec(text)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  listInstalledDriverPackages(): readonly NvidiaDriverPackage[] {
    const result = run(['dpkg-query', '-W', '-f=${Package}\\t${Version}\\n', 'nvidia-driver-*'])
    if (result.code !== 0) return []
    const out: NvidiaDriverPackage[] = []
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const [name, version] = line.split('\t')
      if (name && version) out.push({ name: name.trim(), version: version.trim() })
    }
    return out
  }
}
