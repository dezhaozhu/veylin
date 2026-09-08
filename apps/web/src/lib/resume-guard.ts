/**
 * resume 是给「连接断了、服务端还在跑」的场景重新接上流。请求还在飞
 * (submitted/streaming)时不该 resume —— 首条消息刚发出去,sessionStorage 里可能
 * 还留着上一条线程的 stream id,这时 resumeStream 会和在飞的请求撞车,每条新线程
 * 第一轮都报一次 "Cannot read properties of undefined (reading 'state')"
 * (隔离 e2e 每轮必现;发现时它已经存在,不是新引入的)。
 */
export function shouldAttemptResume(status: string | undefined): boolean {
  return status !== 'submitted' && status !== 'streaming';
}
