export const requestKeys = {
  list: (slug: string) => ['endpoints', slug, 'requests'] as const,
  detail: (id: string) => ['requests', id] as const,
};
