import type { FastifyInstance, FastifyRequest } from "fastify";

export interface RequestMetrics {
  startedAt: string;
  uptimeSeconds: number;
  totalRequests: number;
  requestsPerMinute: number;
  activeRequests: number;
  errorResponses: number;
  errorRate: number;
  averageResponseMs: number;
  processCpuPercent: number;
}

export function registerRequestMonitor(app: FastifyInstance) {
  const startedAtMs = Date.now();
  const starts = new WeakMap<FastifyRequest, bigint>();
  const requestTimes: number[] = [];
  let totalRequests = 0;
  let activeRequests = 0;
  let completedRequests = 0;
  let errorResponses = 0;
  let totalResponseMs = 0;
  let previousCpu = process.cpuUsage();
  let previousCpuAt = process.hrtime.bigint();
  let processCpuPercent = 0;

  app.addHook("onRequest", async (request) => {
    starts.set(request, process.hrtime.bigint());
    totalRequests += 1;
    activeRequests += 1;
    requestTimes.push(Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    activeRequests = Math.max(0, activeRequests - 1);
    completedRequests += 1;
    if (reply.statusCode >= 500) errorResponses += 1;
    const started = starts.get(request);
    if (started) totalResponseMs += Number(process.hrtime.bigint() - started) / 1_000_000;
  });

  return {
    snapshot(): RequestMetrics {
      const now = Date.now();
      while (requestTimes.length && requestTimes[0]! < now - 60_000) requestTimes.shift();

      const cpuNow = process.cpuUsage();
      const cpuAt = process.hrtime.bigint();
      const wallMicros = Number(cpuAt - previousCpuAt) / 1_000;
      if (wallMicros > 0) {
        processCpuPercent = Math.max(0, ((cpuNow.user - previousCpu.user) + (cpuNow.system - previousCpu.system)) / wallMicros * 100);
      }
      previousCpu = cpuNow;
      previousCpuAt = cpuAt;

      return {
        startedAt: new Date(startedAtMs).toISOString(),
        uptimeSeconds: Math.floor((now - startedAtMs) / 1_000),
        totalRequests,
        requestsPerMinute: requestTimes.length,
        activeRequests,
        errorResponses,
        errorRate: totalRequests ? errorResponses / totalRequests : 0,
        averageResponseMs: completedRequests ? totalResponseMs / completedRequests : 0,
        processCpuPercent,
      };
    },
  };
}

export type RequestMonitor = ReturnType<typeof registerRequestMonitor>;
