import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CockpitAssetItem {
  id: string;
  label: string;
  path: string;
  status: 'available' | 'missing';
  kind: 'identity' | 'memory' | 'style';
  excerpt: string;
}

export interface CockpitAssetOverview {
  total: number;
  available: number;
  items: CockpitAssetItem[];
}

export interface CockpitAssetDetail extends CockpitAssetItem {
  content: string;
}

const assetRegistry = [
  { id: 'product', label: '产品承诺', path: 'product.md', kind: 'identity' },
  { id: 'world', label: '世界观', path: 'world.md', kind: 'identity' },
  { id: 'characters', label: '人物', path: 'characters.md', kind: 'identity' },
  { id: 'outline', label: '大纲', path: 'outline.md', kind: 'identity' },
  { id: 'author', label: '作者口径', path: 'author.md', kind: 'identity' },
  { id: 'canon', label: '正史设定', path: 'memory/canon.md', kind: 'memory' },
  { id: 'foreshadowing', label: '伏笔', path: 'memory/foreshadowing.yaml', kind: 'memory' },
  { id: 'plot_threads', label: '主线', path: 'memory/plot_threads.yaml', kind: 'memory' },
  { id: 'character_state', label: '人物状态', path: 'memory/character_state.yaml', kind: 'memory' },
  { id: 'memory_style', label: '文风记忆', path: 'memory/style.md', kind: 'memory' },
  { id: 'style_profile', label: '当前文风', path: '.authoros/private/style-profile.snapshot.json', kind: 'style' },
] as const satisfies readonly Array<{
  id: string;
  label: string;
  path: string;
  kind: CockpitAssetItem['kind'];
}>;

export function emptyCockpitAssetOverview(): CockpitAssetOverview {
  return { total: 0, available: 0, items: [] };
}

export async function getCockpitAssetOverview(projectDir: string): Promise<CockpitAssetOverview> {
  const items = await Promise.all(assetRegistry.map(async (asset): Promise<CockpitAssetItem> => {
    const content = await readOptional(join(projectDir, asset.path));
    return {
      id: asset.id,
      label: asset.label,
      path: asset.path,
      kind: asset.kind,
      status: content === null ? 'missing' : 'available',
      excerpt: content === null ? '缺失' : excerpt(content),
    };
  }));
  return {
    total: items.length,
    available: items.filter((item) => item.status === 'available').length,
    items,
  };
}

export async function readCockpitAsset(projectDir: string, id: string): Promise<CockpitAssetDetail | null> {
  const asset = assetRegistry.find((item) => item.id === id);
  if (!asset) return null;
  const content = await readOptional(join(projectDir, asset.path));
  if (content === null) return null;
  return {
    id: asset.id,
    label: asset.label,
    path: asset.path,
    kind: asset.kind,
    status: 'available',
    excerpt: excerpt(content),
    content,
  };
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function excerpt(content: string): string {
  const normalized = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  return normalized.slice(0, 180);
}
