export const replayKeys = {
  list: (requestId: string) => ['requests', requestId, 'replays'] as const,
  detail: (id: string) => ['replays', id] as const,
};
