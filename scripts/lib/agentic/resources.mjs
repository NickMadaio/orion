/** Read-only macOS resource telemetry. No sudo, tuning, or process termination. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const GiB = 1024 ** 3;

export function parseResources(vm, sysctl, thermal) {
  const pageSize = Number(vm.match(/page size of (\d+) bytes/)?.[1]);
  const pages = name => Number(vm.match(new RegExp(`${name}:\\s+(\\d+)`))?.[1]);
  const swap = sysctl.match(/used\s*=\s*([\d.]+)([MG])/);
  const pressure = Number(sysctl.match(/kern.memorystatus_vm_pressure_level:\s*(\d+)/)?.[1]);
  const speed = thermal.match(/CPU_Speed_Limit\s*=\s*(\d+)/);
  return {
    at: new Date().toISOString(),
    available: Number.isFinite(pageSize) && !!swap && Number.isFinite(pressure),
    pressure,
    // Reported for diagnosis, NOT for a threshold. On a healthy macOS machine
    // free pages sit near zero because the OS uses what it has; `pressure` is
    // the signal that means anything, which is what `resourceConcern` keys on.
    freeGiB: pages('Pages free') * pageSize / GiB,
    compressedGiB: pages('Pages occupied by compressor') * pageSize / GiB,
    swapGiB: swap ? Number(swap[1]) / (swap[2] === 'G' ? 1 : 1024) : null,
    cpuSpeedLimit: speed ? Number(speed[1]) : null,
  };
}

/*
 A sample never throws and never reports a concern it could not measure.

 One of these three commands being slow, missing or changed by an OS update is
 not a resource emergency, and treating it as one would stop every generation on
 a machine that is perfectly healthy. Same distinction `checks.mjs` draws between
 "your code is wrong" and "this machine cannot run the check": an absent
 measurement is reported as absent, and the run continues.
*/
export async function sampleResources() {
  if (process.platform !== 'darwin') return { available: false, reason: 'macOS telemetry unavailable on this platform' };
  const options = { timeout: 5000, maxBuffer: 32000, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } };
  const read = (file, args) => exec(file, args, options).then(result => result.stdout, () => '');
  const results = await Promise.all([
    read('/usr/bin/vm_stat', []),
    read('/usr/sbin/sysctl', ['vm.swapusage', 'kern.memorystatus_vm_pressure_level']),
    read('/usr/bin/pmset', ['-g', 'therm']),
  ]);
  const sample = parseResources(...results);
  return sample.available ? sample : { ...sample, reason: 'vm_stat or sysctl produced no usable reading' };
}

/*
 SWAP THAT HAS STOPPED GROWING IS NOT DISTRESS.

 Measured on this Mac, 2026-09-23: loading qwen3.6:27b at a 65,536-token context
 pushed swap from 6.84 to 8.68 GiB — a single step of 1.84 GiB, 0.16 short of the
 old 2 GiB trip — and then it stayed flat for the rest of the generation and
 through a second one. Memory pressure reached "warning" (2) and never
 "critical" (4). That step is macOS paging idle apps out to make room for the
 model, which is the OS working; the old rule, "swap is 2 GiB above where it was
 when this generation started", could not tell it apart from a machine
 thrashing to death, and on a busier evening it would have aborted the first
 generation of every run.

 Thrashing is swap that KEEPS climbing. So the swap rule now needs both: a
 large rise from the baseline AND a rise since the previous sample. A one-time
 load step trips neither on its second look. Critical pressure is unchanged and
 remains the primary signal.
*/
const SWAP_STEP_GIB = 2;
const SWAP_STILL_GROWING_GIB = 0.25;

export function resourceConcern(sample, baseline, previous = null) {
  // Unmeasurable is not unhealthy. The absence is visible in the journal and in
  // `doctor`; it is not grounds for aborting inference.
  if (!sample.available) return null;
  if (sample.pressure >= 4) return 'critical memory pressure';
  if (baseline?.available && previous?.available &&
      sample.swapGiB - baseline.swapGiB >= SWAP_STEP_GIB &&
      sample.swapGiB - previous.swapGiB >= SWAP_STILL_GROWING_GIB) {
    return 'swap is still climbing, over 2 GiB above where this generation started';
  }
  if (sample.cpuSpeedLimit !== null && sample.cpuSpeedLimit < 80) return 'thermal CPU speed limit below 80%';
  return null;
}

/** Abort active inference after two consecutive unhealthy samples. */
export async function guardResources({ signal, emit = () => {}, sample = sampleResources, intervalMs = 15000 } = {}) {
  const baseline = await sample();
  emit({ kind: baseline.available ? 'resource_sample' : 'resource_telemetry_unavailable', data: baseline });
  const initial = resourceConcern(baseline);
  // Refusing to START a multi-minute generation while the machine is already in
  // critical pressure is cheaper than being killed halfway through one.
  if (initial) throw new Error(`resource guard: ${initial}. Free memory before starting a run, or raise the pressure threshold.`);
  const controller = new AbortController();
  const relay = () => controller.abort(signal.reason);
  if (signal?.aborted) relay();
  else signal?.addEventListener('abort', relay, { once: true });
  // `previous` starts at the baseline: a load step between the baseline and the
  // first sample earns at most ONE strike, and its plateau clears it on the next
  // look. Only swap that keeps rising strikes twice in a row.
  let busy = false, strikes = 0, failure = null, previous = baseline;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const current = await sample();
      emit({ kind: 'resource_sample', data: current });
      const reason = resourceConcern(current, baseline, previous);
      previous = current;
      strikes = reason ? strikes + 1 : 0;
      if (strikes >= 2) {
        failure = new Error(`resource guard: ${reason}`);
        // The machine was short of memory; the worker did nothing wrong. Marked
        // recoverable so the attempt is refunded and bounded runtime recovery
        // (recovery.mjs) waits for memory to settle instead of ending the task.
        failure.recoverableRuntime = true;
        failure.resourcePressure = true;
        emit({ kind: 'resource_guard_stopped', data: { reason } });
        controller.abort(failure);
      }
    } catch (error) {
      // A sampler that failed has told us nothing about the machine. Record it
      // and keep generating; killing a nine-minute worker turn because `pmset`
      // hiccuped is the false positive this guard must not produce.
      emit({ kind: 'resource_sample_failed', data: { reason: String(error?.message ?? error) } });
    } finally { busy = false; }
  }, intervalMs);
  timer.unref();
  return { signal: controller.signal, get failure() { return failure; }, close() {
    clearInterval(timer); signal?.removeEventListener('abort', relay);
  } };
}
