export const LOG_LIMIT: number;
export function appendLogChunks(chunks: string[], text: string, limit?: number): {chunks: string[]; truncated: boolean};
export function logText(chunks: string[]): string;
