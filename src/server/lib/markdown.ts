import { marked } from "marked";

export async function renderMarkdown(src: string): Promise<string> {
  return marked.parse(src, { async: true });
}
