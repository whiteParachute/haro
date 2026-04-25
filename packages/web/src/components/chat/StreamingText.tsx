export function StreamingText({ content }: { content: string }) {
  return <p className="whitespace-pre-wrap text-sm leading-6">{content || '等待 Agent 响应…'}</p>;
}
