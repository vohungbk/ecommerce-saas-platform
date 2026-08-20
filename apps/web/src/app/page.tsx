import { HealthCheckWidget } from "@/components/health-check-widget";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">E-Commerce &amp; SaaS Platform</h1>
      <p className="text-sm text-neutral-500">Phase 0 — project foundation</p>
      <HealthCheckWidget />
    </main>
  );
}
