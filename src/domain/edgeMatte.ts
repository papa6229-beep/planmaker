/**
 * 누끼 가장자리의 흰 매트 걷기 (가장자리 정리, 2026-09-17). 순수 모듈.
 *
 * 이미지 블록 효과 `edge`(가장자리 보정)가 쓰는 규칙이다.
 */

/**
 * 누끼 가장자리의 반투명 픽셀에 섞인 바탕색(대개 흰색)을 안쪽 색으로 바꾼다.
 *
 * 흰 바탕에서 딴 누끼는 가장자리 색에 흰색이 묻어 있다 — 검은 제품의 가장자리
 * 평균 밝기가 198인데 바로 안쪽은 122였다 (2026-09-17). 어두운 배경에 얹으면
 * 밝은 테로 보인다. 포토샵의 "흰색 매트 제거"와 같은 일이다.
 *
 * 둘레 두 칸 안의 불투명 픽셀 평균으로 당긴다. 세기 0이면 손대지 않는다.
 */
export function defringe(data: Uint8ClampedArray, width: number, height: number, strength: number): void {
  const s = Math.max(0, Math.min(1, strength))
  if (s === 0) return
  const src = data.slice()
  const R = 2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const a = src[i + 3] ?? 0
      if (a === 0 || a >= 250) continue
      let n = 0
      let sr = 0
      let sg = 0
      let sb = 0
      for (let dy = -R; dy <= R; dy += 1) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -R; dx <= R; dx += 1) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const j = (yy * width + xx) * 4
          if ((src[j + 3] ?? 0) < 250) continue
          sr += src[j] ?? 0
          sg += src[j + 1] ?? 0
          sb += src[j + 2] ?? 0
          n += 1
        }
      }
      if (n === 0) continue
      data[i] = Math.round((src[i] ?? 0) + (sr / n - (src[i] ?? 0)) * s)
      data[i + 1] = Math.round((src[i + 1] ?? 0) + (sg / n - (src[i + 1] ?? 0)) * s)
      data[i + 2] = Math.round((src[i + 2] ?? 0) + (sb / n - (src[i + 2] ?? 0)) * s)
    }
  }
}
