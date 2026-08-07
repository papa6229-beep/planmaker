/**
 * 참고로 보내는 그림을 얼마나 줄여 보낼 것인가 (부분수정 실패 Patch).
 *
 * 요청에 실리는 그림은 두 갈래다. **다시 그려져 나와야 하는 것**(제품 원본, 고칠
 * 통이미지)과 **보고 참고만 하는 것**(스타일 레퍼런스, 만들어진 배경, 블록 참고
 * 그림)이다. 앞쪽은 한 픽셀도 줄이면 안 되지만, 뒤쪽은 색과 결을 읽는 자료라
 * 원본 해상도가 필요하지 않다.
 *
 * 그런데 요청 한 건이 실어 나를 수 있는 바이트에는 상한이 있고, 그 상한을 넘으면
 * 서버 함수가 **불리기도 전에** 거절당한다. 그때 돌아오는 응답에는 우리 오류
 * 코드가 없어서 화면에는 "이미지를 생성하지 못했습니다"만 남는다 — 무엇이
 * 잘못됐는지 아무 데도 적히지 않는 실패다.
 *
 * 작업자가 올리는 레퍼런스는 크기 제한 없이 저장된다(웹에서 받은 큰 사진이 그대로
 * 들어온다). 그래서 참고용 그림만 여기서 정한 한 변으로 줄여 보낸다. 잃는 것은
 * 없다 — 이 그림들은 색과 짜임새를 보라고 보내는 것이지 베끼라고 보내는 것이
 * 아니다.
 *
 * 순수 모듈이다. 캔버스도 네트워크도 모른다.
 */

/** 참고용 그림의 긴 변 상한. 색·질감·타이포 위계를 읽기에 충분한 크기다. */
export const REFERENCE_MAX_SIDE = 1024

/** 이 바이트 아래는 줄이지 않는다 — 다시 그리는 값이 얻는 것보다 크다. */
export const REFERENCE_MIN_BYTES = 200_000

/**
 * 이 그림을 어느 크기로 다시 그릴 것인가. 줄일 필요가 없으면 `null`.
 *
 * 비율은 그대로 지킨다. 한 변만 맞추고 다른 변을 늘리면 참고 그림의 구도가
 * 달라져, 모델이 보는 짜임새와 작업자가 보는 짜임새가 어긋난다.
 */
export function referenceTarget(
  size: { width: number; height: number },
  byteSize: number,
  maxSide: number = REFERENCE_MAX_SIDE,
): { width: number; height: number } | null {
  if (size.width <= 0 || size.height <= 0) return null
  if (byteSize <= REFERENCE_MIN_BYTES) return null
  const longest = Math.max(size.width, size.height)
  if (longest <= maxSide) return null
  const scale = maxSide / longest
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}
