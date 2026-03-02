import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || path.join(import.meta.dirname, '../../../'));

interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
}

function scanDir(dir: string, base: string): FileInfo[] {
  const results: FileInfo[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath);
    if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      results.push({ name: entry.name, path: relPath, size: stat.size, modified: stat.mtime.toISOString() });
    } else if (entry.isDirectory()) {
      results.push(...scanDir(fullPath, base));
    }
  }
  return results;
}

export default async function filesRoutes(app: FastifyInstance) {
  app.get('/api/files', async () => {
    const researchDir = path.join(PROJECT_ROOT, 'research');
    const outputDir = path.join(PROJECT_ROOT, 'output');
    return {
      research: scanDir(researchDir, researchDir),
      output: scanDir(outputDir, outputDir),
    };
  });

  app.get<{ Params: { '*': string } }>('/api/files/*', async (req, reply) => {
    const reqPath = (req.params as any)['*'];
    if (!reqPath) return reply.status(400).send({ error: 'Path required' });

    // Try research/ then output/
    for (const base of ['research', 'output']) {
      const fullPath = path.resolve(PROJECT_ROOT, base, reqPath);
      if (!fullPath.startsWith(path.resolve(PROJECT_ROOT, base))) {
        return reply.status(403).send({ error: 'Path traversal not allowed' });
      }
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const stat = fs.statSync(fullPath);
        return { name: path.basename(fullPath), path: reqPath, content, size: stat.size, modified: stat.mtime.toISOString() };
      }
    }
    return reply.status(404).send({ error: 'File not found' });
  });
}
