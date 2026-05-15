import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatChapterNumber } from '../core/paths.ts';

export interface DownloadResult {
  filename: string;
  contentType: string;
  body: Buffer;
}

export async function readChapterDownload(projectDir: string, chapter: number): Promise<DownloadResult> {
  const chapterId = formatChapterNumber(chapter);
  return {
    filename: `chapter-${chapterId}.md`,
    contentType: 'text/markdown; charset=utf-8',
    body: await readFile(join(projectDir, 'chapters', `${chapterId}.md`)),
  };
}

export async function buildChaptersZip(projectDir: string): Promise<DownloadResult> {
  const names = (await readdir(join(projectDir, 'chapters')))
    .filter((name) => /^\d{4}\.md$/.test(name))
    .sort();
  const entries = await Promise.all(names.map(async (name) => ({
    name: `chapters/${name}`,
    data: await readFile(join(projectDir, 'chapters', name)),
  })));
  return {
    filename: 'chapters.zip',
    contentType: 'application/zip',
    body: buildStoredZip(entries),
  };
}

function buildStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const records: Array<{ name: string; crc: number; size: number; offset: number }> = [];
  const chunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, entry.data);
    records.push({ name: entry.name.replace(/\\/g, '/'), crc, size: entry.data.length, offset });
    offset += local.length + nameBytes.length + entry.data.length;
  }

  const centralStart = offset;
  for (const record of records) {
    const nameBytes = Buffer.from(record.name, 'utf8');
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(record.crc, 16);
    central.writeUInt32LE(record.size, 20);
    central.writeUInt32LE(record.size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(record.offset, 42);
    chunks.push(central, nameBytes);
    offset += central.length + nameBytes.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);
  return Buffer.concat(chunks);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

