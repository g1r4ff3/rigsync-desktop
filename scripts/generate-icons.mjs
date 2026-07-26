#!/usr/bin/env node
/**
 * `build/icon.svg`(소스 오브 트루스) → 앱 아이콘 산출물 일괄 생성.
 *
 * - `build/icon.png` / `resources/icon.png` — 512px 마스터 (기존에도 두 파일이
 *   바이트 동일했으므로 그대로 유지).
 * - `build/icon.ico` / `build/icon.icns` — Windows/macOS 빌드 타깃용(P5 이전엔
 *   빌드 검증 대상 아니지만 placeholder를 남겨두지 않기 위해 갱신).
 * - `src/main/trayIcon.ts`의 `TRAY_ICON_PNG_BASE64_16`/`_22` — 16px/22px 래스터를
 *   base64로 박아 넣은 상수(외부 에셋 파일 없이 트레이 아이콘을 코드에 직접
 *   담는 기존 관례 유지, 디자인만 placeholder에서 실제 브랜드 아이콘으로 교체).
 *
 * devDependency만 사용(sharp, png2icons) — 런타임 의존성 추가 없음.
 * 재실행 가능(idempotent) 1회성 유틸: 아이콘을 다시 디자인하면 이 스크립트만
 * 다시 돌리면 된다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const svg = readFileSync(path.join(root, 'build', 'icon.svg'))
const traySvg = readFileSync(path.join(root, 'build', 'icon-tray.svg'))

async function renderPng(size, source = svg) {
  return sharp(source, { density: 384 }).resize(size, size).png().toBuffer()
}

async function main() {
  // 512px 마스터 — build/와 resources/ 둘 다 (electron-builder buildResources
  // 와 electron-vite resources 두 소비처가 각자 원본을 가진다).
  const master = await renderPng(512)
  writeFileSync(path.join(root, 'build', 'icon.png'), master)
  writeFileSync(path.join(root, 'resources', 'icon.png'), master)
  console.log('wrote build/icon.png, resources/icon.png (512x512)')

  // ICO/ICNS — png2icons가 1024px 이하 원본에서도 다운스케일 세트를 만들어준다.
  // 1024px 소스를 별도로 렌더해서 넘긴다(README 권장: "ideal input ... 1024x1024").
  const large = await renderPng(1024)
  const ico = png2icons.createICO(large, png2icons.BICUBIC2, 0, false, true)
  const icns = png2icons.createICNS(large, png2icons.BICUBIC2, 0)
  if (!ico || !icns) {
    throw new Error('png2icons returned null — icon generation failed')
  }
  writeFileSync(path.join(root, 'build', 'icon.ico'), ico)
  writeFileSync(path.join(root, 'build', 'icon.icns'), icns)
  console.log('wrote build/icon.ico, build/icon.icns')

  // 트레이 16px/22px — build/icon-tray.svg(쉐브론을 뺀 단순화 글리프, 이유는
  // 그 파일 주석 참조)로 렌더해 base64 PNG를 src/main/trayIcon.ts에 상수로
  // 박아 넣는다(기존 placeholder와 동일한 형태 유지, 값만 교체).
  const png16 = (await renderPng(16, traySvg)).toString('base64')
  const png22 = (await renderPng(22, traySvg)).toString('base64')

  const trayIconPath = path.join(root, 'src', 'main', 'trayIcon.ts')
  let trayIconSrc = readFileSync(trayIconPath, 'utf-8')
  trayIconSrc = trayIconSrc.replace(
    /export const TRAY_ICON_PNG_BASE64_16 =\n\s*'[^']*'/,
    `export const TRAY_ICON_PNG_BASE64_16 =\n  '${png16}'`
  )
  trayIconSrc = trayIconSrc.replace(
    /export const TRAY_ICON_PNG_BASE64_22 =\n\s*'[^']*'/,
    `export const TRAY_ICON_PNG_BASE64_22 =\n  '${png22}'`
  )
  writeFileSync(trayIconPath, trayIconSrc)
  console.log('updated src/main/trayIcon.ts (16px/22px base64 constants)')

  // 육안 확인용 스테이징 사본 — 스크래치패드에 다양한 크기로 떨궈서 다음
  // 단계(Read 도구로 직접 열어 확인)에 쓴다.
  const previewDir = process.env.RIGSYNC_ICON_PREVIEW_DIR
  if (previewDir) {
    for (const size of [512, 128, 48]) {
      const buf = await renderPng(size)
      writeFileSync(path.join(previewDir, `preview-${size}.png`), buf)
    }
    for (const size of [22, 16]) {
      const buf = await renderPng(size, traySvg)
      writeFileSync(path.join(previewDir, `preview-tray-${size}.png`), buf)
    }
    console.log(`wrote preview PNGs to ${previewDir}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
