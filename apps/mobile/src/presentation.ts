export type DisplayRow = {
  id: string;
  kind: 'message' | 'work';
  item?: any;
  items?: any[];
};
export function displayRows(items: any[]): DisplayRow[] {
  const result: DisplayRow[] = [];
  for (const item of items) {
    if (['reasoning', 'steered'].includes(item.type)) continue;
    if (['userMessage', 'agentMessage'].includes(item.type)) {
      if (item.text?.trim())
        result.push({ id: item.id, kind: 'message', item });
    } else {
      const last = result.at(-1);
      if (last?.kind === 'work') last.items!.push(item);
      else result.push({ id: 'work-' + item.id, kind: 'work', items: [item] });
    }
  }
  return result;
}
export function shortTitle(title: string) {
  return (
    (title ?? '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 72) || '新聊天'
  );
}
export function pathName(path: string) {
  return (
    path
      ?.replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || '未分组'
  );
}
export function normalizePath(value: string) {
  return value
    .replace(/^[^a-zA-Z]+/, '')
    .replaceAll(String.fromCharCode(92), '/')
    .replace(/\/$/, '')
    .toLowerCase();
}
export function workLabel(item: any) {
  if (item.type === 'commandExecution') {
    const text = item.text?.trim();
    return text ? '运行命令' : '终端';
  }
  if (item.type === 'fileChange') return '更新文件';
  if (item.type === 'imageView') return '查看图片';
  if (item.type === 'sleep') return '等待';
  if (/search/i.test(item.type)) return '搜索';
  if (/function|tool|mcp/i.test(item.type)) return '使用工具';
  return '执行操作';
}
