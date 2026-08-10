/**
 * 만든 파일 한 장을 사람에게 내준다.
 *
 * 저장 경로가 둘이 되어(완성본 이미지, 배너) 같은 열 줄을 두 벌 두게 되었으므로
 * 한 곳으로 모은다. 여기서 잘못되면 **작업 결과가 손에 안 들어온다** — 앞의 모든
 * 작업이 헛것이 되는 자리라, 두 벌이 서로 다르게 낡는 것을 두고 보지 않는다.
 *
 * 주소를 바로 거두지 않는 것이 요점이다. 브라우저가 내려받기를 시작하기 전에
 * 거두면 빈 파일이 떨어진다.
 */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 10_000)
}
