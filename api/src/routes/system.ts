import { FastifyInstance } from 'fastify';
import { execSync } from 'child_process';

function run(cmd: string): string {
  try {
    return execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function parseMemory() {
  const totalBytes = parseInt(run('/usr/sbin/sysctl -n hw.memsize') || '0');
  const totalGB = totalBytes / (1024 ** 3);
  const vmstat = run('vm_stat');
  const pageSize = 16384;
  const pages = (key: string) => {
    const m = vmstat.match(new RegExp(`${key}:\\s+(\\d+)`));
    return m ? parseInt(m[1]) : 0;
  };
  // App Memory ≈ active + wired (internal - purgeable)
  const appPages = pages('Pages active') + pages('Pages wired down');
  const usedGB = (appPages * pageSize) / (1024 ** 3);
  const pressure = run('/usr/sbin/sysctl -n kern.memorystatus_vm_pressure_level');
  const pressureLabel = pressure === '1' ? 'nominal' : pressure === '2' ? 'warning' : pressure === '4' ? 'critical' : 'nominal';
  return { total: +totalGB.toFixed(1), used: +usedGB.toFixed(1), free: +(totalGB - usedGB).toFixed(1), unit: 'GB', pressure: pressureLabel };
}

function parseCPU() {
  const brand = run('/usr/sbin/sysctl -n machdep.cpu.brand_string');
  const cores = parseInt(run('/usr/sbin/sysctl -n hw.ncpu') || '0');
  const topLine = run('top -l 1 -n 0 | grep "CPU usage"');
  let usage = 0;
  const m = topLine.match(/([\d.]+)% user.*?([\d.]+)% sys/);
  if (m) usage = parseFloat(m[1]) + parseFloat(m[2]);
  return { model: brand || 'Unknown', cores, usage: +usage.toFixed(1) };
}

function parseDisk() {
  const df = run('df -h /');
  const lines = df.split('\n');
  if (lines.length < 2) return { total: 0, used: 0, free: 0, unit: 'GB', percent: 0 };
  const parts = lines[1].split(/\s+/);
  const parse = (s: string) => { const n = parseFloat(s); return s.includes('T') ? n * 1024 : n; };
  return { total: +parse(parts[1]).toFixed(0), used: +parse(parts[2]).toFixed(0), free: +parse(parts[3]).toFixed(0), unit: 'GB', percent: parseInt(parts[4]) || 0 };
}

function parseBattery() {
  const batt = run('pmset -g batt');
  const pctM = batt.match(/(\d+)%/);
  const charging = batt.includes('AC Power') || batt.includes('charging');
  const timeM = batt.match(/(\d+:\d+) remaining/);
  return { percent: pctM ? parseInt(pctM[1]) : -1, charging, timeRemaining: timeM ? timeM[1] : charging ? 'Charging' : 'N/A' };
}

function parseUptime() {
  const up = run('uptime');
  const m = up.match(/up\s+(.+?),\s+\d+ user/);
  return m ? m[1].trim() : 'unknown';
}

function parseNetwork() {
  const ip = run('ipconfig getifaddr en0');
  const ssidLine = run('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I 2>/dev/null | grep " SSID"');
  const ssid = ssidLine.split(':').pop()?.trim() || run('networksetup -getairportnetwork en0 2>/dev/null').replace(/^.*:\s*/, '');
  return { wifi: ip ? 'connected' : 'disconnected', ssid: ssid || 'Unknown', localIP: ip || 'N/A' };
}

function parseProcesses() {
  const ps = run('ps aux');
  const totalBytes = parseInt(run('/usr/sbin/sysctl -n hw.memsize') || '0');
  const find = (pattern: RegExp) => {
    const lines = ps.split('\n').filter(l => pattern.test(l) && !l.includes('grep'));
    if (lines.length === 0) return { running: false };
    let totalMem = 0;
    let pid = 0;
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (!pid) pid = parseInt(parts[1]);
      totalMem += parseFloat(parts[3] || '0');
    }
    const memMB = Math.round((totalMem / 100) * totalBytes / (1024 ** 2));
    return { running: true, pid, memory: `${memMB}MB` };
  };
  return {
    openclaw: find(/openclaw|ai\.openclaw/),
    dashboard: find(/tsx.*index\.ts/),
    redis: find(/redis-server/),
    chrome: find(/Google Chrome Helper/),
  };
}

function parseLoad() {
  const up = run('uptime');
  const m = up.match(/load averages?:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : [0, 0, 0];
}

export default async function systemRoutes(app: FastifyInstance) {
  app.get('/api/system', async () => {
    const hostname = run('hostname');
    const osVersion = run('sw_vers -productVersion');
    const arch = run('uname -m');
    return {
      hostname,
      os: `macOS ${osVersion}`,
      arch: `${arch} (Apple Silicon)`,
      cpu: parseCPU(),
      memory: parseMemory(),
      disk: parseDisk(),
      battery: parseBattery(),
      uptime: parseUptime(),
      network: parseNetwork(),
      processes: parseProcesses(),
      load: parseLoad(),
    };
  });
}
