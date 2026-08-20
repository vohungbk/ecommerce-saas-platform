'use client';

import { useQuery } from '@tanstack/react-query';

interface HealthResponse {
  status: string;
  info?: Record<string, { status: string }>;
}

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`API health check failed: ${res.status}`);
  }
  return res.json();
}

export function HealthCheckWidget() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  if (isLoading) return <p>Checking API…</p>;
  if (error) return <p>API unreachable: {(error as Error).message}</p>;

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
