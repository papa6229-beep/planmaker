/**
 * 합성 계획을 실제 그림 한 장으로 (배경 합성 1차 §9).
 *
 * 여기서 모델을 부르는 자리는 없다. 배경은 이미 손에 있고(작업자가 넣었거나
 * 앞서 한 번 만들었거나), 제품·인물·로고는 원본을 그대로 얹는다. 그래서 이
 * 경로 전체의 외부 이미지 생성 호출은 0건이다.
 *
 * **원본 자산은 읽기만 한다.** 효과는 전부 이 캔버스 위에서 계산되고, 끝나면
 * 캔버스와 함께 사라진다. 세기를 0으로 내리면 원본이 그대로 돌아오는 것은 그
 * 때문이다 — 되돌릴 것이 애초에 없다.
 *
 * 순서가 곧 레이어다: 배경 → (블록 순서대로) 그림자 → 제품 → 림라이트 → 문구
 * → 그레인.
 */

import { contactShadow, wallShadow, type CompositeEffects } from '../domain/compositeEffects'
import { paperOutset, PAPER_SHADOW } from '../domain/paperCutout'
import { photoImageStyle, type ContentBox } from '../domain/photoBox'
import { fitSourceRect } from '../domain/imageLayout'
import type { PaperCanvas } from './paperCutoutShape'
import type { CompositeLayerPlan, CompositePlan } from '../domain/composite'
import type { ImageAnalysis } from '../domain/imageAnalysis'

/** 광원을 모를 때의 기본 — 정면광. 그림자는 발밑에만 생긴다. */
const FLAT_LIGHT = { light: { x: 0, y: 0 } }

export interface CompositeSources {
  /** 자산 번호 → 그 그림. 계획이 요구하는 것만 있으면 된다. */
  blobs: ReadonlyMap<string, Blob>
  /** 자산 번호 → 분석값. 없으면 정면광으로 본다. */
  analyses?: ReadonlyMap<string, ImageAnalysis>
  /**
   * 블록 번호 → 종이 컷아웃 모양 (Studio Patch §3).
   *
   * 미리보기와 **같은 함수**가 만든 것을 그대로 받는다. 여기서 다시 계산하면
   * 두 화면의 외곽선이 어긋날 길이 생긴다. 자산이 아니라 블록으로 세는 것은
   * 두께가 블록마다 다르기 때문이다 — 같은 그림을 두 자리에 놓고 한쪽만 두껍게
   * 할 수 있다 (한방 생성 Patch §3).
   */
  papers?: ReadonlyMap<string, PaperCanvas>
  /**
   * 블록 번호 → 그 그림의 알파 내용 상자 (진단 Patch B).
   *
   * 화면은 **내용 상자가 블록을 채우도록** 그림을 앉힌다 (`photoImageStyle`).
   * 여기서 파일 전체를 블록에 맞추면 투명한 띠까지 블록에 들어가므로, 같은 그림이
   * 화면에서는 블록을 채우고 결과에서는 작게 가운데 놓인다. 그 어긋남이 큰
   * 컷아웃의 흰 판이었다 — 종이는 블록 크기인데 사진만 줄어들었기 때문이다.
   *
   * 값이 없으면 지금까지처럼 파일 전체를 맞춘다.
   */
  boxes?: ReadonlyMap<string, ContentBox>
}

/**
 * 이 그림을 어디에 앉힐 것인가 — **화면과 같은 규칙으로**.
 *
 * `전체 보이기`이고 내용 상자를 알고 있으면, 내용 상자가 블록을 채우도록 그림을
 * 키워 앉힌다. 밖으로 나간 부분은 캔버스 경계와 크롭이 잘라 낸다 — 잘리는 것이지
 * 줄어드는 것이 아니다.
 */
function frameOf(
  layer: CompositeLayerPlan,
  source: { width: number; height: number },
  box: ContentBox | undefined,
): { source: { x: number; y: number; width: number; height: number }; dest: { x: number; y: number; width: number; height: number } } | null {
  if (box === undefined || layer.fit !== 'contain') return fitSourceRect(layer.fit, source, layer.rect)
  const placed = photoImageStyle(layer.rect, box)
  return fitSourceRect('contain', source, {
    x: layer.rect.x + placed.left,
    y: layer.rect.y + placed.top,
    width: placed.width,
    height: placed.height,
  })
}

async function toSource(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.addEventListener('load', () => resolve(img))
      img.addEventListener('error', () => reject(new Error('이미지를 읽지 못했습니다.')))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`
}

/**
 * 이 그림의 실루엣만 검게 칠한 캔버스.
 *
 * 그림자는 사각형이 아니라 **누끼 모양**이어야 한다. 사각형 그림자를 깔면 배경
 * 위에 상자가 놓인 것처럼 보이고, 그 순간 오려 붙인 티가 그림자 때문에 더 난다.
 */
function silhouette(
  source: CanvasImageSource,
  fit: { source: { x: number; y: number; width: number; height: number }; dest: { width: number; height: number } },
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(fit.dest.width))
  canvas.height = Math.max(1, Math.round(fit.dest.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(
    source,
    fit.source.x,
    fit.source.y,
    fit.source.width,
    fit.source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  // 알파는 그대로 두고 색만 검게 — 이것이 실루엣이다.
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/** 이 그림 한 장을 효과까지 얹어 그린다. */
async function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: CompositeLayerPlan,
  sources: CompositeSources,
  backgroundTone: { r: number; g: number; b: number } | null,
): Promise<void> {
  const blob = sources.blobs.get(layer.assetId)
  if (blob === undefined || layer.crop === null) return

  const source = await toSource(blob)
  const fit = frameOf(layer, { width: source.width, height: source.height }, sources.boxes?.get(layer.blockId))
  if (fit === null) return

  const analysis = sources.analyses?.get(layer.assetId)
  const light = analysis ?? FLAT_LIGHT
  const effects: CompositeEffects = layer.effects
  const shape = silhouette(source, fit)

  // ── 종이 컷아웃: 그림자와 사진보다 먼저, 맨 아래에 깔린다 (§3) ────────────
  const paper = effects.paperCutout ? sources.papers?.get(layer.blockId) : undefined
  if (paper !== undefined) {
    // 종이는 **블록**을 기준으로 삼는다 — 화면이 쓰는 그 기준이다. 그림이 앉은
    // 자리(`fit.dest`)를 기준으로 잡으면, 투명한 띠가 있는 그림에서 종이만
    // 블록만큼 커지고 사진은 그 안에 작게 남아 흰 판으로 보인다.
    const out = paperOutset(paper.content, paper.pad)
    const px = layer.rect.x - layer.rect.width * out.x
    const py = layer.rect.y - layer.rect.height * out.y
    const pw = layer.rect.width * (1 + out.x * 2)
    const ph = layer.rect.height * (1 + out.y * 2)
    const short = Math.min(layer.rect.width, layer.rect.height)
    ctx.save()
    // 얕고 부드러운 그림자. 캔버스 그림자는 알파를 따라가므로 종이 모양 그대로
    // 진다 — 사각형 그림자가 아니다.
    ctx.shadowColor = `rgba(24, 26, 34, ${PAPER_SHADOW.opacity})`
    ctx.shadowBlur = short * PAPER_SHADOW.blur
    ctx.shadowOffsetX = short * PAPER_SHADOW.dx
    ctx.shadowOffsetY = short * PAPER_SHADOW.dy
    ctx.drawImage(paper.canvas, px, py, pw, ph)
    ctx.restore()
  }

  // ── 그림자: 벽이 먼저, 접지가 그 위 (§9.2) ────────────────────────────────
  if (shape !== null && effects.wallShadow > 0) {
    const wall = wallShadow(layer.rect, light, effects.wallShadow)
    ctx.save()
    ctx.globalAlpha = wall.opacity
    ctx.filter = `blur(${Math.max(1, wall.blur)}px)`
    ctx.drawImage(shape, fit.dest.x + wall.dx, fit.dest.y + wall.dy, fit.dest.width, fit.dest.height)
    ctx.restore()
  }
  if (effects.contactShadow > 0) {
    const contact = contactShadow(layer.rect, light, effects.contactShadow)
    ctx.save()
    ctx.globalAlpha = contact.opacity
    ctx.filter = `blur(${Math.max(1, contact.blur)}px)`
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(contact.cx, contact.cy, Math.max(1, contact.rx), Math.max(1, contact.ry), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ── 원본 (§9 첫 줄: 그대로 얹는다) ────────────────────────────────────────
  ctx.save()
  // 캔버스 밖으로 걸친 부분은 여기서 잘린다 — 최종 결과는 캔버스 안쪽뿐이다.
  ctx.beginPath()
  ctx.rect(layer.crop.dx, layer.crop.dy, layer.crop.dWidth, layer.crop.dHeight)
  ctx.clip()
  ctx.drawImage(
    source,
    fit.source.x,
    fit.source.y,
    fit.source.width,
    fit.source.height,
    fit.dest.x,
    fit.dest.y,
    fit.dest.width,
    fit.dest.height,
  )

  if (shape !== null) {
    // ── 색상 통일 (§9.3): 배경색을 아주 옅게, 제품 모양 안에만 ──────────────
    if (effects.grading > 0 && backgroundTone !== null) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-atop'
      ctx.globalAlpha = effects.grading * 0.28
      ctx.fillStyle = rgba(backgroundTone.r, backgroundTone.g, backgroundTone.b, 1)
      ctx.fillRect(fit.dest.x, fit.dest.y, fit.dest.width, fit.dest.height)
      ctx.restore()
    }

    // ── 림라이트 (§9.4): 외곽에만. 제품 전체를 밝히지 않는다 ────────────────
    if (effects.rimLight > 0) {
      const dx = -light.light.x * Math.max(2, fit.dest.width * 0.012)
      const dy = -light.light.y * Math.max(2, fit.dest.height * 0.012)
      ctx.save()
      ctx.globalCompositeOperation = 'source-atop'
      ctx.globalAlpha = effects.rimLight * 0.5
      // 실루엣을 광원 쪽으로 조금 밀어 그리면 반대편 테두리만 남는다.
      ctx.filter = `blur(${Math.max(1, fit.dest.width * 0.006)}px)`
      ctx.globalCompositeOperation = 'destination-over'
      ctx.drawImage(shape, fit.dest.x + dx, fit.dest.y + dy, fit.dest.width, fit.dest.height)
      ctx.restore()
    }
  }
  ctx.restore()
}

/** 아주 약한 그레인 — 완성 결과 전체에 한 번 (§9.5). */
function drawGrain(ctx: CanvasRenderingContext2D, width: number, height: number, strength: number): void {
  if (strength <= 0) return
  const grain = document.createElement('canvas')
  grain.width = Math.max(1, Math.round(width / 2))
  grain.height = Math.max(1, Math.round(height / 2))
  const gctx = grain.getContext('2d')
  if (!gctx) return
  const image = gctx.createImageData(grain.width, grain.height)
  // 결정적인 값이면 페이지마다 같은 무늬가 반복돼 보이므로 자리마다 흩는다.
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 128 + Math.round((Math.random() - 0.5) * 255)
    image.data[i] = v
    image.data[i + 1] = v
    image.data[i + 2] = v
    image.data[i + 3] = 255
  }
  gctx.putImageData(image, 0, 0)

  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = Math.min(0.18, strength * 0.18)
  ctx.drawImage(grain, 0, 0, width, height)
  ctx.restore()
}

/**
 * 계획 한 편을 `840 × 페이지 높이` PNG 한 장으로.
 *
 * 실패는 그대로 던진다. 여기서 삼키면 호출부가 "결과가 있다"고 믿은 채 빈 그림을
 * 저장하게 된다.
 */
export async function renderComposite(plan: CompositePlan, sources: CompositeSources): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = plan.size.width
  canvas.height = plan.size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // 배경이 없으면 흰 바탕이다 — 투명 PNG를 쇼핑몰에 올리면 테마에 따라 글씨가
  // 사라진다.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let backgroundTone: { r: number; g: number; b: number } | null = null
  if (plan.background !== undefined) {
    const blob = sources.blobs.get(plan.background.assetId)
    if (blob !== undefined) {
      const source = await toSource(blob)
      // 배경은 언제나 캔버스를 채운다 (§5 기본값 `채우기`).
      const fit = fitSourceRect('cover', { width: source.width, height: source.height }, {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
      })
      if (fit !== null) {
        ctx.drawImage(
          source,
          fit.source.x,
          fit.source.y,
          fit.source.width,
          fit.source.height,
          fit.dest.x,
          fit.dest.y,
          fit.dest.width,
          fit.dest.height,
        )
      }
      // 그레이딩이 쓸 색은 **만들어진 배경**에서 다시 읽는다 (§9.3).
      const analysis = sources.analyses?.get(plan.background.assetId)
      if (analysis !== undefined) backgroundTone = analysis.average
    }
  }

  for (const layer of plan.layers) await drawLayer(ctx, layer, sources, backgroundTone)

  // ── 전경 문구 레이어 (한방 생성 Patch 2 §4) ───────────────────────────────
  //
  // 사진을 전부 그린 **뒤에** 얹는다. 순서가 곧 계약이다 — 이 겹이 마지막이므로
  // 문구는 언제나 이미지보다 앞에 오고, 배경이 투명하므로 아래가 비친다.
  if (plan.foreground !== undefined) {
    const blob = sources.blobs.get(plan.foreground.assetId)
    if (blob !== undefined) {
      const source = await toSource(blob)
      // 같은 지면을 그린 한 장이다. 잘라 내지 않고 캔버스에 그대로 맞춘다.
      ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, canvas.width, canvas.height)
    }
  }

  // 문구는 기존 표현 그대로 (§10). 새 텍스트 엔진을 만들지 않는다.
  for (const text of plan.texts) {
    ctx.save()
    ctx.fillStyle = '#171923'
    ctx.textBaseline = 'top'
    ctx.font = `${text.bare ? 700 : 400} ${text.fontSize}px "Pretendard", "Noto Sans KR", system-ui, sans-serif`
    ctx.textAlign = text.align === 'center' ? 'center' : text.align === 'right' ? 'right' : 'left'
    const x =
      text.align === 'center'
        ? text.rect.x + text.rect.width / 2
        : text.align === 'right'
          ? text.rect.x + text.rect.width
          : text.rect.x
    let y = text.rect.y
    for (const line of text.content.split('\n')) {
      ctx.fillText(line, x, y)
      y += text.fontSize * 1.25
    }
    ctx.restore()
  }

  drawGrain(ctx, canvas.width, canvas.height, plan.grain)

  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!out) throw new Error('합성 결과 이미지를 만들지 못했습니다.')
  return out
}
